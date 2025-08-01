from datetime import datetime
import re
from typing import Any, Optional, Union
import uuid

from django.core.exceptions import ValidationError
from django.db import models
from django.conf import settings

from posthog.hogql import ast
from posthog.hogql.database.database import Database
from posthog.hogql.database.models import FieldOrTable, SavedQuery
from posthog.models.team import Team
from posthog.models.utils import CreatedMetaFields, DeletedMetaFields, UUIDModel
from posthog.schema import HogQLQueryModifiers
from posthog.warehouse.models.util import (
    CLICKHOUSE_HOGQL_MAPPING,
    STR_TO_HOGQL_MAPPING,
    clean_type,
    remove_named_tuples,
)
from posthog.hogql.database.s3_table import S3Table
from posthog.sync import database_sync_to_async
from dlt.common.normalizers.naming.snake_case import NamingConvention


def validate_saved_query_name(value):
    if not re.match(r"^[A-Za-z_$][A-Za-z0-9_.$]*$", value):
        raise ValidationError(
            f"{value} is not a valid view name. View names can only contain letters, numbers, '_', '.', or '$' ",
            params={"value": value},
        )

    # This doesnt protect us from naming a table the same as a warehouse table
    database = Database()
    all_keys = list(vars(database).keys())
    table_names = [key for key in all_keys if isinstance(getattr(database, key), ast.Table)]

    if value in table_names:
        raise ValidationError(
            f"{value} is not a valid view name. View names cannot overlap with PostHog table names.",
            params={"value": value},
        )


class DataWarehouseSavedQuery(CreatedMetaFields, UUIDModel, DeletedMetaFields):
    class Status(models.TextChoices):
        """Possible states of this SavedQuery."""

        CANCELLED = "Cancelled"
        MODIFIED = "Modified"  # if the model definition has changed and hasn't been materialized since
        COMPLETED = "Completed"
        FAILED = "Failed"
        RUNNING = "Running"

    name = models.CharField(max_length=128, validators=[validate_saved_query_name])
    team = models.ForeignKey(Team, on_delete=models.CASCADE)
    latest_error = models.TextField(default=None, null=True, blank=True)
    columns = models.JSONField(
        default=dict,
        null=True,
        blank=True,
        help_text="Dict of all columns with ClickHouse type (including Nullable())",
    )
    external_tables = models.JSONField(default=list, null=True, blank=True, help_text="List of all external tables")
    query = models.JSONField(default=dict, null=True, blank=True, help_text="HogQL query")
    status = models.CharField(
        null=True, choices=Status.choices, max_length=64, help_text="The status of when this SavedQuery last ran."
    )
    last_run_at = models.DateTimeField(
        null=True,
        help_text="The timestamp of this SavedQuery's last run (if any).",
    )
    sync_frequency_interval = models.DurationField(default=None, null=True, blank=True)

    table = models.ForeignKey("posthog.DataWarehouseTable", on_delete=models.SET_NULL, null=True, blank=True)
    # The name of the view at the time of soft deletion
    deleted_name = models.CharField(max_length=128, default=None, null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["team", "name"],
                name="posthog_datawarehouse_saved_query_unique_name",
            )
        ]

    @property
    def name_chain(self) -> list[str]:
        return self.name.split(".")

    def soft_delete(self):
        self.deleted = True
        self.deleted_at = datetime.now()
        self.deleted_name = self.name
        self.name = f"POSTHOG_DELETED_{uuid.uuid4()}"

        self.save()

    def get_columns(self) -> dict[str, dict[str, Any]]:
        from posthog.api.services.query import process_query_dict
        from posthog.hogql_queries.query_runner import ExecutionMode

        response = process_query_dict(self.team, self.query, execution_mode=ExecutionMode.CALCULATE_BLOCKING_ALWAYS)
        result = getattr(response, "types", [])

        if result is None or isinstance(result, int):
            raise Exception("No columns types provided by clickhouse in get_columns")

        columns = {
            str(item[0]): {
                "hogql": CLICKHOUSE_HOGQL_MAPPING[clean_type(str(item[1]))].__name__,
                "clickhouse": item[1],
                "valid": True,
            }
            for item in result
        }

        return columns

    def get_clickhouse_column_type(self, column_name: str) -> Optional[str]:
        clickhouse_type = self.columns.get(column_name, None)

        if isinstance(clickhouse_type, dict) and self.columns[column_name].get("clickhouse"):
            clickhouse_type = self.columns[column_name].get("clickhouse")

            if clickhouse_type.startswith("Nullable("):
                clickhouse_type = clickhouse_type.replace("Nullable(", "")[:-1]

        return clickhouse_type

    @property
    def s3_tables(self):
        from posthog.hogql.context import HogQLContext
        from posthog.hogql.database.database import create_hogql_database
        from posthog.hogql.parser import parse_select
        from posthog.hogql.query import create_default_modifiers_for_team
        from posthog.hogql.resolver import resolve_types
        from posthog.models.property.util import S3TableVisitor

        context = HogQLContext(
            team_id=self.team.pk,
            enable_select_queries=True,
            modifiers=create_default_modifiers_for_team(self.team),
        )
        node = parse_select(self.query["query"])
        context.database = create_hogql_database(context.team_id)

        node = resolve_types(node, context, dialect="clickhouse")
        table_collector = S3TableVisitor()
        table_collector.visit(node)

        return list(table_collector.tables)

    @property
    def folder_path(self):
        return f"team_{self.team.pk}_model_{self.id.hex}/modeling"

    @property
    def normalized_name(self):
        return NamingConvention().normalize_identifier(self.name)

    @property
    def url_pattern(self):
        return f"https://{settings.AIRBYTE_BUCKET_DOMAIN}/dlt/team_{self.team.pk}_model_{self.id.hex}/modeling/{self.normalized_name}"

    @property
    def is_materialized(self):
        return self.table is not None and (
            self.status == DataWarehouseSavedQuery.Status.COMPLETED or self.last_run_at is not None
        )

    def hogql_definition(self, modifiers: Optional[HogQLQueryModifiers] = None) -> Union[SavedQuery, S3Table]:
        if self.table is not None and self.is_materialized and modifiers is not None and modifiers.useMaterializedViews:
            return self.table.hogql_definition(modifiers)

        columns = self.columns or {}
        fields: dict[str, FieldOrTable] = {}

        from posthog.warehouse.models.table import CLICKHOUSE_HOGQL_MAPPING

        for column, type in columns.items():
            # Support for 'old' style columns
            if isinstance(type, str):
                clickhouse_type = type
            elif isinstance(type, dict):
                clickhouse_type = type["clickhouse"]
            else:
                raise Exception(f"Unknown column type: {type}")  # Never reached

            if clickhouse_type.startswith("Nullable("):
                clickhouse_type = clickhouse_type.replace("Nullable(", "")[:-1]

            # TODO: remove when addressed https://github.com/ClickHouse/ClickHouse/issues/37594
            if clickhouse_type.startswith("Array("):
                clickhouse_type = remove_named_tuples(clickhouse_type)

            # Support for 'old' style columns
            if isinstance(type, str):
                hogql_type_str = clickhouse_type.partition("(")[0]
                hogql_type = CLICKHOUSE_HOGQL_MAPPING[hogql_type_str]
            elif isinstance(type, dict):
                hogql_type = STR_TO_HOGQL_MAPPING[type["hogql"]]
            else:
                raise Exception(f"Unknown column type: {type}")  # Never reached

            fields[column] = hogql_type(name=column)

        return SavedQuery(
            id=str(self.id),
            name=self.name,
            query=self.query["query"],
            fields=fields,
        )


@database_sync_to_async
def aget_saved_query_by_id(saved_query_id: str, team_id: int) -> DataWarehouseSavedQuery | None:
    return (
        DataWarehouseSavedQuery.objects.prefetch_related("team")
        .exclude(deleted=True)
        .get(id=saved_query_id, team_id=team_id)
    )


@database_sync_to_async
def asave_saved_query(saved_query: DataWarehouseSavedQuery) -> None:
    saved_query.save()


@database_sync_to_async
def aget_table_by_saved_query_id(saved_query_id: str, team_id: int):
    return DataWarehouseSavedQuery.objects.exclude(deleted=True).get(id=saved_query_id, team_id=team_id).table
