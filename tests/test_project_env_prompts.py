"""Rendered-prompt regression tests for project_env templates.

verify_point_lane passes `mode` in the render data of verify_b: mock mode must
steer the model to a plausibility judgement (never off_table), material mode
must keep the off_table bounce. If the mode value never reaches the rendered
text, the model sees both rules with no way to tell which one applies — the
runtime validator becomes the only guard and every mock off_table answer costs
a wasted retry, while material mode risks GA dates judged from memory.
"""

from pathlib import Path
from types import SimpleNamespace
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
    assert "AI-simulated fiction" in text
    assert MOCK_PLAUSIBILITY in text


def test_verify_b_material_render_drops_off_table_bounce():
    text = _render_b("material")

    assert OFF_TABLE_BOUNCE not in text
    assert "candidate-written material" in text
    assert '"off_table" is retired' in text


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


def _render_generic_paragraph(source_type: str, industry: str = "") -> str:
    return Prompter(prompt_template="project_env/generic_paragraph").render(
        data={
            "name": "电商平台重构",
            "period_start": "2025.01",
            "period_end": "2025.08",
            "source_type": source_type,
            "industry": industry,
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


# --- 自研视角约束（四类叙事生成模板不得产出承建/交付腔） ---


def test_generic_paragraph_template_carries_self_developed_constraint_with_industry():
    text = _render_generic_paragraph("real", industry="物流行业")
    assert "「物流行业」" in text
    assert "公司自研" in text  # 禁令点名禁写的字样
    assert "隐性视角" in text  # 自研是隐性设定，不写进正文
    assert "我司启动" in text  # 论文惯例开头句式
    assert "公司简介" in text  # 禁公司简介式开头
    assert "甲方/乙方、外包、中标、承建、承接、验收交付" in text


def test_generic_paragraph_template_self_developed_degrades_without_industry():
    text = _render_generic_paragraph("real", industry="")
    assert "公司自研" in text
    assert "隐性视角" in text
    assert "我司启动" in text
    assert "「」" not in text  # 空行业不得渲染出空括号


def test_suggest_rewrite_template_carries_self_developed_constraint():
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
            "issues": [],
            "narrative": "",
            "period_start": "2025.01",
            "period_end": "2025.08",
        }
    )
    assert "隐性视角" in text
    assert "甲方/乙方、外包、中标、承建、承接、验收交付" in text


def test_corrector_template_carries_self_developed_constraint():
    text = Prompter(prompt_template="project_env/corrector").render(
        data={
            "quote": "缓存采用 Redis 9.9。",
            "field": "background",
            "issues": [],
            "narrative": "",
            "period_start": "2025.01",
            "period_end": "2025.08",
        }
    )
    assert "隐性视角" in text
    assert "甲方/乙方、外包、中标、承建、承接、验收交付" in text


def test_compress_template_carries_self_developed_constraint():
    # compress_draft renders with data={"draft": ...} only; format_instructions
    # stays undefined (renders empty) — same as the pipeline call.
    text = Prompter(prompt_template="project_env/compress").render(
        data={"draft": {"background": "微服务化改造。"}}
    )
    assert "隐性视角" in text
    assert "甲方/乙方、外包、中标、承建、承接、验收交付" in text


# --- PRD 导入解析（prd-parse） ---


def test_prd_parse_template_has_schema_and_bans_scale():
    """契约：模板必须带 format_instructions 注入口与「绝不输出 scale」禁令；
    输出结构本身没有 scale 字段（Pydantic 硬删第一层）。"""
    from open_notebook.ai.project_env_pipeline import PrdParseDraft

    parser: PydanticOutputParser = PydanticOutputParser(pydantic_object=PrdParseDraft)
    text = Prompter(
        prompt_template="project_env/prd_parse",
        parser=parser,  # type: ignore[arg-type]
    ).render(data={"prd_text": "本项目为物流行业 TMS 运输管理系统的建设需求。"})

    assert '"properties"' in text  # format_instructions schema 注入成功
    assert '"scale"' not in text  # 输出结构无 scale 字段
    assert "绝不输出 scale" in text  # 禁令逐字在位
    assert "YYYY.MM" in text  # period 规范化口径
    assert "宁缺勿造" in text  # keywords 口径


@pytest.mark.asyncio
async def test_parse_prd_draft_passes_through_to_invoke_json():
    """透传契约：模板名/数据/模型/max_tokens 固定，无 CallBudget。"""
    from unittest.mock import patch

    import open_notebook.ai.project_env_pipeline as pipeline
    from open_notebook.ai.project_env_pipeline import PrdParseDraft

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
        captured.update(
            template=template,
            data=data,
            result_model=result_model,
            model_id=model_id,
            budget=budget,
            validator=validator,
            max_tokens=max_tokens,
        )
        return PrdParseDraft(name="TMS 系统")

    with (
        patch.object(pipeline, "_invoke_json", fake_invoke),
        patch.object(pipeline, "get_light_model", lambda: "model:light"),
    ):
        result = await pipeline.parse_prd_draft("PRD 原文……")

    assert isinstance(result, PrdParseDraft)
    assert captured["template"] == "project_env/prd_parse"
    assert captured["data"] == {"prd_text": "PRD 原文……"}
    assert captured["result_model"] is PrdParseDraft
    assert captured["model_id"] == "model:light"
    assert captured["budget"] is None
    assert captured["max_tokens"] == 8192
    assert captured["validator"] is not None


@pytest.mark.asyncio
async def test_parse_prd_draft_validator_rejects_bad_period():
    """validator 契约：period 非空则必须匹配 MONTH_RE。"""
    from open_notebook.ai.project_env_pipeline import PrdParseDraft
    from open_notebook.domain.project_env_rules import MONTH_RE

    def _validate(parsed: PrdParseDraft) -> str:
        for field in ("period_start", "period_end"):
            value = getattr(parsed, field).strip()
            if value and not MONTH_RE.match(value):
                return f"{field} must use the YYYY.MM format"
        return ""

    ok = PrdParseDraft(period_start="2025.02", period_end="2025.09")
    bad = PrdParseDraft(period_start="2025-02")
    empty = PrdParseDraft()
    assert _validate(ok) == ""
    assert _validate(empty) == ""
    assert "period_start" in _validate(bad)


# --- PRD 导入 mock 起草（draft_from_prd） ---


def _render_prd_draft(prd_seed: dict, keywords: list = None) -> str:
    from open_notebook.ai.project_env_pipeline import MockDraft

    return _render(
        "project_env/draft_from_prd",
        MockDraft,
        {
            "keywords": keywords if keywords is not None else ["微服务"],
            "prd_seed": prd_seed,
            "name": "TMS 系统",
            "fixed_period_start": "",
            "fixed_period_end": "",
            "industry": "物流行业",
            "industry_hint": "",
            "industry_profile": None,
            "feedback": "",
            **_WINDOW,
        },
    )


def test_draft_from_prd_template_carries_forbidden_topics_and_legal_window():
    """契约：防穿帮三分类禁令与合法时间窗必须逐字在位（约束优先于 PRD）。"""
    text = _render_prd_draft(
        {
            "background": "PRD 背景。",
            "tech_background": "",
            "tuning_process": "",
            "problems_solutions": "",
            "my_role": "",
        }
    )

    assert "① 人员类" in text and "② 资金类" in text and "③ 规模类" in text
    assert "甲方" in text and "外包" in text
    assert "2026.10" in text  # now_month
    assert "2024.12" in text  # legal_start_earliest
    assert "2025.09" in text  # legal_end_latest
    assert "约束冲突时约束优先" in text  # REWRITE RULES
    assert '"scale"' in text  # MockDraft 六字段 schema 注入


def test_draft_from_prd_template_renders_seed_fields_conditionally():
    """契约：seed 逐字段条件渲染；全空时输出按关键词生成兜底句。"""
    seed = {
        "background": "PRD 背景原文。",
        "tech_background": "",
        "tuning_process": "PRD 调优原文。",
        "problems_solutions": "",
        "my_role": "",
    }
    text = _render_prd_draft(seed, keywords=["TMS", "物流"])
    assert "[background PRD 提取]\nPRD 背景原文。" in text
    assert "[tuning_process PRD 提取]\nPRD 调优原文。" in text
    assert "tech_background PRD 提取" not in text
    assert "PRD 未提供可用叙述" not in text
    assert "- TMS" in text and "- 物流" in text

    empty = {field: "" for field in seed}
    text_empty = _render_prd_draft(empty, keywords=["TMS"])
    assert "PRD 未提供可用叙述，按关键词生成" in text_empty
    for field in seed:
        assert f"[{field} PRD 提取]" not in text_empty


def test_draft_from_prd_template_feedback_gate():
    seed = {
        "background": "PRD 背景原文。",
        "tech_background": "",
        "tuning_process": "",
        "problems_solutions": "",
        "my_role": "",
    }
    base = {
        "keywords": ["微服务"],
        "prd_seed": seed,
        "name": "",
        "fixed_period_start": "",
        "fixed_period_end": "",
        "industry": "物流行业",
        "industry_hint": "",
        "industry_profile": None,
        "feedback": "",
        **_WINDOW,
    }
    from open_notebook.ai.project_env_pipeline import MockDraft

    text = _render("project_env/draft_from_prd", MockDraft, base)
    assert "PREVIOUS ATTEMPT FEEDBACK" not in text

    base["feedback"] = "R2: span must be 6-10 months"
    text_fb = _render("project_env/draft_from_prd", MockDraft, base)
    assert "PREVIOUS ATTEMPT FEEDBACK" in text_fb
    assert "R2: span must be 6-10 months" in text_fb


def test_draft_from_prd_template_requires_ga_before_period_start():
    """契约：GA-before-start 约束逐字在位（PRD 技术版本照抄豁免权不存在）。"""
    text = _render_prd_draft({"background": "PRD 背景。"})
    assert "GA 晚于 period_start" in text  # 中文改写规则
    assert "general availability (GA) before period_start" in text  # 英文总则


@pytest.mark.asyncio
async def test_render_prd_draft_passes_through_to_invoke_json():
    """透传契约：模板名/MockDraft 输出/max_tokens 8192/seed 与行业兜底、
    合法时间窗随 data 下发。"""
    from unittest.mock import patch

    import open_notebook.ai.project_env_pipeline as pipeline
    from open_notebook.ai.project_env_pipeline import MockDraft

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
        captured.update(
            template=template,
            data=data,
            result_model=result_model,
            model_id=model_id,
            budget=budget,
            validator=validator,
            max_tokens=max_tokens,
        )
        return MockDraft(name="TMS 系统")

    seed = {"background": "PRD 背景。", "tech_background": "PRD 技术栈。"}
    budget = pipeline.CallBudget()
    with patch.object(pipeline, "_invoke_json", fake_invoke):
        result = await pipeline.render_prd_draft(
            keywords=["TMS", "物流"],
            prd_seed=seed,
            name="TMS 系统",
            period_start="2025.02",
            period_end="2025.09",
            industry="   ",
            budget=budget,
        )

    assert isinstance(result, MockDraft)
    assert captured["template"] == "project_env/draft_from_prd"
    assert captured["result_model"] is MockDraft
    assert captured["model_id"] is None
    assert captured["budget"] is budget
    assert captured["max_tokens"] == 8192
    data = captured["data"]
    assert data["prd_seed"] is seed
    assert data["keywords"] == ["TMS", "物流"]
    assert data["fixed_period_start"] == "2025.02"
    assert data["fixed_period_end"] == "2025.09"
    assert data["industry"] == DEFAULT_INDUSTRY  # 空白行业兜底
    for key in _WINDOW:  # 合法时间窗键随 data 下发
        assert key in data


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
    """契约 1：COMPANY CONTEXT 必须携带行业名并点名「人员/规模/资金」三类禁写
    与可保留边界。行业名缺失时模型只能编造行业；禁写清单不点名则团队人数/
    金额数字/用户规模叙事照常出现。"""
    text = _render(template, model, {"industry": "物流行业", **base, **_WINDOW})

    # COMPANY CONTEXT 携带行业名（自研视角）
    assert "「物流行业」" in text
    assert "自研" in text
    # 三分类禁令逐类点名
    assert "① 人员类" in text
    assert "② 资金类" in text
    assert "③ 规模类" in text
    # 人员类：团队人数/团队规模
    assert "团队人数" in text and "团队规模" in text
    # 资金类：金额数字与交付方叙事
    assert "合同金额" in text
    assert "甲方" in text and "乙方" in text
    assert "外包" in text
    assert "成本下降" in text  # 成本类效果数据也禁写
    # 规模类：用户规模数字与「项目规模」式段落
    assert "用户量" in text and "注册用户" in text
    assert "项目规模" in text
    # 可保留边界与清洗器放过口径一致（避免「生成即被清洗」内耗）
    assert "带领团队完成攻关" in text
    assert "自筹资金" in text
    assert "并发量、吞吐量、数据规模" in text


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
def test_mock_templates_scale_guidance_keeps_technical_capacity(template, model, base):
    """契约 1：scale 字段指导改口径为「技术容量」——点名并发量/数据规模，
    显式禁写用户量，且旧「项目规模」口径退场。（过滤条件 100-200/技术容量
    用于跳过 draft_from_route 里原样回显的「- scale: {{ route.scale }}」行，
    那是用户所选路线的数据，不是字段指导。）"""
    text = _render(template, model, {"industry": "物流行业", **base, **_WINDOW})

    guidance = [
        line.strip()
        for line in text.splitlines()
        if line.lstrip().startswith("- scale:")
        and ("100-200" in line or "技术容量" in line)
    ]
    assert guidance, "scale 字段指导行必须存在"
    for line in guidance:
        assert "技术容量" in line
        assert "不写用户量" in line
        assert "项目规模" not in line
        assert "用户量、注册用户" not in line  # 旧「数据量、用户量」指导退场


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


# --- 行业业务特征提示注入（industry_hint，方案 B：后端按行业名查表） ---

HINT_MARKER = "该行业业务特征参考："
POOL_INDUSTRY = "银行核心系统改造"


@pytest.mark.parametrize(
    "template,model,base", _industry_cases(), ids=_INDUSTRY_TEMPLATE_IDS
)
def test_mock_templates_render_industry_hint_line(template, model, base):
    """契约 3：池内行业渲染时必须把业务特征提示逐字带进 COMPANY CONTEXT，
    让 mock 项目背景贴合行业真实业务面。"""
    from open_notebook.ai.industry_pool import INDUSTRY_HINTS

    hint = INDUSTRY_HINTS[POOL_INDUSTRY]
    text = _render(
        template,
        model,
        {
            "industry": POOL_INDUSTRY,
            "industry_hint": hint,
            **base,
            **_WINDOW,
        },
    )

    assert HINT_MARKER + hint in text


@pytest.mark.parametrize(
    "template,model,base", _industry_cases(), ids=_INDUSTRY_TEMPLATE_IDS
)
def test_mock_templates_drop_hint_line_without_hint(template, model, base):
    """契约 3 退化：空串或键缺省（池外自定义行业 / 默认行业 / 老数据）都不得
    渲染出提示行。"""
    for extra in ({"industry_hint": ""}, {}):
        text = _render(
            template, model, {"industry": "医疗行业", **extra, **base, **_WINDOW}
        )
        assert HINT_MARKER not in text
        assert "该行业业务特征参考" not in text


# 5 个模板中注入的条件行（逐字一致；read_text 的 universal newlines 把 CRLF
# 归一为 LF，与 jinja loader 的读取口径相同）
INJECTED_HINT_LINES = (
    "{%- if industry_hint %}\n- 该行业业务特征参考：{{ industry_hint }}\n{%- endif %}\n"
)


def _template_source(template: str) -> str:
    name = template.rsplit("/", 1)[-1]
    path = (
        Path(__file__).resolve().parents[1]
        / "prompts"
        / "project_env"
        / f"{name}.jinja"
    )
    return path.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "template,model,base", _industry_cases(), ids=_INDUSTRY_TEMPLATE_IDS
)
def test_templates_without_hint_byte_identical_to_pre_injection(template, model, base):
    """契约 3 退化逐字节锁定：剥离注入行后的模板源（= 注入前现状）与现模板在
    industry_hint 为空串时渲染结果必须逐字节一致——`{%- -%}` 空白控制保证
    提示机制对无提示场景零足迹。"""
    source = _template_source(template)
    assert INJECTED_HINT_LINES in source  # 注入行在位，剥离才有意义
    data = {"industry": POOL_INDUSTRY, "industry_hint": "", **base, **_WINDOW}
    now = Prompter(prompt_template=template).render(data=dict(data))
    pre_injection = Prompter(
        template_text=source.replace(INJECTED_HINT_LINES, "")
    ).render(data=dict(data))
    assert now == pre_injection


async def _capture_five(industry):
    """Run the five main-chain functions, capturing each template's render data
    (same _invoke_json patch as TestPipelineIndustryFallback)."""
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
        await pipeline.render_mock(["k"], None, None, None, industry=industry)
        await pipeline.generate_materials(["k"], None, None, None, industry=industry)
        await pipeline.generate_routes(["k"], None, None, None, industry=industry)
        await pipeline.render_materials_draft(
            ["k"],
            [{"category": "background", "title": "t", "text": "x"}],
            None,
            None,
            None,
            industry=industry,
        )
        await pipeline.render_route_draft(
            ["k"], {"id": "r1"}, None, None, None, industry=industry
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
    return captured


class TestPipelineIndustryHint:
    """五主链函数在渲染时按行业名现场推导 industry_hint（不落库、不随请求
    走，四条重发路径天然一致）；旁路 generic_paragraph / fixed_parts 不注入
    （设计稿 ③ 3.4：ADR-017 收窄面不扩写 + 双模式风险）。"""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("blank", [None, "", "   "], ids=["none", "empty", "blank"])
    async def test_blank_industry_yields_no_hint_in_all_five(self, blank):
        captured = await _capture_five(blank)

        assert all(
            data["industry"] == DEFAULT_INDUSTRY for data in captured.values()
        ), captured
        assert all(data["industry_hint"] == "" for data in captured.values()), captured

    @pytest.mark.asyncio
    async def test_off_pool_industry_yields_no_hint(self):
        captured = await _capture_five("医疗行业")

        assert all(data["industry"] == "医疗行业" for data in captured.values()), (
            captured
        )
        assert all(data["industry_hint"] == "" for data in captured.values()), captured

    @pytest.mark.asyncio
    async def test_pool_industry_derives_hint_in_all_five(self):
        from open_notebook.ai.industry_pool import INDUSTRY_HINTS

        captured = await _capture_five(POOL_INDUSTRY)

        expected = INDUSTRY_HINTS[POOL_INDUSTRY]
        assert expected  # 池内行业必有非空提示
        assert all(data["industry"] == POOL_INDUSTRY for data in captured.values()), (
            captured
        )
        assert all(data["industry_hint"] == expected for data in captured.values()), (
            captured
        )

    @pytest.mark.asyncio
    async def test_bypass_paths_do_not_inject_industry_hint(self):
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

        class StubPrompter:
            def __init__(self, *args, **kwargs):
                pass

            def render(self, data=None):
                captured["project_env/generic_paragraph"] = dict(data or {})
                return "PROMPT"

        async def fake_provision(_prompt, *_args, **_kwargs):
            async def ainvoke(_p):
                return SimpleNamespace(content="段落正文")

            return SimpleNamespace(langchain_model=SimpleNamespace(ainvoke=ainvoke))

        with (
            patch.object(pipeline, "_invoke_json", fake_invoke),
            patch.object(pipeline, "Prompter", StubPrompter),
            patch.object(
                pipeline, "provision_langchain_model_with_info", fake_provision
            ),
        ):
            await pipeline.render_generic_paragraph(
                "电商平台重构",
                "2025.01",
                "2025.08",
                "mock",
                {"background": "微服务化改造"},
                industry=POOL_INDUSTRY,
            )
            await pipeline.render_fixed_parts(
                "电商平台重构",
                "2025.01",
                "2025.08",
                "mock",
                {"background": "微服务化改造"},
                industry=POOL_INDUSTRY,
            )

        assert "industry_hint" not in captured["project_env/generic_paragraph"]
        assert "industry_hint" not in captured["project_env/fixed_parts"]
        # industry 键保持原语义：池内行业名直传，不追加提示
        assert captured["project_env/generic_paragraph"]["industry"] == POOL_INDUSTRY
        assert "industry_profile" not in captured["project_env/generic_paragraph"]
        assert "industry_profile" not in captured["project_env/fixed_parts"]


# --- 行业画像注入（industry_profile，与 industry_hint 同型的方案 B 注入） ---

PROFILE_LINE_MARKERS = (
    "常见项目形态参考：",
    "典型技术栈参考：",
    "核心业务流程参考：",
)
POOL_PROFILE_INDUSTRY = "高校在线教考（程序评测）"  # 池内且有画像覆盖

# 5 个模板中注入的条件块（逐字一致；read_text 的 universal newlines 把
# CRLF 归一为 LF，与 jinja loader 的读取口径相同）
INJECTED_PROFILE_LINES = (
    "{%- if industry_profile %}\n"
    "- 常见项目形态参考：{{ industry_profile.project_forms | join('；') }}\n"
    "- 典型技术栈参考：{{ industry_profile.tech_stack | join('；') }}\n"
    "- 核心业务流程参考：{{ industry_profile.business_flows | join('；') }}\n"
    "{%- endif %}\n"
)


@pytest.mark.parametrize(
    "template,model,base", _industry_cases(), ids=_INDUSTRY_TEMPLATE_IDS
)
def test_mock_templates_render_industry_profile_lines(template, model, base):
    """契约 4：有画像的池内行业在 hint 行后渲染独立画像块，三条目逐字在位。"""
    from open_notebook.ai.industry_pool import INDUSTRY_HINTS, INDUSTRY_PROFILES

    profile = INDUSTRY_PROFILES[POOL_PROFILE_INDUSTRY]
    text = _render(
        template,
        model,
        {
            "industry": POOL_PROFILE_INDUSTRY,
            "industry_hint": INDUSTRY_HINTS[POOL_PROFILE_INDUSTRY],
            "industry_profile": profile,
            **base,
            **_WINDOW,
        },
    )

    assert "常见项目形态参考：" + "；".join(profile["project_forms"]) in text
    assert "典型技术栈参考：" + "；".join(profile["tech_stack"]) in text
    assert "核心业务流程参考：" + "；".join(profile["business_flows"]) in text
    # 画像块紧跟 hint 行之后（现状 1 行 + 新 3 行）
    assert text.index(HINT_MARKER) < text.index(PROFILE_LINE_MARKERS[0])


@pytest.mark.parametrize(
    "template,model,base", _industry_cases(), ids=_INDUSTRY_TEMPLATE_IDS
)
def test_mock_templates_drop_profile_lines_without_profile(template, model, base):
    """契约 4 退化：industry_profile 为 None 或键缺省（池内无画像 / 池外
    自定义行业 / 默认行业 / 老数据）都不得渲染出画像行。"""
    for extra in ({"industry_profile": None}, {}):
        text = _render(
            template,
            model,
            {
                "industry": POOL_INDUSTRY,
                "industry_hint": "",
                **extra,
                **base,
                **_WINDOW,
            },
        )
        for marker in PROFILE_LINE_MARKERS:
            assert marker not in text


@pytest.mark.parametrize(
    "template,model,base", _industry_cases(), ids=_INDUSTRY_TEMPLATE_IDS
)
def test_templates_without_profile_byte_identical_to_pre_injection(
    template, model, base
):
    """契约 4 退化逐字节锁定：剥离画像块后的模板源（= 注入前现状）与现模板
    在 industry_profile=None 时渲染结果必须逐字节一致（hint 行照常渲染）——
    `{%- -%}` 空白控制保证画像机制对无画像场景零足迹。"""
    from open_notebook.ai.industry_pool import INDUSTRY_HINTS

    source = _template_source(template)
    assert INJECTED_PROFILE_LINES in source  # 画像块在位，剥离才有意义
    data = {
        "industry": POOL_INDUSTRY,
        "industry_hint": INDUSTRY_HINTS[POOL_INDUSTRY],
        "industry_profile": None,
        **base,
        **_WINDOW,
    }
    now = Prompter(prompt_template=template).render(data=dict(data))
    pre_injection = Prompter(
        template_text=source.replace(INJECTED_PROFILE_LINES, "")
    ).render(data=dict(data))
    assert now == pre_injection


class TestPipelineIndustryProfile:
    """五主链函数在渲染时按行业名现场推导 industry_profile（不落库、不随
    请求走）；池内无画像 / 池外 / 空白行业一律 None。"""

    @pytest.mark.asyncio
    async def test_pool_industry_with_profile_derives_profile_in_all_five(self):
        from open_notebook.ai.industry_pool import INDUSTRY_PROFILES

        captured = await _capture_five(POOL_PROFILE_INDUSTRY)

        expected = INDUSTRY_PROFILES[POOL_PROFILE_INDUSTRY]
        assert expected  # 该池内行业必有画像
        assert all(
            data["industry_profile"] == expected for data in captured.values()
        ), captured

    @pytest.mark.asyncio
    @pytest.mark.parametrize("blank", [None, "", "   "], ids=["none", "empty", "blank"])
    async def test_blank_industry_yields_no_profile_in_all_five(self, blank):
        captured = await _capture_five(blank)

        assert all(data["industry_profile"] is None for data in captured.values()), (
            captured
        )

    @pytest.mark.asyncio
    async def test_pool_industry_without_profile_yields_none(self):
        captured = await _capture_five("智慧城管")  # 池内 hint-only 行业

        assert all(data["industry_profile"] is None for data in captured.values()), (
            captured
        )

    @pytest.mark.asyncio
    async def test_off_pool_industry_yields_no_profile(self):
        captured = await _capture_five("医疗行业")

        assert all(data["industry_profile"] is None for data in captured.values()), (
            captured
        )
