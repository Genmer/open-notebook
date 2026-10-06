"""Pure-function tests for extract_chat_messages' tolerant kwargs reading.

The timestamp (`created_at`) and `message_kind` fields ride
additional_kwargs on raw LangChain messages. Legacy messages carry neither;
malformed values must degrade to None instead of breaking history loading
(the GET-session endpoint serves every message through this function).
"""

from langchain_core.messages import AIMessage, HumanMessage

from api.routers._chat_shared import ChatMessage, extract_chat_messages


def test_created_at_and_message_kind_map_through():
    messages = extract_chat_messages(
        [
            HumanMessage(
                content="q",
                additional_kwargs={"created_at": "2026-10-07T01:02:03+00:00"},
            ),
            AIMessage(
                content="a",
                additional_kwargs={
                    "created_at": "2026-10-07T01:02:04+00:00",
                    "message_kind": "summary",
                    "model_name": "m1",
                },
            ),
        ]
    )
    assert messages[0].timestamp == "2026-10-07T01:02:03+00:00"
    assert messages[0].message_kind is None
    assert messages[1].timestamp == "2026-10-07T01:02:04+00:00"
    assert messages[1].message_kind == "summary"
    assert messages[1].model_name == "m1"


def test_missing_kwargs_yield_none():
    messages = extract_chat_messages(
        [HumanMessage(content="q"), AIMessage(content="a")]
    )
    assert all(m.timestamp is None for m in messages)
    assert all(m.message_kind is None for m in messages)


def test_empty_string_kwargs_yield_none():
    messages = extract_chat_messages(
        [
            HumanMessage(
                content="q", additional_kwargs={"created_at": "", "message_kind": ""}
            )
        ]
    )
    assert messages[0].timestamp is None
    assert messages[0].message_kind is None


def test_malformed_kwargs_yield_none_without_raising():
    messages = extract_chat_messages(
        [
            HumanMessage(
                content="q",
                additional_kwargs={
                    "created_at": 12345,  # non-string
                    "message_kind": ["summary"],  # non-string
                },
            ),
            HumanMessage(
                content="q2",
                additional_kwargs={"created_at": None, "message_kind": None},
            ),
        ]
    )
    assert all(m.timestamp is None for m in messages)
    assert all(m.message_kind is None for m in messages)


def test_none_additional_kwargs_mapping_untouched():
    """Legacy fields (model_name etc.) keep flowing; empty-kwargs messages
    behave exactly as before the change."""
    messages = extract_chat_messages(
        [
            AIMessage(
                content="a",
                additional_kwargs={
                    "model_name": "m",
                    "group_id": "g",
                    "run_role": "answer",
                },
            )
        ]
    )
    assert isinstance(messages[0], ChatMessage)
    assert messages[0].model_name == "m"
    assert messages[0].group_id == "g"
    assert messages[0].run_role == "answer"
    assert messages[0].timestamp is None
    assert messages[0].message_kind is None
