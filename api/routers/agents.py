"""Agent configuration CRUD (PDR-004).

Agents are predefined chat personas. Deletion is deliberately non-cascading:
sessions keep the raw agent id in ``chat_session.agent`` and the chat execute
chain degrades dangling ids to the default assistant, so this router never
touches chat_session.
"""

from typing import Any, Dict, List, Optional

from ai_prompter import Prompter
from fastapi import APIRouter, HTTPException, Query
from langchain_core.messages import HumanMessage
from loguru import logger

from api.models import (
    AgentCreate,
    AgentResponse,
    AgentUpdate,
    PolishPromptRequest,
    PolishPromptResponse,
)
from open_notebook.ai.models import Model
from open_notebook.ai.provision import provision_langchain_model_with_info
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.agent import Agent
from open_notebook.exceptions import InvalidInputError, NotFoundError, OpenNotebookError
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.text_utils import extract_text_content

router = APIRouter()


def _agent_response(agent: Agent, usage: Dict[str, int]) -> AgentResponse:
    agent_id = str(agent.id) if agent.id else ""
    return AgentResponse(
        id=agent_id,
        name=agent.name,
        system_prompt=agent.system_prompt,
        description=agent.description,
        model_id=agent.model_id,
        temperature=agent.temperature,
        max_tokens=agent.max_tokens,
        enabled=agent.enabled,
        sort_order=agent.sort_order,
        in_use_session_count=usage.get(agent_id, 0),
        created=str(agent.created),
        updated=str(agent.updated),
    )


async def _require_model(model_id: str) -> None:
    """Reject unknown model references up front; otherwise the bad id is
    stored and only fails at chat time."""
    try:
        await Model.get(model_id)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Model not found")


async def _session_usage_by_agent() -> Dict[str, int]:
    """One grouped count over chat_session for the whole list response,
    instead of a per-agent count query."""
    rows = await repo_query(
        "SELECT agent, count() AS total FROM chat_session "
        "WHERE agent != NONE GROUP BY agent"
    )
    return {str(row.get("agent")): int(row.get("total", 0)) for row in rows}


async def _require_unique_name(name: str, exclude_id: Optional[str] = None) -> None:
    query = "SELECT id FROM agent WHERE string::lowercase(name) = $name"
    params: Dict[str, Any] = {"name": name.strip().lower()}
    if exclude_id:
        query += " AND id != $exclude_id"
        params["exclude_id"] = ensure_record_id(exclude_id)
    rows = await repo_query(query, params)
    if rows:
        raise HTTPException(status_code=400, detail=f"Agent name '{name}' already exists")


async def _get_agent_or_404(agent_id: str) -> Agent:
    try:
        return await Agent.get(agent_id)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Agent not found")


@router.get("/agents", response_model=List[AgentResponse])
async def get_agents(enabled: Optional[bool] = Query(None)):
    """List agents, enabled-only or all, ordered for display."""
    try:
        agents = await Agent.get_all(order_by="enabled desc, sort_order asc, name asc")
        if enabled is not None:
            agents = [agent for agent in agents if agent.enabled == enabled]
        usage = await _session_usage_by_agent()
        return [_agent_response(agent, usage) for agent in agents]
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching agents: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching agents: {str(e)}")


@router.post("/agents", response_model=AgentResponse)
async def create_agent(agent_data: AgentCreate):
    """Create a new agent."""
    try:
        await _require_unique_name(agent_data.name)
        if agent_data.model:
            await _require_model(agent_data.model)

        agent = Agent(
            name=agent_data.name.strip(),
            system_prompt=agent_data.system_prompt,
            description=agent_data.description,
            model=agent_data.model,
            temperature=agent_data.temperature,
            max_tokens=agent_data.max_tokens,
            enabled=agent_data.enabled,
            sort_order=agent_data.sort_order,
        )
        await agent.save()
        usage = await _session_usage_by_agent()
        return _agent_response(agent, usage)
    except HTTPException:
        raise
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error creating agent: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error creating agent: {str(e)}")


@router.post("/agents/polish-prompt", response_model=PolishPromptResponse)
async def polish_prompt(request: PolishPromptRequest):
    """Polish a raw system-prompt draft (possibly a one-line idea) into a
    complete, ready-to-use agent system prompt via the default chat model."""
    try:
        prompt = Prompter(prompt_template="agents/polish").render(
            data={
                "draft": request.draft,
                "name": request.name,
                "description": request.description,
            }
        )
        # No explicit model / sampling overrides: the default chat model with
        # its own defaults decides tone and length.
        prov = await provision_langchain_model_with_info(prompt, None, "chat")
        raw = await prov.langchain_model.ainvoke([HumanMessage(content=prompt)])
        polished = clean_thinking_content(extract_text_content(raw.content)).strip()
        return PolishPromptResponse(polished=polished)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error polishing prompt: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error polishing prompt: {str(e)}")


@router.get("/agents/{agent_id}", response_model=AgentResponse)
async def get_agent(agent_id: str):
    """Get a specific agent by ID."""
    try:
        agent = await _get_agent_or_404(agent_id)
        usage = await _session_usage_by_agent()
        return _agent_response(agent, usage)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching agent {agent_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching agent: {str(e)}")


@router.put("/agents/{agent_id}", response_model=AgentResponse)
async def update_agent(agent_id: str, agent_update: AgentUpdate):
    """Update an agent. Nullable fields are cleared by explicit null via
    model_fields_set (mirrors TransformationUpdate.model_id handling)."""
    try:
        agent = await _get_agent_or_404(agent_id)

        if agent_update.name is not None:
            await _require_unique_name(agent_update.name, exclude_id=str(agent.id))
            agent.name = agent_update.name.strip()
        if agent_update.system_prompt is not None:
            agent.system_prompt = agent_update.system_prompt
        # Nullable fields: present-in-payload wins (explicit null clears).
        for field in ("description", "temperature", "max_tokens"):
            if field in agent_update.model_fields_set:
                setattr(agent, field, getattr(agent_update, field))
        if "model" in agent_update.model_fields_set:
            new_model = agent_update.model
            if new_model:
                await _require_model(new_model)
            agent.model = new_model
        if agent_update.enabled is not None:
            agent.enabled = agent_update.enabled
        if agent_update.sort_order is not None:
            agent.sort_order = agent_update.sort_order

        await agent.save()
        usage = await _session_usage_by_agent()
        return _agent_response(agent, usage)
    except HTTPException:
        raise
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error updating agent {agent_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error updating agent: {str(e)}")


@router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str):
    """Delete an agent. Sessions referencing it keep the dangling id and
    degrade to the default assistant at chat time (PDR-004)."""
    try:
        agent = await _get_agent_or_404(agent_id)
        await agent.delete()
        return {"message": "Agent deleted successfully"}
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error deleting agent {agent_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error deleting agent: {str(e)}")
