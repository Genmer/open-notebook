# 思考流全链路接入设计：让模型思考过程实时可见（reasoning stream）

- 作者：主 Agent（排查 + 设计）· 用户拍板两项裁决
- 日期：2026-10-12（定稿，未实施）
- 状态：**设计定稿待实施**——通用读取器 + 五个流式出口 + 前端气泡/计数全适配；实施按批次走，未开工
- 来源：题库工作台"拆题·论点矩阵"生成 1:50 全程 0 tok/s 排查（实测根因见 §1）；HTML 交付稿 `reasoning-stream-design.html` 为会话产物不入库，本稿为其仓库版定稿
- 核实声明：§1 实测数据为 2026-10-12 用生产同款代码路径（`provision_langchain_model_with_info` → glm-5.3-flash）实跑所得；§2/§3 的 file:line 为设计会话实读证据

---

## 0. 已拍板裁决（2026-10-12 用户）

| # | 类型 | 内容 |
|---|---|---|
| 0-1 | 裁决 | 思考内容展示：**chat 类出口实时全文气泡（可折叠）**；题库工作台面板**计数式**（思考 tokens/速度/峰值，不展示全文） |
| 0-2 | 裁决 | 执行方式：**分批实施**（同软考模块节奏：每批门禁+审查+测试） |
| 0-3 | 范围 | 前端对应出口全部适配（主对话/并发/速问/题库/来源分析），不是只做后端 |
| 0-4 | 交付 | 每批 conventional commit，最后统一推送 origin/main（推送前展示提交范围） |

## 1. 背景与实测依据

题库"拆题·论点矩阵"生成 1:50 全程 0 tok/s，排查结论（glm-5.3-flash，生产同款代码路径实测）：

| 层 | 实测结果 |
|---|---|
| 智谱原始 SSE（openai SDK 直连） | 第 **1** 个 delta 即带 `reasoning_content`，思考期全程约 46 delta/s 在流 |
| langchain 集成层（Esperanto `to_langchain`） | chunk `content=''`、`additional_kwargs={}`——思考流被整层丢弃 |
| 我们的代码（全仓库） | 只读 `chunk.content`；无任何链路消费实时思考流 |
| 首个可见正文 token | **120.9s**（思考期 ~110-121s，两次实测一致量级） |

即：思考期数据一直都在网络上流，是管道中间两层（langchain 映射、我们的消费代码）都没接。UI 的 tok/s 按"可见正文 delta 事件"计数（`frontend/src/lib/ruankao/stream-metrics.ts`），思考期恒为 0，读起来像卡死。

## 2. 目标与范围

- **项目级通用**：新建思考流读取器，所有用户可见的 AI 流式出口统一接入，不是题库专用补丁
- **五个流式出口**：

| 出口 | 位置 | 用户场景 |
|---|---|---|
| 主页面对话 | `api/routers/chat_stream.py`（graph `stream_mode="messages"`） | **重点**，notebook 聊天 |
| 并发对话 | `api/routers/chat_parallel.py` `_answer_once` | 多模型并排 |
| 全局速问侧卡 | `api/routers/quick_chat.py` | QuickAskHost |
| 题库工作台 | `api/routers/ruankao_questions.py` ← `_invoke_json` | 本次问题出处 |
| 来源分析对话 | `api/source_analysis_service.py` | source ChatPanel |

- **不动**：Ask 页（`search.py` 是 `stream_mode="updates"` 节点级更新，其 "reasoning" 是策略结构化字段、非 token 流）；worker 后台任务（无实时 UI）；数据库 schema、模型配置、红线隔离（ADR-017）零变化

## 3. 核心：通用思考流读取器

新模块 `open_notebook/ai/reasoning_stream.py`（open_notebook 层而非 api/——worker 也可用；不 import api/，遵守模块纪律）：

```python
class StreamKind(str, Enum):
    REASONING = "reasoning"
    CONTENT = "content"

@dataclass
class StreamPiece:
    kind: StreamKind
    text: str

async def astream_pieces(model, payload, **astream_kwargs) -> AsyncIterator[StreamPiece]:
    """能力探测：model.async_client（Esperanto 桥的原始 openai 客户端，实测可用）
    → 原生 create(stream=True)，逐 delta 分拣 delta.model_extra["reasoning_content"]
    / delta.content。探测失败 / 非 openai 兼容 / 原生调用抛错 → 回落现行 langchain
    astream（只产 CONTENT piece），行为与今天字节级一致。"""
```

- **兜底是硬约束**：读取器任何故障（属性缺失、供应商 400、字段不存在）都降级到现行 content-only 路径，绝不中断生成；非 openai 通道（Anthropic 原生等）天然走兜底
- **usage 记账不丢**：原生路径带 `stream_options={"include_usage": true}`（GLM/百炼实测支持），供应商拒绝该参数时捕获降级；usage 喂现有 `record_llm_usage`
- **隔离红线**：reasoning **永不**进 DB 消息、**永不**进 `_invoke_json` 的 JSON 解析输入（解析器只见 content 拼接），纯直播数据、用完即弃

## 4. 各出口协议扩展（全部向后兼容）

| 出口 | SSE 扩展 | 改法要点 |
|---|---|---|
| 主对话 chat_stream | 新事件 `{"type":"reasoning","delta":"…"}` | graph 节点在 `stream_tokens` 时改走 `astream_pieces`：content 拼 `AIMessage` 落检查点（语义不变），reasoning 经 langgraph `stream_mode="custom"` writer 透传；端点 `stream_mode=["messages","custom"]` |
| 并发 chat_parallel | `run_delta` 加可选字段 `"phase":"reasoning"\|"content"`（缺省=content，旧前端不受影响） | `_answer_once` 换读取器，`put_delta` 带 phase |
| 速问 quick_chat | 新事件 `{"type":"reasoning","content":"…"}` | 同上直换 |
| 题库 ruankao_questions | 新事件 `{"type":"thinking_delta","content":"…"}`（与现有 thinking stage 衔接） | `_invoke_json` 加 `on_reasoning` 回调，题库路由转发；三个 render 函数签名透传 |
| 来源分析 | 同主对话事件形状 | `_stream_invoke` 加 on_reasoning |

`_invoke_json`（`open_notebook/ai/project_env_pipeline.py`）的改造一次覆盖题库 + 项目环境等全部调用方；现有 `on_delta`/`on_stage` 语义不变，`on_reasoning` 纯增量。

## 5. 前端适配（裁决 0-1 / 0-3）

- **主对话 ChatPanel**：流式期间显示可折叠"思考过程"气泡（实时滚动，只渲染尾部约 2000 字防 DOM 膨胀）；正文开始后自动折叠为一行"已思考 N 秒 · M tokens"；**刷新即消失**（与后端不落盘一致）
- **题库生成面板**（GenerationStatusPanel/stream-metrics）：新增思考期口径——思考 tokens / 思考 tok/s / 思考峰值；正文口径保持现行 4 项不变；thinking stage 行保留；**计数式，不展示思考全文**
- **并发卡片 / 速问侧卡**：并发卡片思考态加"思考 N tok"（气泡式简化版同主对话）；速问卡同主对话简化气泡
- **度量纪律**：思考 tok/s 与正文 tok/s 分开计数、绝不混算（口径文档化在 stream-metrics.ts 注释）
- **i18n**：14 locale 全量补 key（new-keys 门禁）

## 6. 实施批次（裁决 0-2 / 0-4）

| 批次 | 内容 | 门禁 |
|---|---|---|
| 1 | 读取器模块 + 单测（mock 原生流：reasoning/content 混排、兜底路径、usage 降级） | pytest + ruff + mypy |
| 2 | `_invoke_json` 接入 + 题库链路（后端事件 + 前端思考指标 + i18n） | + vitest，真机看题库生成 |
| 3 | 主对话 chat_stream（graph custom 流 + 前端气泡）——最大风险批次：检查点语义、invoke 非流式路径字节级不变 | 全量 + 真机主对话 |
| 4 | 并发对话 + 速问 + 来源分析 | 全量 + 真机三出口 |
| 5 | README 末尾 fork 改动记录 + CHANGELOG（### Added）+ 七门禁全量 + 真机回归 | 七门禁 + 浏览器实测 |

真机验收清单（按"以用户身份实测"强规则）：题库拆题思考期速度跳动、主对话思考气泡出现/折叠/刷新消失、并发多卡思考计数、速问侧卡、断流中止（关闭弹窗=中断）行为不回退；GLM 思考模型四出口可见思考流，非 openai 模型走兜底不炸。

## 7. 风险与边界

- **graph 节点改造（批次3 最大风险）**：chat 节点从 `invoke` 改流式消费需保住 IncompleteGenerationError、`<think>` 清洗、usage 记账、SqliteSaver 检查点（chat_stream 的 worker-thread + call_soon_threadsafe 管线要过 custom 事件）——content 仍拼完整 AIMessage 走原落盘路径，改动收敛在"喂消息的方式"
- **供应商差异**：小米 mimo 等 openai_compatible 通道大概率同款 reasoning_content（接入时实测）；`include_usage` 个别供应商可能 400 → 捕获重试一次不带该参数
- **带宽**：思考文本可达数万字，SSE 逐 delta 可行（实测 46/s），前端只渲尾部；不持久化无存储压力
- **不解决"慢"本身**：思考期时长不变（模型/温度问题；结构化任务 temperature 降到 ~0.2 是独立速效药，可另开小批）

## 8. ADR 评估

**无新决策记录**：reasoning 不落盘、不进解析输入是既有红线（ADR-017 隔离思想）的应用而非新架构决策；若实施中出现新的结构性取舍（如 SSE 事件版本化），再补记录。
