"""Xiaomi MiMo audio adapters.

MiMo's audio models (mimo-v2.5-tts / mimo-v2.5-asr) are not served on the
OpenAI /audio/* endpoints (404) but through chat/completions, so the stock
OpenAI-compatible classes cannot reach them.
"""
import base64
import os
from pathlib import Path
from typing import Any, BinaryIO, Dict, List, Optional, Tuple, Union

import httpx
from esperanto.common_types import Model, TranscriptionResponse
from esperanto.providers.stt.base import SpeechToTextModel
from esperanto.providers.tts.base import AudioResponse, TextToSpeechModel, Voice


class XiaomiChatTextToSpeechModel(TextToSpeechModel):
    """MiMo TTS over chat/completions; returns base64 WAV in message.audio."""

    DEFAULT_MODEL = "mimo-v2.5-tts"
    PROVIDER = "xiaomi"
    # Set per provider subclass; the two MiMo hosts have non-interchangeable keys.
    DEFAULT_BASE_URL = ""
    API_KEY_ENV = ""

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
        **kwargs,
    ):
        super().__init__(
            model_name=model_name,
            api_key=api_key or os.getenv(self.API_KEY_ENV, ""),
            base_url=base_url or self.DEFAULT_BASE_URL,
            config={**(config or {}), **kwargs},
        )
        if not self.base_url:
            raise ValueError("Xiaomi MiMo TTS requires a base_url (credential or default)")
        self.base_url = self.base_url.rstrip("/")
        self._create_http_clients()

    def _get_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _handle_error(self, response: httpx.Response) -> None:
        if response.status_code >= 400:
            try:
                error_message = response.json().get("error", {}).get(
                    "message", f"HTTP {response.status_code}"
                )
            except Exception:
                error_message = f"HTTP {response.status_code}: {response.text}"
            raise RuntimeError(f"Xiaomi MiMo API error: {error_message}")

    @property
    def available_voices(self) -> Dict[str, Voice]:
        # The verified protocol has no voice field; the server picks the voice.
        return {
            "default": Voice(name="default", id="default", gender="UNKNOWN", language_code=None)
        }

    @property
    def provider(self) -> str:
        return self.PROVIDER

    def _get_models(self) -> List[Model]:
        return [Model(id=self.model_name, owned_by="Xiaomi")]

    def generate_speech(
        self,
        text: str,
        voice: str = "default",
        output_file: Optional[Union[str, Path]] = None,
        **kwargs,
    ) -> AudioResponse:
        # voice is accepted for interface compat and ignored (no protocol field).
        try:
            payload = {
                "model": self.model_name,
                "messages": [{"role": "assistant", "content": text}],
            }
            response = self.client.post(
                f"{self.base_url}/chat/completions",
                headers=self._get_headers(),
                json=payload,
            )
            self._handle_error(response)
            audio_b64 = response.json()["choices"][0]["message"]["audio"]["data"]
            audio_data = base64.b64decode(audio_b64)

            if output_file:
                output_path = Path(output_file)
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_bytes(audio_data)

            return AudioResponse(
                audio_data=audio_data,
                content_type="audio/wav",
                model=self.model_name,
                voice=voice,
                provider=self.PROVIDER,
                metadata={"text": text},
            )
        except Exception as e:
            raise RuntimeError(f"Failed to generate speech: {str(e)}") from e

    async def agenerate_speech(
        self,
        text: str,
        voice: str = "default",
        output_file: Optional[Union[str, Path]] = None,
        **kwargs,
    ) -> AudioResponse:
        # voice is accepted for interface compat and ignored (no protocol field).
        try:
            payload = {
                "model": self.model_name,
                "messages": [{"role": "assistant", "content": text}],
            }
            response = await self.async_client.post(
                f"{self.base_url}/chat/completions",
                headers=self._get_headers(),
                json=payload,
            )
            self._handle_error(response)
            audio_b64 = response.json()["choices"][0]["message"]["audio"]["data"]
            audio_data = base64.b64decode(audio_b64)

            if output_file:
                output_path = Path(output_file)
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_bytes(audio_data)

            return AudioResponse(
                audio_data=audio_data,
                content_type="audio/wav",
                model=self.model_name,
                voice=voice,
                provider=self.PROVIDER,
                metadata={"text": text},
            )
        except Exception as e:
            raise RuntimeError(f"Failed to generate speech: {str(e)}") from e


_AUDIO_FORMAT_BY_SUFFIX = {
    ".wav": "wav",
    ".mp3": "mp3",
    ".m4a": "m4a",
    ".webm": "webm",
}


class XiaomiChatSpeechToTextModel(SpeechToTextModel):
    """MiMo ASR over chat/completions with an input_audio content part."""

    DEFAULT_MODEL = "mimo-v2.5-asr"
    PROVIDER = "xiaomi"
    DEFAULT_BASE_URL = ""
    API_KEY_ENV = ""

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
        **kwargs,
    ):
        super().__init__(
            model_name=model_name,
            api_key=api_key or os.getenv(self.API_KEY_ENV, ""),
            base_url=base_url or self.DEFAULT_BASE_URL,
            config={**(config or {}), **kwargs},
        )
        if not self.base_url:
            raise ValueError("Xiaomi MiMo STT requires a base_url (credential or default)")
        self.base_url = self.base_url.rstrip("/")
        self._create_http_clients()

    def _get_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _handle_error(self, response: httpx.Response) -> None:
        if response.status_code >= 400:
            try:
                error_message = response.json().get("error", {}).get(
                    "message", f"HTTP {response.status_code}"
                )
            except Exception:
                error_message = f"HTTP {response.status_code}: {response.text}"
            raise RuntimeError(f"Xiaomi MiMo API error: {error_message}")

    @property
    def provider(self) -> str:
        return self.PROVIDER

    def _get_default_model(self) -> str:
        return self.DEFAULT_MODEL

    def _get_models(self) -> List[Model]:
        return [Model(id=self.model_name, owned_by="Xiaomi")]

    def _audio_to_b64(self, audio_file: Union[str, Path, BinaryIO]) -> Tuple[str, str]:
        if isinstance(audio_file, (str, Path)):
            path = Path(audio_file)
            data = path.read_bytes()
            name = str(path)
        else:
            data = audio_file.read()
            name = getattr(audio_file, "name", "") or ""
        audio_format = _AUDIO_FORMAT_BY_SUFFIX.get(Path(name).suffix.lower(), "wav")
        return base64.b64encode(data).decode("utf-8"), audio_format

    def transcribe(
        self,
        audio_file: Union[str, Path, BinaryIO],
        language: Optional[str] = None,
        prompt: Optional[str] = None,
    ) -> TranscriptionResponse:
        # language/prompt dropped: the server rejects text parts in ASR requests
        # and no language parameter is verified for this protocol.
        audio_b64, audio_format = self._audio_to_b64(audio_file)
        payload = {
            "model": self.model_name,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_audio",
                            "input_audio": {"data": audio_b64, "format": audio_format},
                        }
                    ],
                }
            ],
        }
        response = self.client.post(
            f"{self.base_url}/chat/completions",
            headers=self._get_headers(),
            json=payload,
        )
        self._handle_error(response)
        text = response.json()["choices"][0]["message"]["content"]
        return TranscriptionResponse(text=text, model=self.model_name, provider=self.PROVIDER)

    async def atranscribe(
        self,
        audio_file: Union[str, Path, BinaryIO],
        language: Optional[str] = None,
        prompt: Optional[str] = None,
    ) -> TranscriptionResponse:
        # language/prompt dropped: the server rejects text parts in ASR requests
        # and no language parameter is verified for this protocol.
        audio_b64, audio_format = self._audio_to_b64(audio_file)
        payload = {
            "model": self.model_name,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_audio",
                            "input_audio": {"data": audio_b64, "format": audio_format},
                        }
                    ],
                }
            ],
        }
        response = await self.async_client.post(
            f"{self.base_url}/chat/completions",
            headers=self._get_headers(),
            json=payload,
        )
        self._handle_error(response)
        text = response.json()["choices"][0]["message"]["content"]
        return TranscriptionResponse(text=text, model=self.model_name, provider=self.PROVIDER)


# One subclass per provider so the default host and env key match the credential
# contract declared in the profile (the two hosts take non-interchangeable keys).
class XiaomiMimoTextToSpeechModel(XiaomiChatTextToSpeechModel):
    DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1"
    API_KEY_ENV = "MIMO_API_KEY"


class XiaomiTokenPlanTextToSpeechModel(XiaomiChatTextToSpeechModel):
    DEFAULT_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1"
    API_KEY_ENV = "MIMO_TOKEN_PLAN_API_KEY"


class XiaomiMimoSpeechToTextModel(XiaomiChatSpeechToTextModel):
    DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1"
    API_KEY_ENV = "MIMO_API_KEY"


class XiaomiTokenPlanSpeechToTextModel(XiaomiChatSpeechToTextModel):
    DEFAULT_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1"
    API_KEY_ENV = "MIMO_TOKEN_PLAN_API_KEY"
