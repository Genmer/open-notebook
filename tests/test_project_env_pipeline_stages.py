"""Pipeline-level tests for `_invoke_json`'s stage reporting (on_stage).

The router tests (test_ruankao_questions_generate.py) only cover FIFO
passthrough with fake render functions; these drive the real
`_invoke_json` loop — waiting on every attempt, thinking on the first
no-text chunk, generating on the first text delta, callback failures
swallowed — by stubbing the Prompter and the provisioning seam.
"""

from typing import Any, List
from unittest.mock import patch

import pytest
from pydantic import BaseModel

from open_notebook.ai import project_env_pipeline as pipeline


class _Out(BaseModel):
    value: int = 1


class _Chunk:
    def __init__(self, content: Any):
        self.content = content


class _StreamModel:
    """astream yields thinking-only chunks then text chunks; ainvoke unused."""

    def __init__(self, chunks: List[_Chunk]):
        self.chunks = chunks

    def model_copy(self, update=None):
        return self

    async def astream(self, prompt, **kwargs):
        for c in self.chunks:
            yield c


@pytest.mark.asyncio
async def test_streaming_stages_waiting_thinking_generating():
    seen: List[str] = []
    model = _StreamModel(
        [
            _Chunk([{"type": "thinking", "thinking": "推理中"}]),  # 无文本 → thinking
            _Chunk([{"type": "thinking", "thinking": "还在推理"}]),  # 已发过，不重发
            _Chunk('{"value": 1}'),  # 首个文本 → generating
            _Chunk('{"value": 1}'),  # 后续文本不再发
        ]
    )

    def fake_prompter(**_kwargs):
        class _P:
            def render(self, data):
                return "prompt"

        return _P()

    async def fake_provision(_prompt, *_args, **_kwargs):
        return type("Prov", (), {"langchain_model": model})()

    with (
        patch.object(pipeline, "Prompter", fake_prompter),
        patch.object(pipeline, "provision_langchain_model_with_info", fake_provision),
    ):
        out = await pipeline._invoke_json(
            "any_template",
            {},
            _Out,
            None,
            on_delta=lambda _d: None,
            on_stage=seen.append,
        )

    assert isinstance(out, _Out)
    assert out.value == 1
    # waiting 先于一切；thinking 只一次；generating 只一次且在 thinking 后
    assert seen[0] == "waiting"
    assert seen.count("thinking") == 1
    assert seen.count("generating") == 1
    assert seen.index("thinking") < seen.index("generating")


@pytest.mark.asyncio
async def test_non_streaming_emits_only_waiting():
    seen: List[str] = []

    class _InvokeModel:
        def model_copy(self, update=None):
            return self

        async def ainvoke(self, prompt, **kwargs):
            return type("R", (), {"content": '{"value": 2}'})()

    model = _InvokeModel()

    def fake_prompter(**_kwargs):
        class _P:
            def render(self, data):
                return "prompt"

        return _P()

    async def fake_provision(_prompt, *_args, **_kwargs):
        return type("Prov", (), {"langchain_model": model})()

    with (
        patch.object(pipeline, "Prompter", fake_prompter),
        patch.object(pipeline, "provision_langchain_model_with_info", fake_provision),
    ):
        out = await pipeline._invoke_json("t", {}, _Out, None, on_stage=seen.append)

    assert isinstance(out, _Out)
    assert out.value == 2
    assert seen == ["waiting"]


@pytest.mark.asyncio
async def test_raising_stage_callback_never_breaks_the_call():
    model = _StreamModel([_Chunk('{"value": 3}')])

    def bad_stage(_stage: str) -> None:
        raise RuntimeError("observer blew up")

    def fake_prompter(**_kwargs):
        class _P:
            def render(self, data):
                return "prompt"

        return _P()

    async def fake_provision(_prompt, *_args, **_kwargs):
        return type("Prov", (), {"langchain_model": model})()

    with (
        patch.object(pipeline, "Prompter", fake_prompter),
        patch.object(pipeline, "provision_langchain_model_with_info", fake_provision),
    ):
        out = await pipeline._invoke_json(
            "t", {}, _Out, None, on_delta=lambda _d: None, on_stage=bad_stage
        )

    assert isinstance(out, _Out)
    assert out.value == 3
