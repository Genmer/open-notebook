"""
Unit tests for open_notebook/utils/text_cleaning.py (watermark/footer
denoising before embedding) and its wiring into embed_source_command.

The fixture mimics a real PDF-extracted textbook page: the same short
chapter header on every page, page footers (第 N 页 / - N - / bare number)
and a vertical watermark rendered one character per line.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from commands.embedding_commands import EmbedSourceInput, embed_source_command
from open_notebook.domain.notebook import Source
from open_notebook.utils.text_cleaning import clean_source_text

# 19 non-empty lines: 10 content + 9 noise (47% < the 50% fail-safe).
NOISY_SAMPLE = "\n".join(
    [
        "第 3 章",
        "微服务治理概述",
        "服务注册与发现负责服务实例的上线、下线与健康检查，是治理的第一块基石。",
        "配置中心集中管理服务的配置项，支持动态推送与版本回滚，避免重启生效。",
        "微",
        "服",
        "务",
        "熔断与降级在依赖服务异常时保护调用方，避免故障沿调用链持续放大。",
        "第 12 页",
        "第 3 章",
        "服务网格将流量治理从业务代码中剥离，交由独立的 Sidecar 代理完成。",
        "链路追踪把一次请求经过的所有服务串联起来，是定位分布式故障的关键。",
        "- 12 -",
        "第 3 章",
        "12",
        "可观测性涵盖指标、日志与追踪三大支柱，是治理效果量化的基础。",
        "弹性伸缩依据负载自动调整实例数量，与治理策略协同保障可用性目标。",
        "灰度发布先在小范围验证新版本，再逐步扩大流量以降低变更风险。",
        "治理平面的设计目标是将策略与数据面解耦，支持故障演练与混沌工程。",
    ]
)

CLEANED_LINES = [
    "微服务治理概述",
    "服务注册与发现负责服务实例的上线、下线与健康检查，是治理的第一块基石。",
    "配置中心集中管理服务的配置项，支持动态推送与版本回滚，避免重启生效。",
    "熔断与降级在依赖服务异常时保护调用方，避免故障沿调用链持续放大。",
    "服务网格将流量治理从业务代码中剥离，交由独立的 Sidecar 代理完成。",
    "链路追踪把一次请求经过的所有服务串联起来，是定位分布式故障的关键。",
    "可观测性涵盖指标、日志与追踪三大支柱，是治理效果量化的基础。",
    "弹性伸缩依据负载自动调整实例数量，与治理策略协同保障可用性目标。",
    "灰度发布先在小范围验证新版本，再逐步扩大流量以降低变更风险。",
    "治理平面的设计目标是将策略与数据面解耦，支持故障演练与混沌工程。",
]


class TestCleanSourceText:
    def test_drops_watermark_footer_and_repeated_header(self):
        cleaned = clean_source_text(NOISY_SAMPLE)
        assert cleaned == "\n".join(CLEANED_LINES)
        for noise in ("第 3 章", "第 12 页", "- 12 -"):
            assert noise not in cleaned

    def test_is_idempotent(self):
        assert clean_source_text(clean_source_text(NOISY_SAMPLE)) == "\n".join(
            CLEANED_LINES
        )

    def test_footer_patterns_international(self):
        text = "\n".join(
            [
                "Page 12 of 300",
                "正文内容一，讲解架构评估方法。",
                "第 12 页，共 300 页",
                "正文内容二，讲解质量属性场景。",
                "·7·",
                "正文内容三，讲解架构演进路线。",
            ]
        )
        assert clean_source_text(text) == "\n".join(
            [
                "正文内容一，讲解架构评估方法。",
                "正文内容二，讲解质量属性场景。",
                "正文内容三，讲解架构演进路线。",
            ]
        )

    def test_repeated_long_lines_are_kept(self):
        long_line = (
            "这一段内容在文档中出现了三次，但足够长，属于正文引用而非页眉页脚水印。"
        )
        text = "\n".join([long_line, "独立的一行。", long_line, "另一行。", long_line])
        assert clean_source_text(text).count(long_line) == 3

    def test_majority_noise_document_is_untouched(self):
        # A mostly-watermark document trips the fail-safe: dropping >50% of
        # the lines would mean the filter misread the document.
        text = "\n".join(["微", "服", "务", "第 1 页", "架", "构", "师"])
        assert clean_source_text(text) == text

    def test_clean_text_is_a_noop(self):
        text = "\n".join(["第一段正文，足够长所以不被误伤。", "第二段正文，同样保留。"])
        assert clean_source_text(text) == text

    @pytest.mark.parametrize("empty", ["", "   ", "\n\n"])
    def test_blank_input_returned_as_is(self, empty):
        assert clean_source_text(empty) == empty


class TestEmbedSourceUsesCleanedText:
    """embed_source_command must feed cleaned text (not raw) to chunk_text."""

    @pytest.mark.asyncio
    async def test_chunk_text_receives_denoised_text(self):
        source = MagicMock(spec=Source)
        source.id = "source:1"
        source.full_text = NOISY_SAMPLE
        source.asset = None
        source.embedding_status = None
        source.embedding_command = None
        source.set_embedding_state = AsyncMock()

        async def _one_batch(texts, command_id=None):
            yield [0.1]

        chunk_text = MagicMock(return_value=["c1"])
        with (
            patch.object(Source, "get", new=AsyncMock(return_value=source)),
            patch(
                "commands.embedding_commands.refresh_embedding_params",
                new=AsyncMock(),
            ),
            patch("commands.embedding_commands.repo_query", new=AsyncMock()),
            patch("commands.embedding_commands.repo_insert", new=AsyncMock()),
            patch("commands.embedding_commands.chunk_text", new=chunk_text),
            patch("commands.embedding_commands.iter_embedding_batches", new=_one_batch),
        ):
            output = await embed_source_command(EmbedSourceInput(source_id="source:1"))

        assert output.success is True
        assert chunk_text.call_count == 1
        assert chunk_text.call_args.args[0] == "\n".join(CLEANED_LINES)
