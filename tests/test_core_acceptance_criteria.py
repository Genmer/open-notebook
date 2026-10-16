"""Comprehensive acceptance tests covering core criteria T1 through T5.

T1: 业务变量过滤验收
T2: 事实通道清退无理逼问验收
T3: 时效通道“少说少露馅”验收
T4: 语境通道四大反模式审查验收
T5: 大模型 GA 语义推导验收

Strict rule: All tests must use mocked LLMs and network calls (no real web search or live API keys).
"""

from unittest.mock import AsyncMock, patch

import pytest
from ai_prompter import Prompter
from langchain_core.output_parsers.pydantic import PydanticOutputParser

from open_notebook.ai import project_env_pipeline as pipeline
from open_notebook.ai.project_env_pipeline import (
    GaResolution,
    LaneVerdict,
    anchors_table_for,
    extract_claims_regex,
    fetch_ga_anchor_online,
    prescreen_point_anchors,
    resolve_ga_with_llm,
    verify_point_lane,
)
from open_notebook.domain.project_env_rules import (
    GA_ANCHORS,
    check_ga_ordering,
    is_month,
    is_valid_tech_name,
)

WEB_SEARCH = "open_notebook.ai.project_env_pipeline.web_search"
GATHER_EVIDENCE = "open_notebook.ai.project_env_pipeline.gather_evidence"
RESOLVE_LLM = "open_notebook.ai.project_env_pipeline.resolve_ga_with_llm"


# ==============================================================================
# T1: 业务变量过滤验收
# ==============================================================================


class TestT1BusinessVariableFiltering:
    """T1 业务变量过滤验收:

    包含 siteId 1.0、districtCode 2.0、areaType 1.2 等业务字段的文本不会被提取为 version 类别，
    也不会触发 GA 搜索；而真正通用技术（如 MongoDB 5.0、Redis 7.0、Oracle Data Guard）正常识别。
    """

    @pytest.mark.parametrize(
        "var_name",
        ["siteId", "districtCode", "areaType", "orderId", "userId", "userStatus"],
    )
    def test_should_classify_business_variables_as_invalid_tech_names(
        self, var_name: str
    ):
        assert is_valid_tech_name(var_name) is False

    @pytest.mark.parametrize(
        "tech_name",
        ["MongoDB", "Redis", "Oracle Data Guard", "MySQL", "Spring Boot", "Kafka"],
    )
    def test_should_classify_genuine_technologies_as_valid_tech_names(
        self, tech_name: str
    ):
        assert is_valid_tech_name(tech_name) is True

    def test_should_not_extract_business_variables_as_version_claims(self):
        text = (
            "系统按照 siteId 1.0 进行数据分片，结合 districtCode 2.0 进行地址寻址，"
            "并依据 areaType 1.2 执行跨区域规则聚合。"
        )
        claims = extract_claims_regex({"background": text})
        version_claims = [c for c in claims if c["type"] == "version"]
        assert version_claims == []

    def test_should_extract_genuine_technologies_as_version_claims(self):
        text = (
            "底座数据存储采用 MongoDB 5.0 分片集群，高速缓存使用 Redis 7.0 主从架构，"
            "保障高吞吐与持久化可靠性。"
        )
        claims = extract_claims_regex({"background": text})
        version_claims = [c for c in claims if c["type"] == "version"]
        assert len(version_claims) >= 1
        assert version_claims[0]["type"] == "version"
        assert "MongoDB 5.0" in version_claims[0]["quote"]
        assert "Redis 7.0" in version_claims[0]["quote"]

    @pytest.mark.asyncio
    async def test_should_not_trigger_ga_search_for_business_variables_in_anchors_table(
        self,
    ):
        text = "系统根据 siteId 1.0 路由，按 districtCode 2.0 聚合，按照 areaType 1.2 进行计费。"
        with patch(WEB_SEARCH, new_callable=AsyncMock) as mock_search:
            table = await anchors_table_for(text)

        mock_search.assert_not_awaited()
        assert "siteId" not in table
        assert "districtCode" not in table
        assert "areaType" not in table

    @pytest.mark.asyncio
    async def test_should_not_trigger_ga_search_for_business_variables_in_prescreen(
        self,
    ):
        text = "系统按照 siteId 1.0 和 districtCode 2.0 及 areaType 1.2 路由分发。"
        with patch(WEB_SEARCH, new_callable=AsyncMock) as mock_search:
            result = await prescreen_point_anchors(text, "2024.01")

        mock_search.assert_not_awaited()
        assert result["status"] == "unspecified"
        assert result["anchors"] == {}

    @pytest.mark.asyncio
    async def test_should_identify_genuine_technologies_in_anchors_table_without_error(
        self,
    ):
        text = "平台采用 Redis 7.0 作为一级缓存，数据库采用 Oracle Data Guard 实现主备热备。"
        table = await anchors_table_for(text)
        assert "redis 7.0: 2022.05" in table
        assert is_valid_tech_name("Oracle Data Guard") is True


# ==============================================================================
# T2: 事实通道清退无理逼问验收
# ==============================================================================


class TestT2FactChannelNoUnreasonableInterrogation:
    """T2 事实通道清退无理逼问验收:

    本地知识库无企业私有文档时，自述私有业务指标（如“单次空间相交查询平均响应时间控制在 10ms 以内”、
    “形成从中心级到派送段的三段码闭环输出”）Lane A 默认 Pass，不再无脑报“无证据支持”。
    """

    def test_should_render_verify_a_prompt_with_default_pass_for_private_business_facts(
        self,
    ):
        parser: PydanticOutputParser[LaneVerdict] = PydanticOutputParser(
            pydantic_object=LaneVerdict
        )
        rendered = Prompter(
            prompt_template="project_env/verify_a",
            parser=parser,  # type: ignore[arg-type]
        ).render(
            data={
                "quote": "单次空间相交查询平均响应时间控制在 10ms 以内",
                "field": "tuning_process",
                "evidence": "(本地知识库中未检索到相关材料)",
                "anchor_table": "(空)",
            }
        )

        assert "DEFAULT PASS for private business facts" in rendered
        assert (
            "Lack of local KB evidence for these private facts is NORMAL and expected; they must DEFAULT TO"
            in rendered
        )
        assert (
            "NEVER fail or interrogate private business claims merely because local evidence does not mention them"
            in rendered
        )
        assert "Fabricated / Nonexistent Open-Source Tools" in rendered
        assert "Severe Physics / Engineering Impossibility" in rendered

    @pytest.mark.asyncio
    async def test_should_pass_private_latency_metric_when_kb_has_no_evidence(self):
        quote = "单次空间相交查询平均响应时间控制在 10ms 以内"
        field = "tuning_process"

        with (
            patch(
                GATHER_EVIDENCE,
                new_callable=AsyncMock,
                return_value="(本地知识库中未检索到相关材料)",
            ),
            patch.object(
                pipeline,
                "_invoke_json",
                new_callable=AsyncMock,
                return_value=LaneVerdict(verdict="pass", issues=[]),
            ) as mock_invoke,
        ):
            verdict = await verify_point_lane("A", quote, field, context={})

        assert verdict["verdict"] == "pass"
        assert verdict["issues"] == []
        mock_invoke.assert_awaited_once()
        invoked_template, invoked_data, *_ = mock_invoke.await_args.args
        assert invoked_template == "project_env/verify_a"
        assert invoked_data["quote"] == quote
        assert invoked_data["evidence"] == "(本地知识库中未检索到相关材料)"

    @pytest.mark.asyncio
    async def test_should_pass_private_domain_code_closed_loop_when_kb_has_no_evidence(
        self,
    ):
        quote = "形成从中心级到派送段的三段码闭环输出"
        field = "tech_background"

        with (
            patch(
                GATHER_EVIDENCE,
                new_callable=AsyncMock,
                return_value="(本地知识库中未检索到相关材料)",
            ),
            patch.object(
                pipeline,
                "_invoke_json",
                new_callable=AsyncMock,
                return_value=LaneVerdict(verdict="pass", issues=[]),
            ) as mock_invoke,
        ):
            verdict = await verify_point_lane("A", quote, field, context={})

        assert verdict["verdict"] == "pass"
        assert verdict["issues"] == []
        mock_invoke.assert_awaited_once()
        assert (
            mock_invoke.await_args.args[1]["evidence"]
            == "(本地知识库中未检索到相关材料)"
        )

    @pytest.mark.asyncio
    async def test_should_fail_in_lane_a_on_severe_physics_engineering_impossibility(
        self,
    ):
        quote = "单机单线程每秒完成百亿次数据库磁盘物理落盘写入"
        field = "tuning_process"

        fake_fail_verdict = LaneVerdict(
            verdict="fail",
            issues=["单机单线程百亿次数据库物理落盘写入严重违背磁盘物理规律与硬件极限"],
        )
        with (
            patch(
                GATHER_EVIDENCE,
                new_callable=AsyncMock,
                return_value="(本地知识库中未检索到相关材料)",
            ),
            patch.object(
                pipeline,
                "_invoke_json",
                new_callable=AsyncMock,
                return_value=fake_fail_verdict,
            ),
        ):
            verdict = await verify_point_lane("A", quote, field, context={})

        assert verdict["verdict"] == "fail"
        assert any("严重违背" in issue for issue in verdict["issues"])

    @pytest.mark.asyncio
    async def test_should_fail_in_lane_a_on_fabricated_open_source_technology(self):
        quote = "采用虚构的开源组件 FakeRocketDB 9.9 完成分布式存储"
        field = "tech_background"

        fake_fail_verdict = LaneVerdict(
            verdict="fail",
            issues=["FakeRocketDB 9.9 属于虚构捏造的开源技术组件"],
        )
        with (
            patch(
                GATHER_EVIDENCE,
                new_callable=AsyncMock,
                return_value="(本地知识库中未检索到相关材料)",
            ),
            patch.object(
                pipeline,
                "_invoke_json",
                new_callable=AsyncMock,
                return_value=fake_fail_verdict,
            ),
        ):
            verdict = await verify_point_lane("A", quote, field, context={})

        assert verdict["verdict"] == "fail"
        assert any("虚构" in issue for issue in verdict["issues"])


# ==============================================================================
# T3: 时效通道“少说少露馅”验收
# ==============================================================================


class TestT3TimelineLessIsMoreStrategy:
    """T3 时效通道“少说少露馅”验收:

    考生只写“依托 MongoDB 空间索引”、“采用 Oracle Data Guard”（未写版本号），
    只要项目起始时间在技术成熟后，Lane B 直接 Pass，严禁报警逼问版本号；
    若写了“MySQL 8.4”（2024.07）而在 2023 年项目使用，确凿判定 Fail 并指明时间穿越。
    """

    def test_should_render_verify_b_prompt_with_mature_tech_without_version_rule(self):
        parser: PydanticOutputParser[LaneVerdict] = PydanticOutputParser(
            pydantic_object=LaneVerdict
        )
        rendered = Prompter(
            prompt_template="project_env/verify_b",
            parser=parser,  # type: ignore[arg-type]
        ).render(
            data={
                "quote": "依托 MongoDB 空间索引，采用 Oracle Data Guard",
                "field": "tech_background",
                "period_start": "2024.01",
                "period_end": "2024.08",
                "anchor_table": "(锚点表)",
                "anchor_subset": "(子集)",
                "mode": "material",
            }
        )

        assert (
            "Mature general technologies without version numbers MUST PASS" in rendered
        )
        assert "Strictly DO NOT nitpick or demand version numbers" in rendered
        assert "少说少露馅" in rendered
        assert "Oracle Data Guard" in rendered
        assert "MongoDB 空间索引" in rendered

    def test_should_pass_mature_techs_without_version_in_check_ga_ordering(self):
        # Mature technologies without version stay 'unspecified' and never fail
        result_mongo = check_ga_ordering("MongoDB", None, "2024.01")
        assert result_mongo["status"] == "unspecified"

        result_spatial = check_ga_ordering("mongodb spatial", None, "2024.01")
        assert result_spatial["status"] == "unspecified"

        result_oracle = check_ga_ordering("Oracle Data Guard", None, "2024.01")
        assert result_oracle["status"] == "unspecified"

    @pytest.mark.asyncio
    async def test_should_pass_mature_techs_without_version_in_prescreen_point_anchors(
        self,
    ):
        quote = "空间检索系统依托 MongoDB 空间索引进行高效计算，核心容灾采用 Oracle Data Guard。"
        with patch(WEB_SEARCH, new_callable=AsyncMock) as mock_search:
            result = await prescreen_point_anchors(quote, "2024.01")

        mock_search.assert_not_awaited()
        assert result["status"] == "unspecified"
        assert result["message"] == ""

    @pytest.mark.asyncio
    async def test_should_pass_mature_techs_without_version_in_lane_b_verdict(self):
        quote = "系统底层依托 MongoDB 空间索引实现范围过滤，跨机房容灾采用 Oracle Data Guard。"
        field = "tech_background"
        context = {"period_start": "2024.01", "period_end": "2024.08"}

        with patch.object(
            pipeline,
            "_invoke_json",
            new_callable=AsyncMock,
            return_value=LaneVerdict(verdict="pass", issues=[]),
        ) as mock_invoke:
            verdict = await verify_point_lane("B", quote, field, context=context)

        assert verdict["verdict"] == "pass"
        assert verdict["issues"] == []
        mock_invoke.assert_awaited_once()

    def test_should_fail_mysql_8_4_in_2023_project_in_check_ga_ordering(self):
        # MySQL 8.4 was released in 2024.07; using it in 2023.06 is a clear time paradox
        assert GA_ANCHORS["mysql"]["8.4"] == "2024.07"
        result = check_ga_ordering("MySQL", "8.4", "2023.06")

        assert result["status"] == "fail"
        assert result["ga"] == "2024.07"
        assert (
            "mysql 8.4 GA (2024.07) is after project start (2023.06)"
            in result["message"]
        )

    @pytest.mark.asyncio
    async def test_should_fail_mysql_8_4_in_2023_project_in_prescreen_point_anchors(
        self,
    ):
        quote = "底层关系型数据库采用 MySQL 8.4 搭建读写分离主从架构。"
        result = await prescreen_point_anchors(quote, "2023.06")

        assert result["status"] == "fail"
        assert (
            "mysql 8.4 GA (2024.07) is after project start (2023.06)"
            in result["message"]
        )

    @pytest.mark.asyncio
    async def test_should_fail_mysql_8_4_in_2023_project_in_lane_b_verdict(self):
        quote = "底层关系型数据库采用 MySQL 8.4 搭建读写分离主从架构。"
        field = "tech_background"
        context = {"period_start": "2023.06", "period_end": "2023.12"}

        fake_fail_verdict = LaneVerdict(
            verdict="fail",
            issues=[
                "MySQL 8.4 GA 发布时间 (2024.07) 晚于项目开始时间 (2023.06)，构成时间穿越"
            ],
        )
        with patch.object(
            pipeline,
            "_invoke_json",
            new_callable=AsyncMock,
            return_value=fake_fail_verdict,
        ):
            verdict = await verify_point_lane("B", quote, field, context=context)

        assert verdict["verdict"] == "fail"
        assert any(
            "时间穿越" in issue or "晚于" in issue for issue in verdict["issues"]
        )


# ==============================================================================
# T4: 语境通道四大反模式审查验收
# ==============================================================================


class TestT4ContextChannelFourAntiPatternsReview:
    """T4 语境通道四大反模式审查验收:

    - Agent 反模式（如 Prompt 做权限控制、大模型自己生成不可篡改哈希等）触发 Fail，给出弊端说明与合规方案；
    - 微服务/分布式反模式（如异步 MQ 链路套 TCC、按表拆微服务等）触发 Fail；
    - 存储/缓存反模式（先更缓存再更库、无二次检查锁等）触发 Fail；
    - 正常的合理设计判定 Pass。
    """

    def test_should_render_verify_c_template_with_four_anti_pattern_categories_and_triple_format(
        self,
    ):
        parser: PydanticOutputParser[LaneVerdict] = PydanticOutputParser(
            pydantic_object=LaneVerdict
        )
        rendered = Prompter(
            prompt_template="project_env/verify_c",
            parser=parser,  # type: ignore[arg-type]
        ).render(
            data={
                "quote": "系统架构描述",
                "field": "background",
                "period_start": "2024.01",
                "period_end": "2024.08",
                "my_role": "架构师",
                "narrative": "完整叙述",
                "anchor_table": "(锚点表)",
            }
        )

        assert "[Agent反模式]" in rendered
        assert "[微服务与分布式反模式]" in rendered
        assert "[存储与缓存反模式]" in rendered
        assert "[弹性高可用与生产就绪反模式]" in rendered
        assert (
            "`[<反模式类别>] <断言> || 弊端所在: <说明> || 行业合规方案: <说明>`"
            in rendered
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "quote,issue_category,assertion,drawback,solution",
        [
            (
                "通过在大模型 Prompt 中注入提示词实现多租户数据权限隔离与越权拦截。",
                "[Agent反模式]",
                "利用 Prompt 做多租户数据权限隔离",
                "Prompt 提示词极易被越狱注入攻击绕过，无法保证安全边界与强制访问控制",
                "应在网关或应用层采用 RBAC/ABAC 进行硬编码鉴权与数据过滤",
            ),
            (
                "直接调用大语言模型实时生成不可篡改的数据哈希值用于审计存证。",
                "[Agent反模式]",
                "大模型生成不可篡改哈希值",
                "大模型存在概率性幻觉与不确定性输出，无法保证哈希抗碰撞与确定性",
                "应采用 SHA-256、SHA-3 或国密 SM3 等标准密码学算法",
            ),
        ],
    )
    async def test_should_fail_on_agent_anti_patterns_with_triple_issue_format(
        self,
        quote: str,
        issue_category: str,
        assertion: str,
        drawback: str,
        solution: str,
    ):
        formatted_issue = f"{issue_category} {assertion} || 弊端所在: {drawback} || 行业合规方案: {solution}"
        fake_verdict = LaneVerdict(verdict="fail", issues=[formatted_issue])

        with patch.object(
            pipeline,
            "_invoke_json",
            new_callable=AsyncMock,
            return_value=fake_verdict,
        ):
            result = await verify_point_lane("C", quote, "tuning_process", context={})

        assert result["verdict"] == "fail"
        assert len(result["issues"]) == 1
        issue = result["issues"][0]
        assert issue.startswith("[Agent反模式]")
        assert "弊端所在:" in issue
        assert "行业合规方案:" in issue

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "quote,issue_category,assertion,drawback,solution",
        [
            (
                "在 Kafka 异步消息队列消费链路中强行引入 TCC 分布式事务框架保证两阶段提交。",
                "[微服务与分布式反模式]",
                "异步 MQ 消费链路强套 TCC 分布式事务",
                "异步解耦与同步两阶段预留资源冲突，极易导致悬挂事务与消息积压死锁",
                "应使用本地消息表或 RocketMQ 事务消息保证分布式最终一致性",
            ),
            (
                "按单表直接拆分成 25 个独立微服务，所有服务共享直连底层同一个 Oracle 数据库物理表。",
                "[微服务与分布式反模式]",
                "微服务直连共享同一数据库单库物理表",
                "破坏微服务自治性与业务边界，导致底层数据库连接池耗尽且模型耦合",
                "应遵循 Database-per-service 原则，跨服务通过 RPC/REST 接口交互",
            ),
        ],
    )
    async def test_should_fail_on_microservice_anti_patterns_with_triple_issue_format(
        self,
        quote: str,
        issue_category: str,
        assertion: str,
        drawback: str,
        solution: str,
    ):
        formatted_issue = f"{issue_category} {assertion} || 弊端所在: {drawback} || 行业合规方案: {solution}"
        fake_verdict = LaneVerdict(verdict="fail", issues=[formatted_issue])

        with patch.object(
            pipeline,
            "_invoke_json",
            new_callable=AsyncMock,
            return_value=fake_verdict,
        ):
            result = await verify_point_lane("C", quote, "tech_background", context={})

        assert result["verdict"] == "fail"
        assert len(result["issues"]) == 1
        issue = result["issues"][0]
        assert issue.startswith("[微服务与分布式反模式]")
        assert "弊端所在:" in issue
        assert "行业合规方案:" in issue

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "quote,issue_category,assertion,drawback,solution",
        [
            (
                "数据更新时先更新 Redis 缓存，随后异步写入 MySQL 数据库以降低延迟。",
                "[存储与缓存反模式]",
                "数据更新先更缓存再更库",
                "若后续异步写库失败或并发写乱序，缓存将长期存在脏数据且无法自愈",
                "应采用 Cache-Aside 模式（先更库再删缓存）或结合 Canal 监听 Binlog 异步更新",
            ),
            (
                "热点缓存失效后未加互斥锁且无二次检查锁，高并发请求直接穿透击穿至底层数据库。",
                "[存储与缓存反模式]",
                "缓存击穿缺乏互斥锁与二次检查保护",
                "高并发请求瞬间打垮数据库造成连接耗尽与级联雪崩",
                "应引入分布式互斥锁配合 Double-Check 机制，或采用逻辑不过期方案",
            ),
        ],
    )
    async def test_should_fail_on_storage_and_cache_anti_patterns_with_triple_issue_format(
        self,
        quote: str,
        issue_category: str,
        assertion: str,
        drawback: str,
        solution: str,
    ):
        formatted_issue = f"{issue_category} {assertion} || 弊端所在: {drawback} || 行业合规方案: {solution}"
        fake_verdict = LaneVerdict(verdict="fail", issues=[formatted_issue])

        with patch.object(
            pipeline,
            "_invoke_json",
            new_callable=AsyncMock,
            return_value=fake_verdict,
        ):
            result = await verify_point_lane(
                "C", quote, "problems_solutions", context={}
            )

        assert result["verdict"] == "fail"
        assert len(result["issues"]) == 1
        issue = result["issues"][0]
        assert issue.startswith("[存储与缓存反模式]")
        assert "弊端所在:" in issue
        assert "行业合规方案:" in issue

    @pytest.mark.asyncio
    async def test_should_pass_architecturally_sound_design_in_lane_c(self):
        quote = (
            "系统采用 Spring Boot 构建微服务架构，通过 Nacos 进行服务注册与动态配置管理；"
            "缓存采用 Cache-Aside 模式结合 Canal 监听 MySQL Binlog 异步失效 Redis 缓存；"
            "写接口通过分布式全局唯一流水号实现防重幂等，全链路接入 SkyWalking 监控追踪。"
        )
        fake_pass_verdict = LaneVerdict(verdict="pass", issues=[])

        with patch.object(
            pipeline,
            "_invoke_json",
            new_callable=AsyncMock,
            return_value=fake_pass_verdict,
        ):
            result = await verify_point_lane("C", quote, "tech_background", context={})

        assert result["verdict"] == "pass"
        assert result["issues"] == []


# ==============================================================================
# T5: 大模型 GA 语义推导验收
# ==============================================================================


class TestT5LlmGaSemanticDerivation:
    """T5 大模型 GA 语义推导验收:

    从搜索摘要中能由轻量大模型准确识别官方 GA 年月，无法识别时优雅降级。
    """

    def test_should_render_ga_resolver_template_correctly(self):
        parser: PydanticOutputParser[GaResolution] = PydanticOutputParser(
            pydantic_object=GaResolution
        )
        snippets = (
            "[Result 1] Apache Flink 1.18.0 released on Nov 24, 2023.\n"
            "[Result 2] Blog dated Jan 2024 discussing new features."
        )
        rendered = Prompter(
            prompt_template="project_env/ga_resolver",
            parser=parser,  # type: ignore[arg-type]
        ).render(data={"tech": "flink", "version": "1.18", "snippets": snippets})

        assert "# TARGET TECHNOLOGY & VERSION" in rendered
        assert "flink" in rendered
        assert "1.18" in rendered
        assert "# SEARCH SNIPPETS" in rendered
        assert "Nov 24, 2023" in rendered
        assert "YYYY.MM" in rendered
        # multi-source corroboration rule: one blog/forum date is not enough
        assert "at least two independent search results" in rendered

    @pytest.mark.asyncio
    async def test_should_extract_official_ga_month_from_noisy_snippets_via_llm(self):
        noisy_snippets = (
            "Blog posted on 2024.03: In our production migration, we reviewed "
            "Apache Flink 1.18.0, which was officially announced and released on 2023.11.24 "
            "by the Apache Software Foundation. Earlier version 1.17 was released in 2023.03."
        )
        resolution = GaResolution(
            ga="2023.11",
            confidence="web",
            reasoning="Official announcement date for Flink 1.18 is 2023.11",
        )

        with patch.object(
            pipeline,
            "_invoke_json",
            new_callable=AsyncMock,
            return_value=resolution,
        ) as mock_invoke:
            result = await resolve_ga_with_llm("flink", "1.18", noisy_snippets)

        assert result is not None
        assert result.ga == "2023.11"
        mock_invoke.assert_awaited_once()
        invoked_template, invoked_data, *_ = mock_invoke.await_args.args
        assert invoked_template == "project_env/ga_resolver"
        assert invoked_data["tech"] == "flink"
        assert invoked_data["version"] == "1.18"

    @pytest.mark.asyncio
    async def test_should_gracefully_degrade_when_snippets_empty(self):
        # Empty or whitespace snippets return None immediately without LLM invocation
        assert await resolve_ga_with_llm("flink", "1.18", "") is None
        assert await resolve_ga_with_llm("flink", "1.18", "   ") is None

    @pytest.mark.asyncio
    async def test_should_gracefully_degrade_when_llm_cannot_determine_date(self):
        resolution_null = GaResolution(
            ga=None,
            confidence="web",
            reasoning="Search snippets do not mention release date",
        )
        with patch.object(
            pipeline,
            "_invoke_json",
            new_callable=AsyncMock,
            return_value=resolution_null,
        ):
            result = await resolve_ga_with_llm(
                "unknown_tech", "0.1", "Some random text"
            )

        assert result is not None
        assert result.ga is None

    @pytest.mark.asyncio
    async def test_should_gracefully_degrade_when_llm_returns_invalid_format(self):
        resolution_invalid = GaResolution(
            ga="not-a-valid-month",
            confidence="web",
            reasoning="Invalid date shape",
        )
        with patch.object(
            pipeline,
            "_invoke_json",
            new_callable=AsyncMock,
            return_value=resolution_invalid,
        ):
            result = await resolve_ga_with_llm("flink", "1.18", "some snippet")

        assert result is not None
        assert not result.ga or not is_month(result.ga)

    @pytest.mark.asyncio
    async def test_should_fallback_to_heuristic_regex_when_llm_returns_none(self):
        web_results = [
            {
                "title": "Apache Flink 1.18 Release Announcement",
                "url": "https://flink.apache.org/releases/1.18",
                "snippet": "Apache Flink 1.18 released in November 2023 with streaming improvements.",
            }
        ]

        with (
            patch(WEB_SEARCH, new_callable=AsyncMock, return_value=web_results),
            patch(RESOLVE_LLM, new_callable=AsyncMock, return_value=None),
        ):
            anchor = await fetch_ga_anchor_online("flink", "1.18")

        assert anchor is not None
        assert anchor["ga"] == "2023.11"
        assert anchor["source"] == "web:https://flink.apache.org/releases/1.18"
        assert anchor["confidence"] == "heuristic"

    @pytest.mark.asyncio
    async def test_should_not_fabricate_anchor_when_llm_judges_snippets_insufficient(
        self,
    ):
        # The model answered ga=None (snippets insufficient). A blog timestamp
        # in the snippets must NOT be regex-mined into an anchor: that is how
        # a 2025 blog date would hard-fail a 2023 project.
        web_results = [
            {
                "title": "Blog: migrating to OceanBase 4.2",
                "url": "https://blog.example/oceanbase",
                "snippet": "Posted 2025.01: we migrated to OceanBase 4.2 last year.",
            }
        ]
        insufficient = GaResolution(
            ga=None, confidence="web", reasoning="no official release date found"
        )

        with (
            patch(WEB_SEARCH, new_callable=AsyncMock, return_value=web_results),
            patch(RESOLVE_LLM, new_callable=AsyncMock, return_value=insufficient),
        ):
            anchor = await fetch_ga_anchor_online("oceanbase", "4.2")

        assert anchor is None

    @pytest.mark.asyncio
    async def test_should_not_fabricate_anchor_when_llm_returns_malformed_ga(
        self,
    ):
        # ga present but not YYYY.MM: same verdict as ga=None — the model DID
        # answer, so the regex fallback must not mine a date out of the
        # snippet's blog timestamp either.
        web_results = [
            {
                "title": "Blog: migrating to OceanBase 4.2",
                "url": "https://blog.example/oceanbase",
                "snippet": "Posted 2025.01: we migrated to OceanBase 4.2 last year.",
            }
        ]
        malformed = GaResolution(
            ga="2025/03", confidence="web", reasoning="malformed month shape"
        )

        with (
            patch(WEB_SEARCH, new_callable=AsyncMock, return_value=web_results),
            patch(RESOLVE_LLM, new_callable=AsyncMock, return_value=malformed),
        ):
            anchor = await fetch_ga_anchor_online("oceanbase", "4.2")

        assert anchor is None

    @pytest.mark.asyncio
    async def test_should_gracefully_return_none_when_both_llm_and_regex_fail(self):
        web_results = [
            {
                "title": "Apache Flink Discussion",
                "url": "https://flink.example/discuss",
                "snippet": "Discussion about features without any date mentions.",
            }
        ]

        with (
            patch(WEB_SEARCH, new_callable=AsyncMock, return_value=web_results),
            patch(RESOLVE_LLM, new_callable=AsyncMock, return_value=None),
        ):
            anchor = await fetch_ga_anchor_online("flink", "1.18")

        assert anchor is None

    @pytest.mark.asyncio
    async def test_should_gracefully_return_none_when_web_search_fails_or_empty(self):
        with (
            patch(WEB_SEARCH, new_callable=AsyncMock, return_value=[]),
            patch(RESOLVE_LLM, new_callable=AsyncMock, return_value=None),
        ):
            assert await fetch_ga_anchor_online("flink", "1.18") is None

        with (
            patch(
                WEB_SEARCH,
                new_callable=AsyncMock,
                side_effect=RuntimeError("Search network down"),
            ),
            patch(RESOLVE_LLM, new_callable=AsyncMock, return_value=None),
        ):
            assert await fetch_ga_anchor_online("flink", "1.18") is None
