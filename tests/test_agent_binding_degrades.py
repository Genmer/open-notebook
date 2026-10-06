"""Dangling chat_session agent references degrade to the default assistant.

PDR-004 says a session's `agent` id is best-effort: a deleted agent must never
stuck a history session. Post ADR-013, `ObjectModel.get` raises
InvalidInputError for ids that no longer resolve to the agent table (schema
drift / foreign garbage) in addition to NotFoundError for deleted rows — both
must degrade to None instead of leaking out of resolve_agent_binding.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from api.routers._chat_shared import resolve_agent_binding
from open_notebook.domain.agent import Agent
from open_notebook.exceptions import InvalidInputError, NotFoundError


def _agent(**overrides) -> Agent:
    data = dict(
        id="agent:1",
        name="Researcher",
        system_prompt="Answer with academic rigor.",
        description=None,
        model="model:gpt",
        temperature=0.2,
        max_tokens=1024,
        enabled=True,
        sort_order=0,
        created=datetime(2026, 1, 1, 12, 0, 0),
        updated=datetime(2026, 1, 1, 12, 0, 0),
    )
    data.update(overrides)
    return Agent(**data)


@pytest.mark.asyncio
async def test_none_agent_id_returns_none():
    assert await resolve_agent_binding(None) is None


@pytest.mark.asyncio
async def test_deleted_agent_not_found_error_degrades_to_none():
    with patch(
        "open_notebook.domain.agent.Agent.get",
        new=AsyncMock(side_effect=NotFoundError("agent:gone")),
    ):
        assert await resolve_agent_binding("agent:gone") is None


@pytest.mark.asyncio
async def test_garbage_agent_id_invalid_input_error_degrades_to_none():
    # Pre-ADR-013 this escaped as an unhandled error and failed the request.
    with patch(
        "open_notebook.domain.agent.Agent.get",
        new=AsyncMock(side_effect=InvalidInputError("invalid table:id")),
    ):
        assert await resolve_agent_binding("garbage:not-a-table-id") is None


@pytest.mark.asyncio
async def test_disabled_agent_degrades_to_none():
    with patch(
        "open_notebook.domain.agent.Agent.get",
        new=AsyncMock(return_value=_agent(enabled=False)),
    ):
        assert await resolve_agent_binding("agent:1") is None


@pytest.mark.asyncio
async def test_enabled_agent_is_returned_as_is():
    agent = _agent(enabled=True)
    with patch(
        "open_notebook.domain.agent.Agent.get",
        new=AsyncMock(return_value=agent),
    ):
        assert await resolve_agent_binding("agent:1") is agent
