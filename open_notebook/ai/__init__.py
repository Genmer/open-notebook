# AI infrastructure module
# Contains model configuration, provisioning, and management

from esperanto import AIFactory
from esperanto.providers.llm.profiles import OpenAICompatibleProfile

# User profiles take precedence over esperanto's builtin ones (get_profile
# checks _USER_PROFILES first), so re-registering dashscope here widens it:
# the builtin declares language only, but DashScope's compatible-mode also
# serves text-embedding-v1..v4 on the OpenAI embeddings endpoint.
AIFactory.register_openai_compatible_profile(
    OpenAICompatibleProfile(
        name="dashscope",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        api_key_env="DASHSCOPE_API_KEY",
        base_url_env="DASHSCOPE_API_BASE",
        capabilities={"language", "embedding"},
        display_name="DashScope (Qwen)",
        owned_by="Alibaba Cloud",
        default_models={},
    )
)

# Zhipu (BigModel) has no built-in esperanto profile. Registered here so
# provider="zhipu" works for language and embedding models. The Coding Plan
# endpoint (https://open.bigmodel.cn/api/coding/paas/v4) only serves chat
# models — users with a coding key override the base URL via credential
# base_url or ZHIPU_API_BASE.
AIFactory.register_openai_compatible_profile(
    OpenAICompatibleProfile(
        name="zhipu",
        base_url="https://open.bigmodel.cn/api/paas/v4",
        api_key_env="ZHIPU_API_KEY",
        base_url_env="ZHIPU_API_BASE",
        capabilities={"language", "embedding"},
        display_name="Zhipu (BigModel)",
        owned_by="Zhipu AI",
        default_models={},
    )
)

# Xiaomi MiMo (https://mimo.mi.com) — OpenAI-compatible. One API, two
# endpoints with non-interchangeable keys: pay-as-you-go (sk-…) on
# api.xiaomimimo.com, Token Plan subscription (tp-/ttp-…) on
# token-plan-cn.xiaomimimo.com. Registered separately so credential type and
# endpoint always match.
AIFactory.register_openai_compatible_profile(
    OpenAICompatibleProfile(
        name="xiaomi_mimo",
        base_url="https://api.xiaomimimo.com/v1",
        api_key_env="MIMO_API_KEY",
        base_url_env="XIAOMI_MIMO_API_BASE",
        capabilities={"language", "embedding"},
        display_name="Xiaomi MiMo",
        owned_by="Xiaomi",
        default_models={},
    )
)
AIFactory.register_openai_compatible_profile(
    OpenAICompatibleProfile(
        name="xiaomi_mimo_token_plan",
        base_url="https://token-plan-cn.xiaomimimo.com/v1",
        api_key_env="MIMO_TOKEN_PLAN_API_KEY",
        base_url_env="XIAOMI_MIMO_TOKEN_PLAN_API_BASE",
        capabilities={"language", "embedding"},
        display_name="Xiaomi MiMo Token Plan",
        owned_by="Xiaomi",
        default_models={},
    )
)

# Audio modalities for xiaomi_mimo are served on chat/completions (the
# /audio/* endpoints 404), so they must NOT go into the profile — create_tts/stt
# consults profiles first and would route to the OpenAI-compatible /audio/*
# classes. register_openai_compatible_profile only wires /audio/*-style classes,
# hence the direct private-table registration; _import_provider_class normalizes
# underscores to hyphens, so keys use hyphens.
AIFactory._provider_modules["text_to_speech"]["xiaomi-mimo"] = (
    "open_notebook.ai.xiaomi_audio:XiaomiMimoTextToSpeechModel"
)
AIFactory._provider_modules["text_to_speech"]["xiaomi-mimo-token-plan"] = (
    "open_notebook.ai.xiaomi_audio:XiaomiTokenPlanTextToSpeechModel"
)
AIFactory._provider_modules["speech_to_text"]["xiaomi-mimo"] = (
    "open_notebook.ai.xiaomi_audio:XiaomiMimoSpeechToTextModel"
)
AIFactory._provider_modules["speech_to_text"]["xiaomi-mimo-token-plan"] = (
    "open_notebook.ai.xiaomi_audio:XiaomiTokenPlanSpeechToTextModel"
)

from open_notebook.ai.callbacks import (
    OpenNotebookStreamingHandler,
    StreamingProgress,
    TextRingBuffer,
)

__all__ = [
    "OpenNotebookStreamingHandler",
    "StreamingProgress",
    "TextRingBuffer",
]
