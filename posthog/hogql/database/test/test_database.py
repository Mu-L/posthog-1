import json
from typing import Any, cast

from unittest.mock import patch
import pytest
from django.test import override_settings
from parameterized import parameterized

from posthog.hogql.constants import MAX_SELECT_RETURNED_ROWS
from posthog.hogql.database.database import create_hogql_database, serialize_database
from posthog.hogql.database.models import (
    FieldTraverser,
    LazyJoin,
    StringDatabaseField,
    ExpressionField,
    Table,
)
from posthog.hogql.errors import ExposedHogQLError
from posthog.hogql.modifiers import create_default_modifiers_for_team
from posthog.hogql.parser import parse_expr, parse_select
from posthog.hogql.printer import print_ast
from posthog.hogql.context import HogQLContext
from posthog.models.group_type_mapping import GroupTypeMapping
from posthog.models.organization import Organization
from posthog.models.team.team import Team
from posthog.schema import (
    DataWarehouseEventsModifier,
    DatabaseSchemaDataWarehouseTable,
    HogQLQueryModifiers,
    PersonsOnEventsMode,
)
from posthog.test.base import BaseTest, QueryMatchingTest, FuzzyInt
from posthog.warehouse.models import DataWarehouseTable, DataWarehouseCredential, DataWarehouseSavedQuery
from posthog.hogql.query import execute_hogql_query
from posthog.hogql.test.utils import pretty_print_in_tests
from posthog.warehouse.models.external_data_schema import ExternalDataSchema
from posthog.warehouse.models.external_data_source import ExternalDataSource
from posthog.warehouse.models.join import DataWarehouseJoin


class TestDatabase(BaseTest, QueryMatchingTest):
    snapshot: Any

    def test_create_hogql_database_team_id_and_team_must_be_the_same(self):
        with self.assertRaises(ValueError, msg="team_id and team must be the same"):
            create_hogql_database(team_id=self.team.pk + 1, team=self.team)

    def test_create_hogql_database_must_have_either_team_id_or_team(self):
        with self.assertRaises(ValueError, msg="Either team_id or team must be provided"):
            create_hogql_database()

    @pytest.mark.usefixtures("unittest_snapshot")
    def test_serialize_database_no_person_on_events(self):
        with override_settings(PERSON_ON_EVENTS_V2_OVERRIDE=False):
            serialized_database = serialize_database(
                HogQLContext(team_id=self.team.pk, database=create_hogql_database(team=self.team))
            )
            assert (
                json.dumps(
                    {table_name: table.model_dump() for table_name, table in serialized_database.items()}, indent=4
                )
                == self.snapshot
            )

    @pytest.mark.usefixtures("unittest_snapshot")
    def test_serialize_database_with_person_on_events_enabled(self):
        with override_settings(PERSON_ON_EVENTS_OVERRIDE=True):
            serialized_database = serialize_database(
                HogQLContext(team_id=self.team.pk, database=create_hogql_database(team=self.team))
            )
            assert (
                json.dumps(
                    {table_name: table.model_dump() for table_name, table in serialized_database.items()}, indent=4
                )
                == self.snapshot
            )

    @parameterized.expand([False, True])
    def test_can_select_from_each_table_at_all(self, poe_enabled: bool) -> None:
        with override_settings(PERSON_ON_EVENTS_OVERRIDE=poe_enabled):
            serialized_database = serialize_database(
                HogQLContext(team_id=self.team.pk, database=create_hogql_database(team=self.team))
            )
            for table_name, table in serialized_database.items():
                columns = [
                    field.name
                    for field in table.fields.values()
                    if field.chain is None and field.table is None and field.fields is None
                ]

                execute_hogql_query(
                    f"SELECT {','.join(columns)} FROM {table_name}",
                    team=self.team,
                    pretty=False,
                )

    def test_serialize_database_posthog_table(self):
        database = create_hogql_database(team=self.team)

        serialized_database = serialize_database(HogQLContext(team_id=self.team.pk, database=database))

        tables = database.get_posthog_tables()
        for table_name in tables:
            assert serialized_database.get(table_name) is not None

    def test_serialize_database_deleted_saved_query(self):
        saved_query_name = "deleted_saved_query"
        DataWarehouseSavedQuery.objects.create(
            team=self.team,
            name="DELETED",
            query={
                "kind": "HogQLQuery",
                "query": "select event as event from events LIMIT 100",
            },
            deleted=True,
            deleted_name=saved_query_name,
        )
        database = create_hogql_database(team=self.team)

        serialized_database = serialize_database(HogQLContext(team_id=self.team.pk, database=database))

        assert saved_query_name not in serialized_database
        assert saved_query_name not in database._view_table_names
        assert "DELETED" not in serialized_database
        assert "DELETED" not in database._view_table_names

    def test_serialize_database_warehouse_table_s3_with_unknown_field(self):
        credentials = DataWarehouseCredential.objects.create(access_key="blah", access_secret="blah", team=self.team)
        DataWarehouseTable.objects.create(
            name="table_1",
            format="Parquet",
            team=self.team,
            credential=credentials,
            url_pattern="https://bucket.s3/data/*",
            columns={"id": {"hogql": "UnknownDatabaseField", "clickhouse": "Nullable(String)", "schema_valid": True}},
            row_count=100,
        )

        database = create_hogql_database(team=self.team)

        serialized_database = serialize_database(HogQLContext(team_id=self.team.pk, database=database))

        table = cast(DatabaseSchemaDataWarehouseTable | None, serialized_database.get("table_1"))
        assert table is not None
        assert table.row_count == 100

        field = table.fields.get("id")
        assert field is not None
        assert field.type == "unknown"
        assert field.schema_valid is True

    def test_serialize_database_warehouse_table_s3(self):
        credentials = DataWarehouseCredential.objects.create(access_key="blah", access_secret="blah", team=self.team)
        DataWarehouseTable.objects.create(
            name="table_1",
            format="Parquet",
            team=self.team,
            credential=credentials,
            url_pattern="https://bucket.s3/data/*",
            columns={"id": {"hogql": "StringDatabaseField", "clickhouse": "Nullable(String)", "schema_valid": True}},
        )

        database = create_hogql_database(team=self.team)

        serialized_database = serialize_database(HogQLContext(team_id=self.team.pk, database=database))

        table = cast(DatabaseSchemaDataWarehouseTable | None, serialized_database.get("table_1"))
        assert table is not None
        assert len(table.fields.keys()) == 1
        assert table.source is None
        assert table.schema_ is None

        field = table.fields.get("id")
        assert field is not None
        assert field.name == "id"
        assert field.type == "string"
        assert field.schema_valid is True

    def test_serialize_database_warehouse_with_deleted_joins(self):
        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="events",
            source_table_key="event",
            joining_table_name="groups",
            joining_table_key="key",
            field_name="some_field",
            deleted=True,
        )

        db = create_hogql_database(team=self.team)

        serialized_database = serialize_database(HogQLContext(team_id=self.team.pk, database=db))

        events_table = serialized_database.get("events")
        assert events_table is not None

        joined_field = events_table.fields.get("some_field")
        assert joined_field is None

    def test_serialize_database_warehouse_table_s3_with_hyphens(self):
        credentials = DataWarehouseCredential.objects.create(access_key="blah", access_secret="blah", team=self.team)
        DataWarehouseTable.objects.create(
            name="table_1",
            format="Parquet",
            team=self.team,
            credential=credentials,
            url_pattern="https://bucket.s3/data/*",
            columns={
                "id-hype": {"hogql": "StringDatabaseField", "clickhouse": "Nullable(String)", "schema_valid": True}
            },
            row_count=100,
        )

        database = create_hogql_database(team=self.team)

        serialized_database = serialize_database(HogQLContext(team_id=self.team.pk, database=database))

        table = cast(DatabaseSchemaDataWarehouseTable | None, serialized_database.get("table_1"))
        assert table is not None
        assert table.row_count == 100

        field = table.fields.get("id-hype")
        assert field is not None
        assert field.name == "id-hype"
        assert field.hogql_value == "`id-hype`"

    def test_serialize_database_warehouse_table_source(self):
        source = ExternalDataSource.objects.create(
            team=self.team,
            source_id="source_id",
            connection_id="connection_id",
            status=ExternalDataSource.Status.COMPLETED,
            source_type=ExternalDataSource.Type.STRIPE,
        )
        credentials = DataWarehouseCredential.objects.create(access_key="blah", access_secret="blah", team=self.team)
        warehouse_table = DataWarehouseTable.objects.create(
            name="stripe_table_1",
            format="Parquet",
            team=self.team,
            external_data_source=source,
            external_data_source_id=source.id,
            credential=credentials,
            url_pattern="https://bucket.s3/data/*",
            columns={"id": {"hogql": "StringDatabaseField", "clickhouse": "Nullable(String)", "schema_valid": True}},
        )
        schema = ExternalDataSchema.objects.create(
            team=self.team,
            name="table_1",
            source=source,
            table=warehouse_table,
            should_sync=True,
            last_synced_at="2024-01-01",
            # No status but should be completed because a data warehouse table already exists
        )

        database = create_hogql_database(team=self.team)

        serialized_database = serialize_database(HogQLContext(team_id=self.team.pk, database=database))

        table = cast(DatabaseSchemaDataWarehouseTable | None, serialized_database.get("stripe.table_1"))
        assert table is not None
        assert len(table.fields.keys()) == 1

        assert table.source is not None
        assert table.source.id == source.source_id
        assert table.source.status == "Completed"
        assert table.source.source_type == "Stripe"

        assert table.schema_ is not None
        assert table.schema_.id == str(schema.id)
        assert table.schema_.name == "table_1"
        assert table.schema_.should_sync is True
        assert table.schema_.incremental is False
        assert table.schema_.status is None
        assert table.schema_.last_synced_at == "2024-01-01 00:00:00+00:00"

        field = table.fields.get("id")
        assert field is not None
        assert field.name == "id"
        assert field.hogql_value == "id"
        assert field.type == "string"
        assert field.schema_valid is True

    def test_serialize_database_warehouse_table_source_query_count(self):
        source = ExternalDataSource.objects.create(
            team=self.team,
            source_id="source_id_1",
            connection_id="connection_id_1",
            status=ExternalDataSource.Status.COMPLETED,
            source_type=ExternalDataSource.Type.STRIPE,
        )
        credentials = DataWarehouseCredential.objects.create(access_key="blah", access_secret="blah", team=self.team)
        warehouse_table = DataWarehouseTable.objects.create(
            name="table_1",
            format="Parquet",
            team=self.team,
            external_data_source=source,
            external_data_source_id=source.id,
            credential=credentials,
            url_pattern="https://bucket.s3/data/*",
            columns={"id": {"hogql": "StringDatabaseField", "clickhouse": "Nullable(String)", "schema_valid": True}},
        )
        ExternalDataSchema.objects.create(
            team=self.team,
            name="table_1",
            source=source,
            table=warehouse_table,
            should_sync=True,
            last_synced_at="2024-01-01",
        )

        database = create_hogql_database(team=self.team)

        with self.assertNumQueries(3):
            serialize_database(HogQLContext(team_id=self.team.pk, database=database))

        for i in range(5):
            source = ExternalDataSource.objects.create(
                team=self.team,
                source_id=f"source_id_{i + 2}",
                connection_id=f"connection_id_{i + 2}",
                status=ExternalDataSource.Status.COMPLETED,
                source_type=ExternalDataSource.Type.STRIPE,
            )
            warehouse_table = DataWarehouseTable.objects.create(
                name=f"table_{i + 2}",
                format="Parquet",
                team=self.team,
                external_data_source=source,
                external_data_source_id=source.id,
                credential=credentials,
                url_pattern="https://bucket.s3/data/*",
                columns={
                    "id": {"hogql": "StringDatabaseField", "clickhouse": "Nullable(String)", "schema_valid": True}
                },
            )
            ExternalDataSchema.objects.create(
                team=self.team,
                name=f"table_{i + 2}",
                source=source,
                table=warehouse_table,
                should_sync=True,
                last_synced_at="2024-01-01",
            )

        database = create_hogql_database(team=self.team)

        with self.assertNumQueries(3):
            serialize_database(HogQLContext(team_id=self.team.pk, database=database))

    @patch("posthog.hogql.query.sync_execute", return_value=([], []))
    @pytest.mark.usefixtures("unittest_snapshot")
    def test_database_with_warehouse_tables(self, patch_execute):
        credential = DataWarehouseCredential.objects.create(
            team=self.team, access_key="_accesskey", access_secret="_secret"
        )
        DataWarehouseTable.objects.create(
            name="whatever",
            team=self.team,
            columns={"id": "String"},
            credential=credential,
            url_pattern="",
        )
        create_hogql_database(team=self.team)

        response = execute_hogql_query(
            "select * from whatever",
            team=self.team,
            pretty=False,
        )

        self.assertEqual(
            response.clickhouse,
            f"SELECT whatever.id AS id FROM s3(%(hogql_val_0_sensitive)s, %(hogql_val_3_sensitive)s, %(hogql_val_4_sensitive)s, %(hogql_val_1)s, %(hogql_val_2)s) AS whatever LIMIT 100 SETTINGS readonly=2, max_execution_time=60, allow_experimental_object_type=1, format_csv_allow_double_quotes=0, max_ast_elements=4000000, max_expanded_ast_elements=4000000, max_bytes_before_external_group_by=0, transform_null_in=1, optimize_min_equality_disjunction_chain_length=4294967295, allow_experimental_join_condition=1",
        )

    def test_database_group_type_mappings(self):
        GroupTypeMapping.objects.create(
            team=self.team, project_id=self.team.project_id, group_type="test", group_type_index=0
        )
        db = create_hogql_database(team=self.team)

        assert db.events.fields["test"] == FieldTraverser(chain=["group_0"])

    def test_database_group_type_mappings_overwrite(self):
        GroupTypeMapping.objects.create(
            team=self.team, project_id=self.team.project_id, group_type="event", group_type_index=0
        )
        db = create_hogql_database(team=self.team)

        assert db.events.fields["event"] == StringDatabaseField(name="event", nullable=False)

    def test_database_expression_fields(self):
        db = create_hogql_database(team=self.team)
        db.numbers.fields["expression"] = ExpressionField(name="expression", expr=parse_expr("1 + 1"))
        db.numbers.fields["double"] = ExpressionField(name="double", expr=parse_expr("number * 2"))
        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
            modifiers=create_default_modifiers_for_team(self.team),
        )

        sql = "select number, double, expression + number from numbers(2)"
        query = print_ast(parse_select(sql), context, dialect="clickhouse")
        assert (
            query
            == f"SELECT numbers.number AS number, multiply(numbers.number, 2) AS double, plus(plus(1, 1), numbers.number) FROM numbers(2) AS numbers LIMIT {MAX_SELECT_RETURNED_ROWS}"
        ), query

        sql = "select double from (select double from numbers(2))"
        query = print_ast(parse_select(sql), context, dialect="clickhouse")
        assert (
            query
            == f"SELECT double AS double FROM (SELECT multiply(numbers.number, 2) AS double FROM numbers(2) AS numbers) LIMIT {MAX_SELECT_RETURNED_ROWS}"
        ), query

        # expression fields are not included in select *
        sql = "select * from (select * from numbers(2))"
        query = print_ast(parse_select(sql), context, dialect="clickhouse")
        assert (
            query
            == f"SELECT number AS number, expression AS expression, double AS double FROM (SELECT numbers.number AS number, plus(1, 1) AS expression, multiply(numbers.number, 2) AS double FROM numbers(2) AS numbers) LIMIT {MAX_SELECT_RETURNED_ROWS}"
        ), query

    def test_database_warehouse_joins(self):
        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="events",
            source_table_key="event",
            joining_table_name="groups",
            joining_table_key="key",
            field_name="some_field",
        )

        db = create_hogql_database(team=self.team)
        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
        )

        sql = "select some_field.key from events"
        print_ast(parse_select(sql), context, dialect="clickhouse")

    def test_database_warehouse_joins_deleted_join(self):
        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="events",
            source_table_key="lower(event)",
            joining_table_name="groups",
            joining_table_key="upper(key)",
            field_name="some_field",
            deleted=True,
        )

        db = create_hogql_database(team=self.team)
        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
        )

        sql = "select some_field.key from events"
        with pytest.raises(ExposedHogQLError):
            print_ast(parse_select(sql), context, dialect="clickhouse")

    def test_database_warehouse_joins_other_team(self):
        other_organization = Organization.objects.create(name="some_other_org")
        other_team = Team.objects.create(organization=other_organization)

        DataWarehouseJoin.objects.create(
            team=other_team,
            source_table_name="events",
            source_table_key="lower(event)",
            joining_table_name="groups",
            joining_table_key="upper(key)",
            field_name="some_field",
        )

        db = create_hogql_database(team=self.team)
        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
        )

        sql = "select some_field.key from events"
        with pytest.raises(ExposedHogQLError):
            print_ast(parse_select(sql), context, dialect="clickhouse")

    def test_database_warehouse_joins_bad_key_expression(self):
        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="events",
            source_table_key="blah_de_blah(event)",
            joining_table_name="groups",
            joining_table_key="upper(key)",
            field_name="some_field",
        )

        create_hogql_database(team=self.team)

    @override_settings(PERSON_ON_EVENTS_OVERRIDE=False, PERSON_ON_EVENTS_V2_OVERRIDE=False)
    def test_database_warehouse_joins_persons_no_poe(self):
        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="persons",
            source_table_key="properties.email",
            joining_table_name="groups",
            joining_table_key="key",
            field_name="some_field",
        )

        db = create_hogql_database(team=self.team)
        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
        )

        pdi = cast(LazyJoin, db.events.fields["pdi"])
        pdi_persons_join = cast(LazyJoin, pdi.resolve_table(context).fields["person"])
        pdi_table = pdi_persons_join.resolve_table(context)

        assert pdi_table.fields["some_field"] is not None

        print_ast(parse_select("select person.some_field.key from events"), context, dialect="clickhouse")

    @override_settings(PERSON_ON_EVENTS_OVERRIDE=True, PERSON_ON_EVENTS_V2_OVERRIDE=False)
    def test_database_warehouse_joins_persons_poe_v1(self):
        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="persons",
            source_table_key="properties.email",
            joining_table_name="groups",
            joining_table_key="key",
            field_name="some_field",
        )

        db = create_hogql_database(team=self.team)
        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
        )

        poe = cast(Table, db.events.fields["poe"])

        assert poe.fields["some_field"] is not None

        print_ast(parse_select("select person.some_field.key from events"), context, dialect="clickhouse")

    @override_settings(PERSON_ON_EVENTS_OVERRIDE=False, PERSON_ON_EVENTS_V2_OVERRIDE=True)
    @pytest.mark.usefixtures("unittest_snapshot")
    def test_database_warehouse_joins_persons_poe_v2(self):
        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="persons",
            source_table_key="properties.email",
            joining_table_name="groups",
            joining_table_key="key",
            field_name="some_field",
        )

        db = create_hogql_database(team=self.team)
        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
        )

        poe = cast(Table, db.events.fields["poe"])

        assert poe.fields["some_field"] is not None

        printed = print_ast(parse_select("select person.some_field.key from events"), context, dialect="clickhouse")

        assert pretty_print_in_tests(printed, self.team.pk) == self.snapshot

    @override_settings(PERSON_ON_EVENTS_OVERRIDE=False, PERSON_ON_EVENTS_V2_OVERRIDE=True)
    @pytest.mark.usefixtures("unittest_snapshot")
    def test_database_warehouse_joins_persons_poe_v2_source_key_ast_call(self):
        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="persons",
            source_table_key="toString(properties.email)",
            joining_table_name="groups",
            joining_table_key="key",
            field_name="some_field",
        )

        db = create_hogql_database(team=self.team)
        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
        )

        poe = cast(Table, db.events.fields["poe"])

        assert poe.fields["some_field"] is not None

        printed = print_ast(parse_select("select person.some_field.key from events"), context, dialect="clickhouse")

        assert pretty_print_in_tests(printed, self.team.pk) == self.snapshot

    def test_database_warehouse_joins_on_view(self):
        DataWarehouseSavedQuery.objects.create(
            team=self.team,
            name="event_view",
            query={"query": "SELECT event AS event from events"},
            columns={"event": "String"},
        )
        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="event_view",
            source_table_key="event",
            joining_table_name="groups",
            joining_table_key="key",
            field_name="some_field",
        )

        db = create_hogql_database(team=self.team)
        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
        )

        sql = "select event_view.some_field.key from event_view"
        print_ast(parse_select(sql), context, dialect="clickhouse")

        sql = "select some_field.key from event_view"
        print_ast(parse_select(sql), context, dialect="clickhouse")

        sql = "select e.some_field.key from event_view as e"
        print_ast(parse_select(sql), context, dialect="clickhouse")

    def test_selecting_from_persons_ignores_future_persons(self):
        db = create_hogql_database(team=self.team)
        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
            modifiers=create_default_modifiers_for_team(self.team),
        )
        sql = "select id from persons"
        query = print_ast(parse_select(sql), context, dialect="clickhouse")
        assert (
            "ifNull(less(argMax(toTimeZone(person.created_at, %(hogql_val_0)s), person.version), plus(now64(6, %(hogql_val_1)s), toIntervalDay(1)))"
            in query
        ), query

    def test_selecting_persons_from_events_ignores_future_persons(self):
        db = create_hogql_database(team=self.team)
        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
            # disable PoE
            modifiers=create_default_modifiers_for_team(
                self.team, HogQLQueryModifiers(personsOnEventsMode=PersonsOnEventsMode.DISABLED)
            ),
        )
        sql = "select person.id from events"
        query = print_ast(parse_select(sql), context, dialect="clickhouse")
        assert (
            "ifNull(less(argMax(toTimeZone(person.created_at, %(hogql_val_0)s), person.version), plus(now64(6, %(hogql_val_1)s), toIntervalDay(1)))"
            in query
        ), query

    def test_database_credentials_is_not_n_plus_1(self) -> None:
        for i in range(10):
            # we keep adding credentials and tables, number of queries should be stable
            credentials = DataWarehouseCredential.objects.create(
                access_key=f"blah-{i}", access_secret="blah", team=self.team
            )
            DataWarehouseTable.objects.create(
                name=f"table_{i}",
                format="Parquet",
                team=self.team,
                credential=credentials,
                url_pattern="https://bucket.s3/data/*",
                columns={
                    "id": {"hogql": "StringDatabaseField", "clickhouse": "Nullable(String)", "schema_valid": True}
                },
            )

            with self.assertNumQueries(FuzzyInt(5, 7)):
                create_hogql_database(team=self.team)

    # We keep adding sources, credentials and tables, number of queries should be stable
    def test_external_data_source_is_not_n_plus_1(self) -> None:
        num_queries = FuzzyInt(5, 10)

        for i in range(10):
            source = ExternalDataSource.objects.create(
                team=self.team,
                source_id=f"source_id_{i}",
                connection_id=f"connection_id_{i}",
                status=ExternalDataSource.Status.COMPLETED,
                source_type=ExternalDataSource.Type.STRIPE,
            )
            credentials = DataWarehouseCredential.objects.create(
                access_key=f"blah-{i}", access_secret="blah", team=self.team
            )
            warehouse_table = DataWarehouseTable.objects.create(
                name=f"table_{i}",
                format="Parquet",
                team=self.team,
                external_data_source=source,
                external_data_source_id=source.id,
                credential=credentials,
                url_pattern="https://bucket.s3/data/*",
                columns={
                    "id": {"hogql": "StringDatabaseField", "clickhouse": "Nullable(String)", "schema_valid": True}
                },
            )
            ExternalDataSchema.objects.create(
                team=self.team,
                name=f"table_{i}",
                source=source,
                table=warehouse_table,
                should_sync=True,
                last_synced_at="2024-01-01",
            )

            with self.assertNumQueries(num_queries):
                create_hogql_database(team=self.team)

    def test_database_warehouse_joins_persons_poe_old_properties(self):
        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="persons",
            source_table_key="properties.email",
            joining_table_name="groups",
            joining_table_key="key",
            field_name="some_field",
        )

        db = create_hogql_database(team=self.team)

        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
        )

        person_on_event_table = cast(LazyJoin, db.events.fields["person"])
        assert "some_field" in person_on_event_table.join_table.fields.keys()  # type: ignore

        print_ast(parse_select("select person.some_field.key from events"), context, dialect="clickhouse")

    def test_database_warehouse_person_id_field_with_events_join(self):
        credentials = DataWarehouseCredential.objects.create(
            access_key="test_key", access_secret="test_secret", team=self.team
        )
        DataWarehouseTable.objects.create(
            name="warehouse_table",
            format="Parquet",
            team=self.team,
            credential=credentials,
            url_pattern="s3://test/*",
            columns={"id": "String", "user_id": "String", "timestamp": "DateTime64(3, 'UTC')"},
        )
        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="warehouse_table",
            source_table_key="user_id",
            joining_table_name="events",
            joining_table_key="distinct_id",
            field_name="events_data",
        )
        modifiers = HogQLQueryModifiers(
            dataWarehouseEventsModifiers=[
                DataWarehouseEventsModifier(
                    table_name="warehouse_table",
                    id_field="id",
                    timestamp_field="timestamp",
                    distinct_id_field="user_id",
                )
            ]
        )
        db = create_hogql_database(team=self.team, modifiers=modifiers)

        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
        )

        actual_table = db.get_table("warehouse_table")
        person_id_field = actual_table.fields.get("person_id")

        assert isinstance(person_id_field, FieldTraverser)
        assert person_id_field.chain == ["events_data", "person_id"]

        print_ast(parse_select("SELECT person_id FROM warehouse_table"), context, dialect="clickhouse")

    def test_data_warehouse_events_modifiers_with_dot_notation(self):
        credentials = DataWarehouseCredential.objects.create(
            access_key="test_key", access_secret="test_secret", team=self.team
        )
        source = ExternalDataSource.objects.create(
            team=self.team,
            source_id="source_id",
            source_type=ExternalDataSource.Type.STRIPE,
        )
        DataWarehouseTable.objects.create(
            name="stripe_table",
            format="Parquet",
            team=self.team,
            credential=credentials,
            external_data_source=source,
            url_pattern="s3://test/*",
            columns={"id": "String", "customer_id": "String", "created": "DateTime64(3, 'UTC')"},
        )

        # Table should be accessible via dot notation (stripe.table)
        modifiers = HogQLQueryModifiers(
            dataWarehouseEventsModifiers=[
                DataWarehouseEventsModifier(
                    table_name="stripe.table",
                    id_field="id",
                    timestamp_field="created",
                    distinct_id_field="customer_id",
                )
            ]
        )

        db = create_hogql_database(team=self.team, modifiers=modifiers)

        stripe_table = db.get_table("stripe.table")
        assert isinstance(stripe_table, Table)

        # Ensure the correct table was retrieved by checking the original table name in dot notation mapping
        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
        )

        # Doesn't throw
        print_ast(parse_select("SELECT id, timestamp, distinct_id FROM stripe.table"), context, dialect="clickhouse")

    def test_database_warehouse_resolve_field_through_linear_joins_basic_join(self):
        credentials = DataWarehouseCredential.objects.create(
            access_key="test_key", access_secret="test_secret", team=self.team
        )

        DataWarehouseTable.objects.create(
            team=self.team,
            name="subscriptions",
            columns={
                "id": "String",
                "created_at": "DateTime64(3, 'UTC')",
                "customer_id": "String",
            },
            credential=credentials,
            url_pattern="s3://test/*",
            format=DataWarehouseTable.TableFormat.Parquet,
        )

        DataWarehouseTable.objects.create(
            team=self.team,
            name="customers",
            columns={
                "id": "String",
                "email": "String",
            },
            credential=credentials,
            url_pattern="s3://test/*",
            format=DataWarehouseTable.TableFormat.Parquet,
        )

        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="subscriptions",
            source_table_key="customer_id",
            joining_table_name="customers",
            joining_table_key="id",
            field_name="customer",
        )

        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="customers",
            source_table_key="email",
            joining_table_name="events",
            joining_table_key="person.properties.email",
            field_name="events",
        )

        db = create_hogql_database(team=self.team)

        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
        )

        print_ast(parse_select("SELECT customer.events.distinct_id FROM subscriptions"), context, dialect="clickhouse")

    def test_database_warehouse_resolve_field_through_nested_joins_basic_join(self):
        credentials = DataWarehouseCredential.objects.create(
            access_key="test_key", access_secret="test_secret", team=self.team
        )

        DataWarehouseTable.objects.create(
            team=self.team,
            name="subscriptions",
            columns={
                "id": "String",
                "created_at": "DateTime64(3, 'UTC')",
                "customer_id": "String",
            },
            credential=credentials,
            url_pattern="s3://test/*",
            format=DataWarehouseTable.TableFormat.Parquet,
        )

        DataWarehouseTable.objects.create(
            team=self.team,
            name="customers",
            columns={
                "id": "String",
                "email": "String",
            },
            credential=credentials,
            url_pattern="s3://test/*",
            format=DataWarehouseTable.TableFormat.Parquet,
        )

        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="subscriptions",
            source_table_key="customer_id",
            joining_table_name="customers",
            joining_table_key="id",
            field_name="customer",
        )

        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="subscriptions",
            source_table_key="customer.email",
            joining_table_name="events",
            joining_table_key="person.properties.email",
            field_name="events",
        )

        db = create_hogql_database(team=self.team)

        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
        )

        print_ast(parse_select("SELECT events.distinct_id FROM subscriptions"), context, dialect="clickhouse")

    def test_database_warehouse_resolve_field_through_nested_joins_experiments_optimized_events_join(self):
        credentials = DataWarehouseCredential.objects.create(
            access_key="test_key", access_secret="test_secret", team=self.team
        )

        DataWarehouseTable.objects.create(
            team=self.team,
            name="subscriptions",
            columns={
                "id": "String",
                "created_at": "DateTime64(3, 'UTC')",
                "customer_id": "String",
            },
            credential=credentials,
            url_pattern="s3://test/*",
            format=DataWarehouseTable.TableFormat.Parquet,
        )

        DataWarehouseTable.objects.create(
            team=self.team,
            name="customers",
            columns={
                "id": "String",
                "email": "String",
            },
            credential=credentials,
            url_pattern="s3://test/*",
            format=DataWarehouseTable.TableFormat.Parquet,
        )

        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="subscriptions",
            source_table_key="customer_id",
            joining_table_name="customers",
            joining_table_key="id",
            field_name="customer",
        )

        DataWarehouseJoin.objects.create(
            team=self.team,
            source_table_name="subscriptions",
            source_table_key="customer.email",
            joining_table_name="events",
            joining_table_key="person.properties.email",
            field_name="events",
            configuration={"experiments_optimized": True, "experiments_timestamp_key": "created_at"},
        )

        db = create_hogql_database(team=self.team)

        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            database=db,
        )

        print_ast(parse_select("SELECT events.distinct_id FROM subscriptions"), context, dialect="clickhouse")
