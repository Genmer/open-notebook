"""Rendered-prompt regression tests for project_env templates.

verify_point_lane passes `mode` in the render data of verify_b: mock mode must
steer the model to a plausibility judgement (never off_table), material mode
must keep the off_table bounce. If the mode value never reaches the rendered
text, the model sees both rules with no way to tell which one applies — the
runtime validator becomes the only guard and every mock off_table answer costs
a wasted retry, while material mode risks GA dates judged from memory.
"""

from ai_prompter import Prompter
from langchain_core.output_parsers.pydantic import PydanticOutputParser

from open_notebook.ai.project_env_pipeline import LaneVerdict

# material-mode bounce rule: "off_table — NEVER judge a GA date from memory"
OFF_TABLE_BOUNCE = 'verdict must be "off_table"'
# mock-mode plausibility rule (table miss is judged, not bounced)
MOCK_PLAUSIBILITY = "judge from general knowledge"


def _render_b(mode: str) -> str:
    """Render verify_b exactly the way verify_point_lane does (same parser,
    same data keys), so a template variable rename cannot pass silently."""
    parser = PydanticOutputParser(pydantic_object=LaneVerdict)
    return Prompter(prompt_template="project_env/verify_b", parser=parser).render(
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
