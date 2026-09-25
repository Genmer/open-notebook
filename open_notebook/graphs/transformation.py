from ai_prompter import Prompter
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict

from open_notebook.ai.provision import provision_langchain_model_with_info
from open_notebook.ai.usage import record_llm_usage
from open_notebook.domain.notebook import Source
from open_notebook.domain.transformation import DefaultPrompts, Transformation
from open_notebook.exceptions import OpenNotebookError
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.error_classifier import classify_error
from open_notebook.utils.text_utils import extract_text_content


class TransformationState(TypedDict):
    input_text: str
    source: Source
    transformation: Transformation
    output: str


async def run_transformation(state: dict, config: RunnableConfig) -> dict:
    source_obj = state.get("source")
    source: Source = source_obj if isinstance(source_obj, Source) else None  # type: ignore[assignment]
    content = state.get("input_text")
    assert source or content, "No content to transform"
    transformation: Transformation = state["transformation"]

    prov = None
    correlation_id = str(source.id) if source and source.id else None
    try:
        if not content:
            content = source.full_text
        # transformation.prompt is user-controlled free text. Never compile it as
        # Jinja template *source* (Prompter(template_text=...)) - pass it as a
        # plain render variable into a fixed, developer-authored template instead.
        # See docs/7-DEVELOPMENT/security.md (GHSA-f35w-wx37-26q7).
        instructions = transformation.prompt
        default_prompts: DefaultPrompts = DefaultPrompts(transformation_instructions=None)
        if default_prompts.transformation_instructions:
            instructions = f"{default_prompts.transformation_instructions}\n\n{instructions}"

        system_prompt = Prompter(prompt_template="transformation/execute").render(
            data={**state, "instructions": instructions}
        )
        content_str = str(content) if content else ""
        payload = [SystemMessage(content=system_prompt), HumanMessage(content=content_str)]
        prov = await provision_langchain_model_with_info(
            str(payload),
            config.get("configurable", {}).get("model_id"),
            "transformation",
            max_tokens=8192,
        )
        chain = prov.langchain_model

        response = await chain.ainvoke(payload)

        # Clean thinking content from the response
        response_content = extract_text_content(response.content)
        cleaned_content = clean_thinking_content(response_content)

        if source:
            await source.add_insight(transformation.title, cleaned_content)

        await record_llm_usage(
            model=prov,
            ai_message=response,
            call_type="transformation",
            correlation_id=correlation_id,
        )

        return {
            "output": cleaned_content,
        }
    except OpenNotebookError as e:
        await record_llm_usage(
            model=prov,
            ai_message=None,
            call_type="transformation",
            correlation_id=correlation_id,
            success=False,
            error=str(e),
        )
        raise
    except Exception as e:
        await record_llm_usage(
            model=prov,
            ai_message=None,
            call_type="transformation",
            correlation_id=correlation_id,
            success=False,
            error=str(e),
        )
        error_class, user_message = classify_error(e)
        raise error_class(user_message) from e


agent_state = StateGraph(TransformationState)
agent_state.add_node("agent", run_transformation)  # type: ignore[type-var]
agent_state.add_edge(START, "agent")
agent_state.add_edge("agent", END)
graph = agent_state.compile()
