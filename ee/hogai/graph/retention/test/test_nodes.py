from unittest.mock import patch

from langchain_core.runnables import RunnableLambda

from ee.hogai.graph.retention.nodes import RetentionGeneratorNode, RetentionSchemaGeneratorOutput
from ee.hogai.utils.types import AssistantState, PartialAssistantState
from posthog.models import Action
from posthog.schema import (
    AssistantRetentionActionsNode,
    AssistantRetentionEventsNode,
    AssistantRetentionFilter,
    AssistantRetentionQuery,
    HumanMessage,
    VisualizationMessage,
)
from posthog.test.base import BaseTest


class TestRetentionGeneratorNode(BaseTest):
    maxDiff = None

    def setUp(self):
        super().setUp()
        self.action = Action.objects.create(team=self.team, name="Test Action")
        self.schema = AssistantRetentionQuery(
            retentionFilter=AssistantRetentionFilter(
                targetEntity=AssistantRetentionEventsNode(name="targetEntity"),
                returningEntity=AssistantRetentionActionsNode(name=self.action.name, id=self.action.id),
            )
        )

    async def test_node_runs(self):
        node = RetentionGeneratorNode(self.team, self.user)
        with patch.object(RetentionGeneratorNode, "_model") as generator_model_mock:
            generator_model_mock.return_value = RunnableLambda(
                lambda _: RetentionSchemaGeneratorOutput(query=self.schema).model_dump()
            )
            new_state = await node.arun(
                AssistantState(
                    messages=[HumanMessage(content="Text")],
                    plan="Plan",
                    root_tool_insight_plan="question",
                ),
                {},
            )
            self.assertEqual(
                new_state,
                PartialAssistantState(
                    messages=[
                        VisualizationMessage(
                            query="question", answer=self.schema, plan="Plan", id=new_state.messages[0].id
                        )
                    ],
                    intermediate_steps=None,
                    plan=None,
                    rag_context=None,
                ),
            )
