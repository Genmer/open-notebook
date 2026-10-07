"""Rendered-prompt regression tests for project_env templates.

verify_point_lane passes `mode` in the render data of verify_b: mock mode must
steer the model to a plausibility judgement (never off_table), material mode
must keep the off_table bounce. If the mode value never reaches the rendered
text, the model sees both rules with no way to tell which one applies — the
runtime validator becomes the only guard and every mock off_table answer costs
a wasted retry, while material mode risks GA dates judged from memory.
"""

from unittest.mock import patch

import pytest
from ai_prompter import Prompter
from langchain_core.output_parsers.pydantic import PydanticOutputParser

from open_notebook.ai.project_env_pipeline import LaneVerdict
from open_notebook.domain.project_env import DEFAULT_INDUSTRY

# material-mode bounce rule: "off_table — NEVER judge a GA date from memory"
OFF_TABLE_BOUNCE = 'verdict must be "off_table"'
# mock-mode plausibility rule (table miss is judged, not bounced)
MOCK_PLAUSIBILITY = "judge from general knowledge"


def _render_b(mode: str) -> str:
    """Render verify_b exactly the way verify_point_lane does (same parser,
    same data keys), so a template variable rename cannot pass silently."""
    parser: PydanticOutputParser[LaneVerdict] = PydanticOutputParser(
        pydantic_object=LaneVerdict
    )
    return Prompter(
        prompt_template="project_env/verify_b",
        parser=parser,  # type: ignore[arg-type]
    ).render(
        data={
            "quote": "推理服务采用 Flink 1.18 部署",
            "field": "background",
            "period_start": "2025.01",
            "period_end": "2025.08",
            "narrative": "",
            "my_role": "",
            "anchor_table": "(锚点表)",
            "anchor_subset": "(子集)",
            "mode": mode,
        }
    )


def test_verify_b_mock_render_drops_off_table_bounce():
    text = _render_b("mock")

    assert OFF_TABLE_BOUNCE not in text
    assert MOCK_PLAUSIBILITY in text


def test_verify_b_material_render_keeps_off_table_bounce():
    text = _render_b("material")

    assert OFF_TABLE_BOUNCE in text


def test_verify_b_render_depends_on_mode():
    """The two modes must not render byte-identical prompts: without a visible
    difference the model cannot know which verdict rule applies."""
    assert _render_b("mock") != _render_b("material")


# --- materials-step templates (素材生成) ---

_WINDOW = {
    "now_month": "2026.10",
    "legal_start_earliest": "2024.12",
    "legal_end_latest": "2025.09",
}


def _render(template: str, model, data: dict) -> str:
    parser: PydanticOutputParser = PydanticOutputParser(pydantic_object=model)
    return Prompter(
        prompt_template=template,
        parser=parser,  # type: ignore[arg-type]
    ).render(data=data)


def test_materials_generate_template_lists_category_whitelist():
    from open_notebook.ai.project_env_pipeline import MaterialsBundle
    from open_notebook.domain.project_env import TEXT_FIELDS

    text = _render(
        "project_env/materials_generate",
        MaterialsBundle,
        {
            "keywords": ["微服务", "高并发"],
            "name": "电商中台",
            "fixed_period_start": "",
            "fixed_period_end": "",
            **_WINDOW,
        },
    )

    for field_id in TEXT_FIELDS:  # legal category values must all be spelled out
        assert field_id in text
    assert "18" in text  # 6 categories × 3 candidates
    assert "2026.10" in text
    assert '"category"' in text  # format_instructions schema present


def test_routes_generate_template_carries_legal_window_and_axes():
    from open_notebook.ai.project_env_pipeline import RoutesBundle

    text = _render(
        "project_env/routes_generate",
        RoutesBundle,
        {
            "keywords": ["微服务"],
            "name": "",
            "fixed_period_start": "2025.02",
            "fixed_period_end": "2025.09",
            **_WINDOW,
        },
    )

    assert "2025.09" in text  # legal_end_latest rendered
    assert "2024.12" in text  # legal_start_earliest rendered
    assert "6 to 10 months" in text
    assert "period_start = 2025.02" in text  # fixed period honored
    assert '"tech_stack"' in text


def test_draft_from_materials_template_renders_selection_and_feedback_gate():
    from open_notebook.ai.project_env_pipeline import MockDraft

    data = {
        "keywords": ["微服务"],
        "selected_items": [
            {
                "category": "background",
                "title": "电商缓存改造",
                "text": "背景片段采用 Redis 7.0。",
            }
        ],
        "name": "AI 模拟项目",
        "fixed_period_start": "",
        "fixed_period_end": "",
        "feedback": "",
        **_WINDOW,
    }
    text = _render("project_env/draft_from_materials", MockDraft, data)

    assert "[background] 电商缓存改造" in text  # picked facts reach the prompt
    assert "背景片段采用 Redis 7.0。" in text
    assert "PREVIOUS ATTEMPT FEEDBACK" not in text  # empty feedback hides section
    assert '"tech_background"' in text  # six-field schema present

    data["feedback"] = "R2: span must be 6-10 months"
    text_with_feedback = _render("project_env/draft_from_materials", MockDraft, data)
    assert "PREVIOUS ATTEMPT FEEDBACK" in text_with_feedback
    assert "R2: span must be 6-10 months" in text_with_feedback


def test_draft_from_route_template_renders_spec_verbatim():
    from open_notebook.ai.project_env_pipeline import MockDraft

    route = {
        "id": "r2",
        "title": "微服务治理路线",
        "summary": "一句话概括",
        "tech_stack": ["Spring Boot 3.2", "Redis 7.0"],
        "scale": "团队 25 人",
        "role": "我担任项目负责人",
        "highlights": ["链路追踪落地"],
        "period": {"start": "2025.01", "end": "2025.08"},
    }
    text = _render(
        "project_env/draft_from_route",
        MockDraft,
        {
            "keywords": ["微服务"],
            "route": route,
            "name": "",
            "fixed_period_start": "",
            "fixed_period_end": "",
            "feedback": "",
            **_WINDOW,
        },
    )

    assert "微服务治理路线" in text
    assert "Spring Boot 3.2、Redis 7.0" in text  # tech_stack rendered joined
    assert "团队 25 人" in text
    assert "2025.01 ~ 2025.08" in text
    assert "STRICTLY from the route spec" in text  # no-substitution constraint
    assert '"tuning_process"' in text


# --- paragraph granularity (段落级验证) ---


def test_verify_a_template_judges_whole_paragraph_multi_fact():
    text = Prompter(prompt_template="project_env/verify_a").render(
        data={
            "quote": "缓存采用 Redis 7.0，日均处理 300 万条。",
            "field": "background",
            "evidence": "[证据 1]\nRedis 7.0 于 2024.07 GA",
            "anchor_table": "(锚点表)",
            "narrative": "",
            "my_role": "",
            "period_start": "2025.01",
            "period_end": "2025.08",
            "mode": "material",
        }
    )
    assert "ONE paragraph" in text
    assert "EVERY fact" in text  # multi-fact: one false fact fails the whole
    assert "300 万条" in text


def test_verify_c_template_judges_whole_paragraph_multi_fact():
    text = Prompter(prompt_template="project_env/verify_c").render(
        data={
            "quote": "缓存采用 Redis 7.0，日均处理 300 万条。",
            "field": "background",
            "narrative": "[background]\n项目背景叙述",
            "my_role": "架构师",
            "period_start": "2025.01",
            "period_end": "2025.08",
            "mode": "material",
        }
    )
    assert "ONE paragraph" in text
    assert "EVERY fact" in text
    assert "300 万条" in text


def test_extract_claims_template_asks_for_paragraph_quotes():
    text = Prompter(prompt_template="project_env/extract_claims").render(
        data={
            "fields": [{"field": "background", "text": "缓存采用 Redis 7.0。"}],
        }
    )
    assert "paragraph" in text
    assert "one sentence" not in text


def test_corrector_template_demands_whole_paragraph_replacement():
    text = Prompter(prompt_template="project_env/corrector").render(
        data={
            "quote": "缓存采用 Redis 9.9。",
            "field": "background",
            "issues": ["Redis 9.9 不存在"],
            "narrative": "",
            "period_start": "2025.01",
            "period_end": "2025.08",
        }
    )
    assert "replacement paragraph" in text
    assert "replacement sentence" not in text


def test_suggest_rewrite_template_renders_issues_and_format_instructions():
    from open_notebook.ai.project_env_pipeline import SuggestRewrite

    parser: PydanticOutputParser[SuggestRewrite] = PydanticOutputParser(
        pydantic_object=SuggestRewrite
    )
    text = Prompter(
        prompt_template="project_env/suggest_rewrite",
        parser=parser,  # type: ignore[arg-type]
    ).render(
        data={
            "quote": "缓存采用 Redis 9.9。",
            "field": "background",
            "issues": ["Redis 9.9 不存在"],
            "narrative": "[background]\n叙述",
            "period_start": "2025.01",
            "period_end": "2025.08",
        }
    )
    assert "Redis 9.9 不存在" in text
    assert "replacement paragraph" in text
    assert '"suggestion"' in text and '"explanation"' in text  # schema injected


def _render_generic_paragraph(source_type: str) -> str:
    return Prompter(prompt_template="project_env/generic_paragraph").render(
        data={
            "name": "电商平台重构",
            "period_start": "2025.01",
            "period_end": "2025.08",
            "source_type": source_type,
            "fields": [{"field": "background", "text": "微服务化改造"}],
        }
    )


def test_generic_paragraph_template_demands_placeholders_and_underline():
    text = _render_generic_paragraph("real")
    assert "____" in text
    assert "<u>" in text
    assert "200-400" in text


def test_generic_paragraph_template_mock_vs_real_branches_differ():
    assert _render_generic_paragraph("mock") != _render_generic_paragraph("real")
    assert "AI-simulated" in _render_generic_paragraph("mock")
    assert "ONLY facts" in _render_generic_paragraph("real")


# --- 行业 + 自研视角改造（industry 参数与负面约束） ---


def test_default_industry_constant_is_logistics():
    """契约钉死：mock 默认行业常量是「物流行业」，改名必须连带改迁移语义评估。"""
    assert DEFAULT_INDUSTRY == "物流行业"


def _industry_cases():
    """The five mock-generation templates, each with its render model and the
    data keys it needs beyond the shared window/industry."""
    from open_notebook.ai.project_env_pipeline import (
        MaterialsBundle,
        MockDraft,
        RoutesBundle,
    )

    route = {
        "id": "r1",
        "title": "数据中台路线",
        "summary": "一句话概括",
        "tech_stack": ["Kafka 3.7"],
        "scale": "日增量 2 亿条事件",
        "role": "我担任架构师",
        "highlights": ["难点一"],
        "period": {"start": "2025.02", "end": "2025.09"},
    }
    return [
        (
            "project_env/mock_generate",
            MockDraft,
            {
                "keywords": ["微服务"],
                "name": "",
                "fixed_period_start": "",
                "fixed_period_end": "",
                "feedback": "",
            },
        ),
        (
            "project_env/materials_generate",
            MaterialsBundle,
            {
                "keywords": ["微服务"],
                "name": "",
                "fixed_period_start": "",
                "fixed_period_end": "",
            },
        ),
        (
            "project_env/routes_generate",
            RoutesBundle,
            {
                "keywords": ["微服务"],
                "name": "",
                "fixed_period_start": "2025.02",
                "fixed_period_end": "2025.09",
            },
        ),
        (
            "project_env/draft_from_materials",
            MockDraft,
            {
                "keywords": ["微服务"],
                "selected_items": [
                    {
                        "category": "background",
                        "title": "电商缓存改造",
                        "text": "背景片段采用 Redis 7.0。",
                    }
                ],
                "name": "",
                "fixed_period_start": "",
                "fixed_period_end": "",
                "feedback": "",
            },
        ),
        (
            "project_env/draft_from_route",
            MockDraft,
            {
                "keywords": ["微服务"],
                "route": route,
                "name": "",
                "fixed_period_start": "",
                "fixed_period_end": "",
                "feedback": "",
            },
        ),
    ]


_INDUSTRY_TEMPLATE_IDS = [
    "mock_generate",
    "materials_generate",
    "routes_generate",
    "draft_from_materials",
    "draft_from_route",
]


@pytest.mark.parametrize(
    "template,model,base", _industry_cases(), ids=_INDUSTRY_TEMPLATE_IDS
)
def test_mock_templates_render_industry_and_forbidden_topics(template, model, base):
    """契约 1：COMPANY CONTEXT 必须携带行业名并点名禁写内容。行业名缺失时
    模型只能编造行业；禁写清单不点名则合同金额/团队人数叙事照常出现。"""
    text = _render(template, model, {"industry": "物流行业", **base, **_WINDOW})

    # COMPANY CONTEXT 携带行业名（自研视角）
    assert "「物流行业」" in text
    assert "自研" in text
    # 负面约束点名：合同金额等金额数字、交付方叙事、团队规模
    assert "合同金额" in text
    assert "甲方" in text and "乙方" in text
    assert "外包" in text
    assert "团队人数" in text and "团队规模" in text


@pytest.mark.parametrize(
    "template,model,base", _industry_cases(), ids=_INDUSTRY_TEMPLATE_IDS
)
def test_mock_templates_background_guidance_never_directs_client_narrative(
    template, model, base
):
    """契约 1：background 字段指导不得引导甲方叙事（只允许自研视角）。
    甲方一词只应出现在「严禁出现」清单里。"""
    text = _render(template, model, {"industry": "物流行业", **base, **_WINDOW})

    guidance = [
        line.strip()
        for line in text.splitlines()
        if line.lstrip().startswith("- background:") and "项目背景" in line
    ]
    if not guidance:  # routes_generate 无 background 字段
        assert template == "project_env/routes_generate"
        return
    assert guidance, "background 字段指导行必须存在"
    for line in guidance:
        assert "甲方" not in line
        assert "自研" in line


@pytest.mark.parametrize(
    "template,model,base", _industry_cases(), ids=_INDUSTRY_TEMPLATE_IDS
)
def test_mock_templates_scale_guidance_never_directs_team_size(template, model, base):
    """契约 1：scale 字段指导不得引导团队人数/团队规模，只写数据量/用户量。"""
    text = _render(template, model, {"industry": "物流行业", **base, **_WINDOW})

    guidance = [
        line.strip()
        for line in text.splitlines()
        if line.lstrip().startswith("- scale:") and ("规模" in line)
    ]
    assert guidance, "scale 字段指导行必须存在"
    for line in guidance:
        assert "团队" not in line


# --- pipeline 层行业兜底（契约 2 的空/空白→默认） ---


class TestPipelineIndustryFallback:
    """五个生成函数必须把空/空白行业替换为 DEFAULT_INDUSTRY 再渲染：老行
    （迁移 40 之前创建，industry=None）与手写空串都走这条兜底路径。"""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("blank", [None, "", "   "], ids=["none", "empty", "blank"])
    async def test_blank_industry_falls_back_to_default_in_all_five(self, blank):
        import open_notebook.ai.project_env_pipeline as pipeline

        captured: dict = {}

        async def fake_invoke(
            template,
            data,
            result_model,
            model_id,
            budget=None,
            validator=None,
            max_tokens=4096,
        ):
            captured[template] = data
            return result_model()

        with patch.object(pipeline, "_invoke_json", fake_invoke):
            await pipeline.render_mock(["k"], None, None, None, industry=blank)
            await pipeline.generate_materials(["k"], None, None, None, industry=blank)
            await pipeline.generate_routes(["k"], None, None, None, industry=blank)
            await pipeline.render_materials_draft(
                ["k"],
                [{"category": "background", "title": "t", "text": "x"}],
                None,
                None,
                None,
                industry=blank,
            )
            await pipeline.render_route_draft(
                ["k"], {"id": "r1"}, None, None, None, industry=blank
            )

        assert sorted(captured) == sorted(
            [
                "project_env/mock_generate",
                "project_env/materials_generate",
                "project_env/routes_generate",
                "project_env/draft_from_materials",
                "project_env/draft_from_route",
            ]
        )
        assert all(
            data["industry"] == DEFAULT_INDUSTRY for data in captured.values()
        ), captured

    @pytest.mark.asyncio
    async def test_real_industry_passes_through_stripped(self):
        import open_notebook.ai.project_env_pipeline as pipeline

        captured: dict = {}

        async def fake_invoke(
            template,
            data,
            result_model,
            model_id,
            budget=None,
            validator=None,
            max_tokens=4096,
        ):
            captured[template] = data
            return result_model()

        with patch.object(pipeline, "_invoke_json", fake_invoke):
            await pipeline.render_mock(["k"], None, None, None, industry="  医疗行业  ")
            await pipeline.generate_materials(
                ["k"], None, None, None, industry="医疗行业"
            )

        assert captured["project_env/mock_generate"]["industry"] == "医疗行业"
        assert captured["project_env/materials_generate"]["industry"] == "医疗行业"
