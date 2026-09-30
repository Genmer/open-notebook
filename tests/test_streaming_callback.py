import asyncio
import time
from uuid import uuid4

import pytest
from langchain_core.callbacks.base import BaseCallbackHandler

from open_notebook.ai.callbacks import (
    OpenNotebookStreamingHandler,
    StreamingProgress,
    TextRingBuffer,
)


def test_text_ring_buffer_basic():
    buffer = TextRingBuffer(capacity=10)
    assert buffer.capacity == 10
    assert len(buffer) == 0
    assert buffer.get_window() == ""
    assert buffer.total_chars_written == 0

    buffer.append("hello")
    assert buffer.get_window() == "hello"
    assert len(buffer) == 5
    assert buffer.total_chars_written == 5

    buffer.append(" world")
    assert buffer.get_window() == "ello world"
    assert len(buffer) == 10
    assert buffer.total_chars_written == 11

    buffer.clear()
    assert buffer.get_window() == ""
    assert len(buffer) == 0
    assert buffer.total_chars_written == 0


def test_text_ring_buffer_sliding_window_1000_chars():
    buffer = TextRingBuffer(capacity=1000)
    long_text = "a" * 1200
    buffer.append(long_text)

    assert len(buffer.get_window()) == 1000
    assert buffer.total_chars_written == 1200

    buffer.append("BCDEF")
    window = buffer.get_window()
    assert len(window) == 1000
    assert window.endswith("BCDEF")
    assert buffer.total_chars_written == 1205


def test_streaming_handler_inheritance_and_init():
    handler = OpenNotebookStreamingHandler(sync_interval_ms=500.0, window_size=1000)
    assert isinstance(handler, BaseCallbackHandler)
    assert handler.sync_interval_sec == 0.5
    assert handler.token_count == 0
    assert handler.window_buffer.capacity == 1000


def test_token_counting_and_speed_calculation():
    handler = OpenNotebookStreamingHandler(sync_interval_ms=500.0)
    run_id = uuid4()
    handler.on_llm_start({}, ["prompt"], run_id=run_id)

    for i in range(10):
        handler.on_llm_new_token(f"t{i} ", run_id=run_id)

    progress = handler.get_progress()
    assert progress.token_count == 10
    assert progress.tokens_per_second >= 0.0
    assert progress.elapsed_seconds >= 0.0
    assert "t0 t1" in progress.window_text


def test_throttling_progress_sync_500ms():
    synced_records: list[StreamingProgress] = []

    def on_sync(prog: StreamingProgress):
        synced_records.append(prog)

    handler = OpenNotebookStreamingHandler(
        sync_interval_ms=500.0,
        sync_callback=on_sync,
    )
    run_id = uuid4()
    handler.on_llm_start({}, ["prompt"], run_id=run_id)

    # Rapid stream: 20 tokens emitted in tight loop
    for i in range(20):
        handler.on_llm_new_token(f"token_{i} ", run_id=run_id)

    # Initial token may or may not sync depending on exact timing, but rapid calls
    # within <500ms must not trigger 20 database writes
    assert len(synced_records) <= 1

    # Simulate waiting past 500ms
    time.sleep(0.55)
    handler.on_llm_new_token("after_interval", run_id=run_id)
    assert len(synced_records) >= 1
    assert any("after_interval" in p.window_text for p in synced_records)

    # End LLM: must flush final progress
    handler.on_llm_end(response=None, run_id=run_id)
    assert synced_records[-1].is_final is True
    assert synced_records[-1].token_count == 21


def test_error_flushes_final_progress():
    synced_records: list[StreamingProgress] = []

    def on_sync(prog: StreamingProgress):
        synced_records.append(prog)

    handler = OpenNotebookStreamingHandler(
        sync_interval_ms=500.0,
        sync_callback=on_sync,
    )
    run_id = uuid4()
    handler.on_llm_start({}, ["prompt"], run_id=run_id)
    handler.on_llm_new_token("chunk", run_id=run_id)

    test_err = RuntimeError("LLM connection severed")
    handler.on_llm_error(test_err, run_id=run_id)

    assert len(synced_records) >= 1
    assert synced_records[-1].is_final is True
    assert "LLM connection severed" in (synced_records[-1].error or "")


@pytest.mark.asyncio
async def test_async_sync_callback_supported():
    synced_records: list[StreamingProgress] = []

    async def async_on_sync(prog: StreamingProgress):
        synced_records.append(prog)

    handler = OpenNotebookStreamingHandler(
        sync_interval_ms=50.0,
        sync_callback=async_on_sync,
    )
    run_id = uuid4()
    handler.on_llm_start({}, ["prompt"], run_id=run_id)
    handler.on_llm_new_token("async_token", run_id=run_id)

    # Allow asyncio event loop to run task
    await asyncio.sleep(0.01)
    handler.on_llm_end(response=None, run_id=run_id)
    await asyncio.sleep(0.01)

    assert len(synced_records) >= 1
    assert synced_records[-1].is_final is True
    assert "async_token" in synced_records[-1].window_text


def test_callback_exception_resilience():
    def exploding_callback(prog: StreamingProgress):
        raise ValueError("Database connection lost")

    handler = OpenNotebookStreamingHandler(
        sync_interval_ms=0.0,  # sync every token
        sync_callback=exploding_callback,
    )
    run_id = uuid4()
    handler.on_llm_start({}, ["prompt"], run_id=run_id)

    # Must not raise exception when callback fails
    handler.on_llm_new_token("token_1", run_id=run_id)
    handler.on_llm_end(response=None, run_id=run_id)
    assert handler.token_count == 1


def test_chunk_and_dict_token_extraction():
    from langchain_core.messages import AIMessageChunk
    from langchain_core.outputs import ChatGenerationChunk, GenerationChunk

    handler = OpenNotebookStreamingHandler()
    run_id = uuid4()
    handler.on_llm_start({}, ["prompt"], run_id=run_id)

    # 1. str
    handler.on_llm_new_token("str_token", run_id=run_id)
    # 2. GenerationChunk
    gen_chunk = GenerationChunk(text="gen_chunk ")
    handler.on_llm_new_token("", chunk=gen_chunk, run_id=run_id)
    # 3. ChatGenerationChunk
    chat_chunk = ChatGenerationChunk(message=AIMessageChunk(content="chat_chunk "))
    handler.on_llm_new_token("", chunk=chat_chunk, run_id=run_id)
    # 4. dict
    handler.on_llm_new_token({"text": "dict_token "}, run_id=run_id)

    prog = handler.get_progress()
    assert prog.token_count == 4
    assert "str_token" in prog.window_text
    assert "gen_chunk" in prog.window_text
    assert "chat_chunk" in prog.window_text
    assert "dict_token" in prog.window_text


def test_multithreading_concurrency():
    import concurrent.futures

    handler = OpenNotebookStreamingHandler(sync_interval_ms=100.0, window_size=500)
    run_id = uuid4()
    handler.on_llm_start({}, ["prompt"], run_id=run_id)

    def send_tokens(count: int, prefix: str):
        for i in range(count):
            handler.on_llm_new_token(f"{prefix}{i} ", run_id=run_id)

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [
            executor.submit(send_tokens, 25, f"t{idx}_")
            for idx in range(4)
        ]
        for f in futures:
            f.result()

    prog = handler.get_progress()
    assert prog.token_count == 100
    assert len(prog.window_text) <= 500
    assert prog.total_chars > 0

