"""
Unit tests for the Xiaomi MiMo chat-audio adapters
(open_notebook/ai/xiaomi_audio.py) and their AIFactory wiring.

HTTP clients are replaced with mocks at the instance level; no real
network access happens.
"""

import base64
import io
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from esperanto import AIFactory
from esperanto.common_types import TranscriptionResponse
from esperanto.providers.llm.openai_compatible import OpenAICompatibleLanguageModel
from esperanto.providers.llm.profiles import get_profile_capabilities
from esperanto.providers.tts.base import AudioResponse

from open_notebook.ai.provider_registry import PROVIDERS
from open_notebook.ai.xiaomi_audio import (
    XiaomiChatSpeechToTextModel,
    XiaomiChatTextToSpeechModel,
    XiaomiMimoTextToSpeechModel,
    XiaomiTokenPlanSpeechToTextModel,
)

CONFIG = {"api_key": "test-key", "base_url": "https://example.com/v1"}
WAV_BYTES = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 8


def _make_tts() -> tuple[XiaomiChatTextToSpeechModel, MagicMock, AsyncMock]:
    """Build a TTS model with mocked HTTP clients: (model, client, async_client)."""
    model = XiaomiChatTextToSpeechModel(model_name="mimo-v2.5-tts", config=CONFIG)
    client, async_client = MagicMock(), AsyncMock()
    model.client = client
    model.async_client = async_client
    return model, client, async_client


def _make_stt() -> tuple[XiaomiChatSpeechToTextModel, MagicMock, AsyncMock]:
    """Build an STT model with mocked HTTP clients: (model, client, async_client)."""
    model = XiaomiChatSpeechToTextModel(model_name="mimo-v2.5-asr", config=CONFIG)
    client, async_client = MagicMock(), AsyncMock()
    model.client = client
    model.async_client = async_client
    return model, client, async_client


def _tts_http_response() -> httpx.Response:
    audio_b64 = base64.b64encode(WAV_BYTES).decode("ascii")
    return httpx.Response(
        200,
        json={"choices": [{"message": {"audio": {"data": audio_b64}}}]},
    )


class TestTTS:
    def test_request_shape_and_response(self, tmp_path):
        model, client, _ = _make_tts()
        client.post.return_value = _tts_http_response()
        output_file = tmp_path / "out.wav"

        response = model.generate_speech("你好世界", voice="alloy", output_file=output_file)

        call = client.post.call_args
        assert call.args[0] == "https://example.com/v1/chat/completions"
        payload = call.kwargs["json"]
        assert payload["model"] == "mimo-v2.5-tts"
        assert payload["messages"] == [{"role": "assistant", "content": "你好世界"}]
        assert "voice" not in payload
        assert response.audio_data == WAV_BYTES
        assert response.content_type == "audio/wav"
        assert output_file.read_bytes() == WAV_BYTES

    @pytest.mark.asyncio
    async def test_async_request_shape_and_response(self):
        model, _, async_client = _make_tts()
        async_client.post.return_value = _tts_http_response()

        response = await model.agenerate_speech("你好世界")

        payload = async_client.post.call_args.kwargs["json"]
        assert payload["messages"] == [{"role": "assistant", "content": "你好世界"}]
        assert response.audio_data == WAV_BYTES
        assert isinstance(response, AudioResponse)

    def test_http_error_raises_runtime_error_with_server_message(self):
        model, client, _ = _make_tts()
        client.post.return_value = httpx.Response(
            400,
            json={
                "error": {
                    "message": "messages must contain an assistant role for TTS model"
                }
            },
        )

        with pytest.raises(RuntimeError, match="messages must contain an assistant role"):
            model.generate_speech("hi")

    def test_missing_audio_field_raises_runtime_error(self):
        model, client, _ = _make_tts()
        client.post.return_value = httpx.Response(
            200, json={"choices": [{"message": {"content": "no audio here"}}]}
        )

        with pytest.raises(RuntimeError, match="Failed to generate speech"):
            model.generate_speech("hi")

    def test_base_url_falls_back_to_provider_default(self):
        model = XiaomiMimoTextToSpeechModel(model_name="mimo-v2.5-tts", config={"api_key": "x"})
        assert model.base_url == "https://api.xiaomimimo.com/v1"
        token_plan = XiaomiTokenPlanSpeechToTextModel(
            model_name="mimo-v2.5-asr", config={"api_key": "x"}
        )
        assert token_plan.base_url == "https://token-plan-cn.xiaomimimo.com/v1"


class TestSTT:
    def test_request_shape_and_response(self, tmp_path):
        model, client, _ = _make_stt()
        audio_file = tmp_path / "clip.mp3"
        audio_file.write_bytes(b"ID3-fake-mp3-bytes")
        client.post.return_value = httpx.Response(
            200, json={"choices": [{"message": {"content": "你好世界"}}]}
        )

        response = model.transcribe(str(audio_file))

        call = client.post.call_args
        assert call.args[0] == "https://example.com/v1/chat/completions"
        payload = call.kwargs["json"]
        assert payload["model"] == "mimo-v2.5-asr"
        (message,) = payload["messages"]
        assert message["role"] == "user"
        (part,) = message["content"]
        assert part["type"] == "input_audio"
        assert part["input_audio"]["format"] == "mp3"
        assert part["input_audio"]["data"] == base64.b64encode(b"ID3-fake-mp3-bytes").decode("ascii")
        assert response.text == "你好世界"
        assert response.model == "mimo-v2.5-asr"
        assert isinstance(response, TranscriptionResponse)

    def test_format_defaults_to_wav_for_unknown_suffix(self, tmp_path):
        model, _, _ = _make_stt()
        audio_file = tmp_path / "clip.foo"
        audio_file.write_bytes(b"x")

        _, audio_format = model._audio_to_b64(str(audio_file))

        assert audio_format == "wav"

    def test_binaryio_input_keeps_name_suffix_and_no_text_part(self):
        model, client, _ = _make_stt()
        buf = io.BytesIO(b"ID3-fake-mp3-bytes")
        buf.name = "test_speech.mp3"
        client.post.return_value = httpx.Response(
            200, json={"choices": [{"message": {"content": "spoken"}}]}
        )

        response = model.transcribe(audio_file=buf)

        payload = client.post.call_args.kwargs["json"]
        (message,) = payload["messages"]
        (part,) = message["content"]
        assert part == {
            "type": "input_audio",
            "input_audio": {
                "data": base64.b64encode(b"ID3-fake-mp3-bytes").decode("ascii"),
                "format": "mp3",
            },
        }
        assert response.text == "spoken"

    def test_http_error_raises_runtime_error_with_server_message(self, tmp_path):
        model, client, _ = _make_stt()
        audio_file = tmp_path / "clip.mp3"
        audio_file.write_bytes(b"x")
        client.post.return_value = httpx.Response(
            401, json={"error": {"message": "invalid api key"}}
        )

        with pytest.raises(RuntimeError, match="invalid api key"):
            model.transcribe(str(audio_file))

    @pytest.mark.asyncio
    async def test_async_transcribe(self, tmp_path):
        model, _, async_client = _make_stt()
        audio_file = tmp_path / "clip.webm"
        audio_file.write_bytes(b"webm-bytes")
        async_client.post.return_value = httpx.Response(
            200, json={"choices": [{"message": {"content": "transcribed"}}]}
        )

        response = await model.atranscribe(audio_file)

        part = async_client.post.call_args.kwargs["json"]["messages"][0]["content"][0]
        assert part["input_audio"]["format"] == "webm"
        assert response.text == "transcribed"


class TestFactoryRouting:
    def test_audio_modalities_route_to_chat_audio_adapters(self):
        config = {
            "api_key": "x",
            "base_url": "https://token-plan-cn.xiaomimimo.com/v1",
        }

        tts = AIFactory.create_text_to_speech(
            "xiaomi_mimo_token_plan", model_name="mimo-v2.5-tts", config=config
        )
        stt = AIFactory.create_speech_to_text(
            "xiaomi_mimo_token_plan", model_name="mimo-v2.5-asr", config=config
        )
        tts_payg = AIFactory.create_text_to_speech(
            "xiaomi_mimo", model_name="mimo-v2.5-tts", config=dict(
                api_key="x", base_url="https://api.xiaomimimo.com/v1"
            )
        )
        stt_payg = AIFactory.create_speech_to_text(
            "xiaomi_mimo", model_name="mimo-v2.5-asr", config=dict(
                api_key="x", base_url="https://api.xiaomimimo.com/v1"
            )
        )

        assert isinstance(tts, XiaomiChatTextToSpeechModel)
        assert isinstance(stt, XiaomiChatSpeechToTextModel)
        assert isinstance(tts_payg, XiaomiChatTextToSpeechModel)
        assert isinstance(stt_payg, XiaomiChatSpeechToTextModel)
        assert tts.base_url == "https://token-plan-cn.xiaomimimo.com/v1"

    def test_provider_modules_registers_all_four_chat_audio_keys(self):
        modules = AIFactory._provider_modules

        assert modules["text_to_speech"]["xiaomi-mimo"] == (
            "open_notebook.ai.xiaomi_audio:XiaomiMimoTextToSpeechModel"
        )
        assert modules["text_to_speech"]["xiaomi-mimo-token-plan"] == (
            "open_notebook.ai.xiaomi_audio:XiaomiTokenPlanTextToSpeechModel"
        )
        assert modules["speech_to_text"]["xiaomi-mimo"] == (
            "open_notebook.ai.xiaomi_audio:XiaomiMimoSpeechToTextModel"
        )
        assert modules["speech_to_text"]["xiaomi-mimo-token-plan"] == (
            "open_notebook.ai.xiaomi_audio:XiaomiTokenPlanSpeechToTextModel"
        )

    def test_language_still_routes_through_profile(self):
        llm = AIFactory.create_language(
            "xiaomi_mimo_token_plan",
            "mimo-v2.6-flash",
            config={
                "api_key": "x",
                "base_url": "https://token-plan-cn.xiaomimimo.com/v1",
            },
        )

        assert isinstance(llm, OpenAICompatibleLanguageModel)

    def test_profiles_no_longer_declare_audio_capabilities(self):
        capabilities = get_profile_capabilities()

        for name in ("xiaomi-mimo", "xiaomi-mimo-token-plan"):
            assert "speech_to_text" not in capabilities[name]
            assert "text_to_speech" not in capabilities[name]
            assert {"language", "embedding"} <= capabilities[name]

    def test_provider_registry_keeps_all_modalities(self):
        for name in ("xiaomi_mimo", "xiaomi_mimo_token_plan"):
            assert PROVIDERS[name].modalities == (
                "language",
                "embedding",
                "speech_to_text",
                "text_to_speech",
            )


class TestConsumerIntegration:
    """Consumer call patterns (podcast_creator, connection_tester) at mock level."""

    def _make_tts_kwargs(self) -> tuple[XiaomiChatTextToSpeechModel, AsyncMock]:
        model = XiaomiChatTextToSpeechModel(
            model_name="mimo-v2.5-tts",
            api_key="x",
            base_url="https://example.com/v1",
        )
        async_client = AsyncMock()
        model.async_client = async_client
        return model, async_client

    @pytest.mark.asyncio
    async def test_podcast_creator_style_call_writes_output_file(self, tmp_path):
        model, async_client = self._make_tts_kwargs()
        async_client.post.return_value = _tts_http_response()
        output_file = tmp_path / "c.wav"

        response = await model.agenerate_speech(
            text="hi", voice="whatever", output_file=output_file
        )

        assert isinstance(response, AudioResponse)
        assert response.audio_data == WAV_BYTES
        assert response.content_type == "audio/wav"
        assert output_file.read_bytes() == WAV_BYTES

    @pytest.mark.asyncio
    async def test_connection_tester_voice_flow_succeeds(self):
        # Mirrors connection_tester.py: first key of available_voices as voice.
        model, async_client = self._make_tts_kwargs()
        async_client.post.return_value = _tts_http_response()

        voice = next(iter(model.available_voices.keys()))
        audio = await model.agenerate_speech(
            text="Hello from Open Notebook", voice=voice
        )

        assert audio.audio_data == WAV_BYTES
        payload = async_client.post.call_args.kwargs["json"]
        assert payload["messages"] == [
            {"role": "assistant", "content": "Hello from Open Notebook"}
        ]

    @pytest.mark.asyncio
    async def test_connection_tester_atranscribe_with_binaryio_and_language(self):
        model, _, async_client = _make_stt()
        buf = io.BytesIO(b"test-speech-clip-bytes")
        buf.name = "test_speech.mp3"
        async_client.post.return_value = httpx.Response(
            200, json={"choices": [{"message": {"content": "hello"}}]}
        )

        response = await model.atranscribe(audio_file=buf, language="en")

        assert isinstance(response, TranscriptionResponse)
        assert response.text == "hello"
        part = async_client.post.call_args.kwargs["json"]["messages"][0][
            "content"
        ][0]
        assert part["input_audio"]["format"] == "mp3"
