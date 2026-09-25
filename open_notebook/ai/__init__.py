# AI infrastructure module
# Contains model configuration, provisioning, and management

from esperanto import AIFactory
from esperanto.providers.llm.profiles import OpenAICompatibleProfile

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
