# PDR-004: 智能体配置与多路并发对话

- **Status**: Accepted
- **Date**: 2026-10
- **Related**: [VISION.md](../../../VISION.md)（Simplicity over features / Current Posture）、[ADR-006](ADR-006-migration-granularity.md)（一 PR 一迁移）、[ADR-004](ADR-004-background-workers.md)（异步优先）、[PDR-002](PDR-002-provider-agnostic-core.md)（供应商无关核心）

## 裁决摘要

**工作流：缓做（v1 不做）。** "智能体 + 2–5 路并发对比 + 任选总结者合并成一份" 覆盖了用户所述工作流诉求（"哪个智能体处理、接收决策"）的绝大部分场景；自由画布编排与 VISION.md「Simplicity over features」和当前阶段（把基础体验做扎实）冲突，也与研究笔记本品类先例（NotebookLM/Mem 均不做编排）相悖。未来若做，形态锁定为"预设链模板 + 每步绑定智能体"（非自由画布），触发条件定死（见 §5.4）。

**方案骨架三句话**：① 智能体 = SurrealDB `agent` 表（迁移 34：name/description/system_prompt/model/temperature/max_tokens/enabled/sort_order），完整照抄 Transformation 资源链（domain → router → 前端 CRUD 页 → 侧边栏 manage 组）；`chat_session.agent` 用 `option<string>` 与 `model_override` 同构，`Agent.model` 按 SourceAnnotation 范本做 `Union[str, RecordID]` 双向防护。② 对话选择器升级为单一分组下拉（智能体组 + 模型组），选中值用 `agent:<id>` / `model:<id>` 前缀编码，`/chat/execute` 加 `agent_override` 通道，智能体人设以**拼接块**注入现有 `chat/system.jinja`（保留引用体系），temperature/max_tokens 经 provision kwargs 透传。③ 并发回答走**后端单端点** `POST /api/chat/sessions/{sid}/parallel`（SSE 伪流式）：读主会话历史 → N 路**无 checkpoint** 并发 ainvoke（照 ask 图全异步模式）→ 完成后由**独立编排任务**（不依赖 SSE 连接生命周期，断连不丢已完成回答）串行 `update_state` 归档回主会话并按 `group_id` 分组——**执行与持久化解耦**，彻底绕开 SqliteSaver 同线程分叉竞态；总结合并是同一模式的单路特例（`POST .../synthesize`，总结者可选任意智能体/模型）。

---

## 背景

用户需求原文：「主页侧边栏新增智能体配置，跟 ZCode 的智能体是一个意思（模型角色预定义，页面差不多）；对话页面可以选择智能体或者单纯模型；允许选择多个模型或智能体并发回答（上限 5 个），回答方式可弹出多个对比也可选一个模型/智能体总结后输出一份结果；工作流（设计哪些流程后哪个智能体处理接收决策）你看有没有必要，如果有怎么融入这个应用你自己设计。」

使用场景：备考软考高级架构师，笔记本工作区四栏（来源/对话/Studio），刚交付对话全屏三栏布局与标注系统。

关键代码事实（本会话亲自核实，行号为当时快照）：

- 笔记本对话非流式：`frontend/src/lib/api/chat.ts:50-60`（注释明言 synchronous, no streaming）→ `api/routers/chat.py:304-388` 同步 `chat_graph.invoke` 后整段返回；模型覆盖优先级 request > session（`api/routers/chat.py:320-325`），经 `configurable={'thread_id','model_id'}` 入图（`api/routers/chat.py:358-363`）。
- chat 图 system prompt 硬编码 `Prompter(prompt_template="chat/system").render(data=state)`（`open_notebook/graphs/chat.py:35`）——`render(data=state)` 把**整个 ThreadState** 交给 jinja，给 state 加字段即可在模板可见；`max_tokens=8192` 硬编码（`chat.py:49,72`）。
- 消息不存 SurrealDB：存 LangGraph SqliteSaver checkpoint（`open_notebook/graphs/chat.py:115-119`），thread_id = `chat_session:<id>`；`ChatMessage` 响应模型无 model/agent 元数据（`api/routers/_chat_shared.py:25-29,82-94`）。
- 仓库内"多路并发→收敛一份"原生范式 = ask 图（`open_notebook/graphs/ask.py:119-132` Send 扇出、`:55` `answers: Annotated[list, operator.add]`、全 async 节点、per-configurable 多模型）；SSE 伪流式先例 = `api/routers/source_chat.py:332-453`（整条 AI 消息单事件 yield，`X-Accel-Buffering: no`）。
- 前端多路状态样板 = `use-ask.ts`（AbortController + 空闲看门狗 `:82-95`、SSE 逐行解析 `:155-207`、answers 累积）；对话选择器 = `ModelSelector.tsx`（Dialog+Select、`'default'`→undefined、只筛 `type==='language'`），挂载于 `ChatPanel.tsx:553-561` ChatComposer。
- CRUD 资源全栈范本 = transformations（后端 `open_notebook/domain/transformation.py` + `api/routers/transformations.py` + `api/main.py:415` 注册；前端页面四件套 + `use-transformations.ts` hooks 惯例）；绑定模型字段范本 = `EpisodeProfile`（`open_notebook/podcasts/models.py:39-129`：nullable_fields + `_prepare_save_data` 转 RecordID）。
- 迁移纪律：最新 33（已在 `open_notebook/database/async_migrate.py:176/277` 双列表登记），下一个 **34**；新迁移**必须手工登记**进 up/down 两个列表，否则静默不执行。
- 侧边栏导航 = `AppSidebar.tsx:49-82` 纯数据函数（manage 组 `:69-81`）；⌘K 面板有**第二份独立清单** `CommandPalette.tsx:35-44`，漏改则搜不到。
- i18n：en-US 是 `TranslationShape` 源（`frontend/src/lib/locales/en-US/index.ts`），其余 13 locale `satisfies` 它，缺键 tsc 失败；navigation 块在 `en-US/index.ts:212-235`。

五路探索结论相互之间无矛盾（竞品调研自身标注的唯一不可核实项 OpenRouter multi-model 语义与本设计无关——本设计不依赖它）。

---

## 一、智能体（Agent）数据模型

### 1.1 表结构（迁移 34）

新建 `open_notebook/database/migrations/34.surrealql` + `34_down.surrealql`，DDL 风格照抄迁移 33（`SCHEMAFULL` + `DEFINE FIELD IF NOT EXISTS` + schema 级时间戳默认值）与迁移 14（`option<record<model>>` 引用字段先例）：

```sql
-- 34.surrealql
DEFINE TABLE IF NOT EXISTS agent SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS name ON TABLE agent TYPE string;
DEFINE FIELD IF NOT EXISTS description ON TABLE agent TYPE option<string>;
DEFINE FIELD IF NOT EXISTS system_prompt ON TABLE agent TYPE string;
DEFINE FIELD IF NOT EXISTS model ON TABLE agent TYPE option<record<model>>;
DEFINE FIELD IF NOT EXISTS temperature ON TABLE agent TYPE option<float>;
DEFINE FIELD IF NOT EXISTS max_tokens ON TABLE agent TYPE option<int>;
DEFINE FIELD IF NOT EXISTS enabled ON TABLE agent TYPE bool DEFAULT true;
DEFINE FIELD IF NOT EXISTS sort_order ON TABLE agent TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS created ON agent DEFAULT time::now() VALUE $before OR time::now();
DEFINE FIELD IF NOT EXISTS updated ON agent DEFAULT time::now() VALUE time::now();
DEFINE INDEX IF NOT EXISTS idx_agent_enabled_sort ON TABLE agent FIELDS enabled, sort_order;
-- 同一迁移内给 chat_session 挂 agent。类型刻意选 option<string>（存 "agent:xxx" 字符串），
-- 与 model_override 完全同构（迁移 8 原文即 TYPE option<string>）——见 §1.3 的类型裁决。
DEFINE FIELD IF NOT EXISTS agent ON chat_session TYPE option<string>;

-- 34_down.surrealql
REMOVE FIELD IF EXISTS agent ON TABLE chat_session;
REMOVE TABLE IF EXISTS agent;
```

字段语义（对照 Claude Code subagent / Notion Custom Agents / ZCode `agent("名称",{system})` 的收敛结论——必填只有 name + system prompt）：

| 字段 | 必填 | 语义 |
|---|---|---|
| `name` | ✅ | 唯一显示名（唯一性在 domain 层校验，`EpisodeProfile.get_by_name` 先例 `podcasts/models.py:121-129`） |
| `description` | ❌ | 何时选用此角色（供选择器提示，不做自动委派） |
| `system_prompt` | ✅ | 角色人设，拼接进 chat 系统提示词（见 §4.3） |
| `model` | ❌ | 绑定模型（`record<model>`）；未绑定跟随会话/系统默认 |
| `temperature` | ❌ | 0–2，经 provision kwargs 透传（链路已验证可达：`open_notebook/ai/models.py:260` `config.update(kwargs)` → esperanto；仓库先例 `api/explain_service.py`） |
| `max_tokens` | ❌ | >0，同上透传；未设置时沿用 8192 现状 |
| `enabled` | ✅默认 true | 停用后不出现在对话选择器，但历史消息元数据不受影响 |
| `sort_order` | ✅默认 0 | 选择器与配置页排序 |

**明确不做**（克制，YAGNI）：工具白名单/权限（无对话工具面）、知识源绑定（对话已有 context picker）、头像/颜色、多用户归属字段（PDR-001：不主动排除多用户，但单用户阶段不加无效字段）。

**悬空引用策略（三个引用面，行为定死）**：

1. `agent.model` 悬空（被绑定的 Model 被删）：不级联清理（SurrealDB `record<model>` 无外键级联，迁移 33 只给 source 建了清理 EVENT）。容忍 + 显式提示——选择器/配置页对 model 查无此人时显示 `agents.modelMissing` 徽章（照 `EpisodeProfile` 对 orphaned 的容忍注释先例 `podcasts/models.py:56-64`）。这比给 model 表加删除清理 EVENT 改动面小，且智能体是低价值可重建资产。
2. `chat_session.agent` 悬空（智能体被删，会话还绑着它）：**回退默认助手，不报错**——`resolve_agent(agent_id)` 在 `/chat/execute` 与 `/parallel` 里 **`except NotFoundError`** 后静默降级（注意：`ObjectModel.get` 查无记录抛 `NotFoundError` 而非返回 None，`open_notebook/domain/base.py:122-125`；先例 `api/routers/source_annotations.py:80+98` 同为 try/except 写法。写成 `if agent is None` 会漏异常路径、在 execute_chat 被映射成 404，与降级意图相反——实施修订）。会话历史照常、不套 persona，响应里该次回答的 `agent_name` 为空即"默认助手"；前端会话头部的智能体徽章显示 `chat.agentMissing`（"智能体已删除，已回退默认助手"）并允许重选。选 500/硬错误会因配置删除而永久卡死历史会话，违反"对话历史是资产"。
3. 并发 runs 里的 `agent_id` 悬空：该路自动降级为"默认模型路"（label 显示原智能体名 + 降级标记），`runs_started` 事件回传实际解析结果，不整单失败。

**删除确认带使用计数**：`AgentResponse` 增加 `in_use_session_count`（list 端点用一条 SurrealQL 聚合补齐：`SELECT agent, count() AS n FROM chat_session WHERE agent != NONE GROUP BY agent`，agent 数量小无 N+1 顾虑）；`AgentCard` 删除确认在 count>0 时换用 `agents.deleteConfirmInUse` 文案（见 §2.3 键表）。

### 1.2 domain → repo → api 链路

- **domain**：新建 `open_notebook/domain/agent.py`，`class Agent(ObjectModel)`（近期惯例一域一文件）：
  - `table_name: ClassVar[str] = "agent"`
  - **`nullable_fields` 必须登记全部可空字段** `{"description","model","temperature","max_tokens"}` —— `ObjectModel._prepare_save_data`（`open_notebook/domain/base.py:202-208`）默认丢弃值为 None 的字段，不登记则"解绑模型/清空温度"静默失效且 MERGE 不清旧值。
  - **`model` 字段的双向类型防护**（DDL 是 `option<record<model>>`，读写两侧都要转）：
    - 字段类型 `model: Optional[Union[str, RecordID]] = None` + `field_validator("model", mode="before")`（**完整范本 = `SourceAnnotation.source`**：`open_notebook/domain/source_annotation.py:76` 的 `Union[str, RecordID]` 与 `:87-92` 的 before-validator——读方向把 SDK 可能返回的 RecordID 对象收敛为合法值）。
    - 写方向 `_prepare_save_data` 覆写用 `ensure_record_id` 转回 RecordID（`EpisodeProfile._prepare_save_data` 逐字先例 `podcasts/models.py:91-99`——它只是**写入方向**的范本，见下）。
    - 事实核查说明：本仓库 repo 层的 `repo_query/repo_create/repo_update` 已统一跑 `parse_record_ids`（递归把结果里的 RecordID 转 str，`open_notebook/database/repository.py:109,131,207`），所以**今天经 `Agent.get/get_all` 读回的 model 字段实际是字符串**，纯 `Optional[str]` 在当前路径不会立刻炸；但 validator 仍必须写——`repo_delete` 不跑 `parse_record_ids`、`ObjectModel.save` 会把 repo 返回值直接 setattr 回实例（`base.py:182-190`），任何未来不经 parse 的路径（评审实测：pydantic `Optional[str]` 直接拒收 RecordID 对象，且 surrealdb 1.0.8 的 RecordID 不是 str 子类）都会炸。照仓库最新范本做防御，不赌调用路径。
    - **EpisodeProfile 的已知脆弱性（不照抄它的读侧）**：`outline_llm/transcript_llm` 是 `Optional[str]` 无 validator（`podcasts/models.py:67-72`）而 DDL 是 `record<model>`（迁移 14）——它在 repo 层 parse 之下侥幸工作，属脆弱范式，已列入债务登记（§Consequences）。
  - `model_validator` 集中校验：name/system_prompt 非空、`temperature ∈ [0,2]`、`max_tokens > 0`（集中校验先例 `source_annotation.py:108-148`）。
  - `get_all(order_by="sort_order asc")` 走基类（白名单防注入已内建 `base.py:40-70`）。
- **router**：新建 `api/routers/agents.py`，CRUD 五端点（list/get/create/update/delete），错误映射照 `api/routers/notes.py`（`InvalidInputError→400`、`NotFoundError→404`、`OpenNotebookError` 上抛全局 handler）；创建/更新带 `model` 时 `await Model.get(model_id)` 校验存在（`source_annotations.py` 对 Source.get 的先例）。payload/response 模型加进 `api/models.py`：`AgentCreate/AgentUpdate/AgentResponse`，PUT 用 `exclude_unset` 语义（先例 `source_annotations.py:115`）。
- **注册**：`api/main.py` import 块 + `app.include_router(agents.router, prefix="/api", tags=["agents"])`（include 块 `api/main.py:405-446`）。
- **迁移登记**：`open_notebook/database/async_migrate.py` **up 与 down 两个硬编码列表都要加**（`:176`/`:277` 附近）——漏登记无报错、迁移永不执行，这是最易踩的坑。

### 1.3 对话侧字段：chat_session.agent 与请求通道

- **类型裁决：`chat_session.agent` 用 `option<string>`（存 "agent:xxx" 字符串），不用 `option<record<agent>>`。** 域模型 `agent: Optional[str]` 并进 `nullable_fields`——这才与 `model_override` 真正同构（迁移 8 原文：`DEFINE FIELD model_override ON chat_session TYPE option<string>`，纯字符串往返零转换；`open_notebook/domain/notebook.py:861-865`）。理由：`chat_session` 是高频读取路径（`get_session_or_404` → `ChatSession.get`，`api/routers/_chat_shared.py:52-58`），record 类型字段要求读写双向转换防护（§1.2），对存量旧表引入这层复杂度不换任何功能收益；引用存在性校验放在写入侧（router 设置 `agent_override` 时 `await Agent.get` 校验，见 §1.2），读取侧用现成 `normalize_record_id("agent", id)` 补前缀（`_chat_shared.py:37-40`）。悬空行为见 §1.1 悬空引用策略第 2 条（回退默认助手，不炸会话）。
- `ExecuteChatRequest` 加 `agent_override: Optional[str]`（`api/routers/chat.py:66-74`）。
- **解析优先级（正交设计）**：智能体与模型是两个正交维度——agent 提供人设 + **默认**模型；显式模型选择永远压过 agent 默认：

```
agent  = request.agent_override > session.agent > None
model  = request.model_override > session.model_override > agent.model > DefaultModels.default_chat_model
```

  落点在 `api/routers/chat.py:320-325` 的 model_override 解析处扩展。前端会话级 `agent` 管理平行于现有 `model_override` 全链路（`use-notebook-chat.ts:257-268` 的 setModelOverride 模式照抄一份 setAgentOverride，含无会话时 `pendingAgentOverride` 暂存）。
  **互斥语义（实施裁决，堵住终审发现的产品缺口）**：选择器是互斥单选，session 上两字段并存会让"选了智能体 A（绑 GPT-5）但 session.model_override 还留着 M"时下一条回答用 M——用户视角是"智能体没生效"。裁决：**前端切换到 agent 时同时 PATCH 清空 session.model_override（反之亦然，切 default 两者都清）**；后端解析公式保持文档版不变（显式模型仍压过 agent.model，防御旧 API 调用），但正常 UI 路径不会产生并存状态。
- **消息元数据**：`ChatMessage`（`api/routers/_chat_shared.py:25-29`）加四个可选字段 `model_name/agent_name/run_role/group_id`（`run_role: 'answer' | 'synthesis' | None`；`group_id` 见 §4.4 分组设计）；`extract_chat_messages`（`:82-94`）从 LangChain 消息的 `additional_kwargs` 读取。写入侧：单路/并发/总结各端点构造 AIMessage 时把元数据快照进 `additional_kwargs`（消息级快照，智能体后续改名不影响历史）。前端 `NotebookChatMessage/SourceChatMessage`（`frontend/src/lib/types/api.ts`）加同名字段，AI 气泡头部渲染来源徽章。

---

## 二、智能体配置页

### 2.1 路由与注册

- 路由 `/agents`：`frontend/src/app/(dashboard)/agents/page.tsx`，'use client' + 自包 `AppShell`（认证/Provider 由 `(dashboard)/layout.tsx` 统一注入，无需处理）。
- 侧边栏：**manage 分组**，插在 transformations 之后（`AppSidebar.tsx:77` 与 `:78` 之间）——与 transformations 同属"prompt 预设类资源"语义相邻；图标 `UserCog`（lucide-react），`iconClass: undefined`。
- ⌘K：**必须同步** `CommandPalette.tsx:35-44` 第二份清单加一行（keywords: `['agent', 'assistant', 'persona', 'role', 'prompt']`）——两份手写清单无共享抽象，只改侧边栏则命令面板搜不到。
- 高亮：`AppSidebar.tsx:105-112` 最长前缀匹配自动生效，`/agents` 无前缀冲突。

### 2.2 页面结构（照抄 transformations 四件套）

| 文件 | 结构 |
|---|---|
| `frontend/src/app/(dashboard)/agents/page.tsx` | AppShell + `font-display text-2xl` 标题 + 描述行 + 刷新按钮（照 `transformations/page.tsx`，去掉 Tabs） |
| `.../agents/components/AgentList.tsx` | 三态：`LoadingSpinner` / `EmptyState`+新建按钮 / 卡片列表；`editorOpen + editingItem` 双 state 让新建/编辑共用 Dialog（照 `TransformationsList.tsx:22-28`） |
| `.../agents/components/AgentCard.tsx` | Collapsible 卡片：名称 + 描述 + Badge（绑定模型名或"跟随默认"）+ 展开 system_prompt 预览；右侧 Edit(outline)/Trash(ghost destructive)；删除走 `ConfirmDialog`（`confirmVariant='destructive'`，isLoading 内建） |
| `.../agents/components/AgentEditorDialog.tsx` | RHF + zodResolver + Controller（黄金模板 `TransformationEditorDialog.tsx`）；`open`/props 变化 useEffect reset + 关闭 reset 双保险 |

表单字段与校验（zod）：name（必填）、description（可选）、system_prompt（必填，多行 Textarea 或 MarkdownEditor）、model（Radix Select + **哨兵字符串** `DEFAULT_MODEL_VALUE` 表示"跟随默认"→ 提交时映射 null——Radix Select 不接受空串 value，`TransformationEditorDialog.tsx:32` 坑）、temperature（可选，数字输入 0–2 步进 0.1）、max_tokens（可选，正整数）。

数据层三件套（全部照抄惯例，零新发明）：

- `frontend/src/lib/api/agents.ts`：`agentsApi { list, get, create, update, remove }` 包唯一 `apiClient`（路径不带 /api 前缀，拦截器拼；**禁止第二个 axios 实例**），接口类型同文件导出。
- `frontend/src/lib/hooks/use-agents.ts`：`AGENT_QUERY_KEYS` + `useAgents/useCreateAgent/useUpdateAgent/useDeleteAgent`；mutation 内 `invalidateQueries` + `useToast` 成功/失败 toast（toast 只写在 hooks 里）。
- react-query 默认配置沿用 `api/query-client.ts`。

### 2.3 i18n 键清单（英文键 + 中文文案，14 locale 全量补齐）

命名空间照 `transformations.*` 形状，一个功能一个顶层命名空间：

| 键 | 中文文案 |
|---|---|
| `navigation.agents` | 智能体 |
| `agents.title` | 智能体 |
| `agents.desc` | 预定义模型角色，在对话中一键切换或并发对比 |
| `agents.createNew` | 新建智能体 |
| `agents.name` | 名称 |
| `agents.namePlaceholder` | 如：架构真题解析官 |
| `agents.description` | 描述 |
| `agents.descriptionPlaceholder` | 这个角色擅长什么、何时选用（可留空） |
| `agents.systemPrompt` | 系统提示词 |
| `agents.systemPromptPlaceholder` | 定义角色、口吻与答题策略…… |
| `agents.systemPromptHint` | 将作为角色设定注入对话，文档引用与上下文能力保留不变 |
| `agents.model` | 绑定模型 |
| `agents.modelHint` | 留空则跟随会话或系统默认模型 |
| `agents.modelMissing` | 绑定的模型已被删除 |
| `agents.temperature` | 温度 |
| `agents.maxTokens` | 最大输出 tokens |
| `agents.parameters` | 推理参数（可选） |
| `agents.noAgents` | 还没有智能体 |
| `agents.noAgentsDesc` | 创建一个模型角色预设，在对话中随时切换 |
| `agents.deleteTitle` | 删除智能体 |
| `agents.deleteConfirm` | 确定删除「{{name}}」？此操作不可撤销。 |
| `agents.deleteConfirmInUse` | 确定删除「{{name}}」？仍有 {{count}} 个会话绑定此智能体，删除后这些会话将回退默认助手。此操作不可撤销。 |
| `agents.createSuccess` / `updateSuccess` / `deleteSuccess` | 智能体已创建 / 已更新 / 已删除 |
| `agents.nameRequired` | 请输入名称 |
| `agents.systemPromptRequired` | 请输入系统提示词 |
| `agents.invalidTemperature` | 温度需在 0 到 2 之间 |
| `agents.invalidMaxTokens` | 最大输出 tokens 需为正整数 |
| `agents.enabled` / `agents.disabled` | 启用中 / 已停用 |

en-US 先加（TranslationShape 源），其余 13 个 locale 同 PR 补齐——缺键 tsc 直接失败，这是新增页面最大量的机械工作（预算单列）。

---

## 三、对话选择器改造：ModelSelector → 分组下拉

### 3.1 形态裁决：单一 Radix Select + SelectGroup 分组（推荐）

新组件 `frontend/src/components/chat/ChatParticipantSelector.tsx`。**组件归属的事实澄清**（评审订正）：仓库存在两个同名组件——ChatPanel 导入的是本地 `components/sources/ModelSelector.tsx`（`ChatPanel.tsx:24`，全仓库仅此一处引用），transformations/podcasts/search 用的是 `components/common/ModelSelector.tsx`（`TransformationPlayground.tsx:14` 等 4 处）。因此原地改造 `sources/ModelSelector` **不会**波及 transformations（初稿声称"被 transformations 引用"是混淆了两个同名组件，此处更正）。仍选择新建而非原地改，理由换成成立的两个：① 职责分野——"对话角色"（智能体+模型+默认，value 带 `agent:`/`model:` 前缀编码）与"纯模型选择"是两个语义，往通用组件里塞对话域概念会让两个调用方互相牵制；② 归属——对话专属组件应落 `components/chat/` 域（并发选择 Popover 等后续组件同域），`sources/` 下的旧组件保持不动、ChatPanel 换引用即可。

```
[ 默认助手（GPT-5） ▾ ]        ← Dialog 触发按钮（沿用现有 ModelSelector 的 Dialog+Select 骨架）
┌─ 对话角色 ────────────┐
│ 默认助手（系统默认模型）│
│ ── 智能体 ──────────── │  ← SelectGroup + SelectLabel
│  ◆ 架构真题解析官      │
│  ◆ 论文评审员          │
│ ── 模型 ────────────── │
│  GPT-5 · openai       │
│  Claude · anthropic   │
└───────────────────────┘
```

**选中值前缀编码**（关键设计）：value 空间 = `'default'` | `'agent:<agent_id>'` | `'model:<model_id>'`。ChatPanel 持有复合状态 `participant: { kind: 'agent' | 'model' } | undefined`，resolve 后分别走 `onAgentChange` / `onModelChange`——对现有 props 链（`ChatColumn.tsx:118-120` → `use-notebook-chat.ts`）是最小增量，且天然向后兼容纯 model id。

**推荐理由（对比三形态）**：
- **分组下拉（当选）**：智能体与模型互斥单选，单列表天然匹配；Radix `SelectGroup` 原生能力零新依赖；智能体条目副标题显示"绑定模型/描述摘要"，信息密度合适；Claude Code 的 @-mention 候选也是单列表形态。改动集中在替换 ChatComposer 里一个组件（`ChatPanel.tsx:553-561`）。
- 双 Tab（先选类别再选目标）：多一次点击，且"默认助手"归属两难；否决。
- 卡片网格：适合 ≤10 个选项，模型列表可达数十个；否决（并发选择的 Popover 里反而适合用紧凑勾选列表，见 §4.2）。

组件逻辑：`useAgents()`（enabled 过滤）+ `useModels()`（`type==='language'` 过滤）两 query 合成选项；`'default'` 映射 undefined；agent 选项 Badge 显示 `agents.modelMissing` 当其 `model` 已悬空。

### 3.2 挂载点与状态流

- `ChatPanel.tsx:553-561` 替换 ModelSelector 为 ChatParticipantSelector（标签 `chat.participant`）；`ChatComposerProps` 加 `participant/onParticipantChange` 与并发相关 props（§4.2）。
- `ChatColumn.tsx:118-120` 桥接扩展：`onAgentChange → useNotebookChat.setAgentOverride`（平行照抄 `setModelOverride` `use-notebook-chat.ts:257-268`，含 pending 暂存 + 建会话随 body 传 `agent`，`chatApi.createSession` 调用处 `:165-170`）。
- 来源对话页（`sources/[id]/page.tsx`）：MVP 不接智能体（用户场景集中在笔记本工作区）；ChatPanel 按共享组件设计，来源页接入列增强批次。

---

## 四、并发回答（核心）

### 4.1 交互入口

ChatComposer 角色选择器右侧新增**并发按钮**（`Layers` 图标 + `parallel.compare` 文案，Popover）：

- Popover 内：紧凑勾选列表（智能体 + 模型混排，Checkbox 多选；已选项在按钮旁以小 Badge 行显示名称）；计数徽章 `parallel.runsSelected`（{{count}}/5）；选第 6 个 toast `parallel.maxReached` 并拒绝勾选。
- 并发集合是**仅下一次发送的临时状态**（不写会话）——竞品先例（big-AGI Beam 可对话中途任意时刻发起；Poe 同线程内对比；Open WebUI 模型选择器 "+" 追加）一致指向"入口内联于会话、临时组合"，"保存常用组合"（Beam Teams）列未来增强。
- 发送：`ChatComposer.handleSend`（`ChatPanel.tsx:517-522`）分支——并发集合非空时走 `onSendParallel(input, runs)`，否则走现有 `onSendMessage`。

### 4.2 请求编排裁决：后端单端点（当选），前端并发 N 路独立请求（否决）

**裁决：新建后端端点 `POST /api/chat/sessions/{session_id}/parallel`，一个 SSE 流多路复用，前端一次 fetch。**

论证（后端单端点胜出的三个决定性理由）：

1. **归档竞态只有单端点形态能干净解决**。并发多路的根本难题是消息持久化：同一 thread_id 并发 invoke 会产生 checkpoint 兄弟分叉（SqliteSaver 主键含每次新生成的 checkpoint_id，get_state 只见其一，历史交错不可测）。前端 N 路独立请求要么各打同一 `/chat/execute`（踩分叉雷），要么每路建临时子 session（会话列表膨胀 + 归并逻辑散落前端）。后端单端点则可以**执行与持久化解耦**：N 路执行不碰 checkpoint，归档在端点内串行完成（§4.4）。
2. **连接预算**。前端 fetch 走 Next.js `/api` rewrite 代理（`frontend/next.config.ts`），dev 代理是 HTTP/1.1，浏览器同源 6 连接上限——5 路并发 + 会话/来源等常规请求可能挤爆队列，表现为难排查的排队卡顿。单 SSE 流恒占 1 连接。
3. **总结合并的自然衔接**。总结合并（§4.5）是"已归档的 N 路回答 + 一个总结者"，逻辑上属于同一编排域，后端集中实现避免前端拼装 N 路结果再上传的往返浪费。

前端并发形态的残余优点（每路独立超时/重试）由 SSE 事件粒度（`run_error`/单路重试按钮）补偿。

### 4.3 后端：parallel 执行模型（执行与持久化解耦）

**不复用 chat_graph 节点做并发**——chat 图是同步节点 + 每请求新建事件循环的 hack（`open_notebook/graphs/chat.py:42-74`），线程/循环开销大。并发端点照 **ask 图的全 async 直调模式**（`open_notebook/graphs/ask.py:135-171`：`provision_langchain_model_with_info` + `model.ainvoke`，无图结构也无妨——并发执行本来就是扁平 N 路，不需要图编排）：

```python
# api/routers/chat.py 新增（或独立 api/routers/chat_parallel.py）
POST /api/chat/sessions/{session_id}/parallel
请求体: { message: str, context: dict,
          runs: [ {kind: 'agent'|'model', id?: str} ],   # 1..5，model 可省 id = 默认模型
          agent_override?, model_override? }             # 会话级角色兼容

流程:
1. 校验 session（get_session_or_404）+ runs 数量 1..5 + 解析每个 run:
   agent → (label=agent.name, model_id=agent.model, instructions, temperature, max_tokens)
           Agent.get 返回 None（悬空）→ 降级默认模型路（§1.1 悬空引用第 3 条）
   model → (label=model.name, model_id, 无 instructions)
   model 解析优先级 = run 显式 > request.model_override > session.model_override > run 为 agent 时的 agent.model > 默认
1b. provision 复用（性能，缺一不可——评审补充）:
   - Model/Credential 查询按 model_id 去重: 端点内 per-request dict 缓存解析结果
     （ModelManager 无缓存、每 get_model 都查 SurrealDB，open_notebook/ai/models.py:211-215；
      5 路常有同 model_id 不同 persona 的组合）
   - token_count 只算一次: provision 内部对整个 content 做 token_count（open_notebook/ai/provision.py:33），
     N 路 payload 共享同一历史前缀、逐路重复计数是 5 次相同大文本 tokenize。给
     provision_langchain_model_with_info 加可选参数 token_count: Optional[int]（预计算传入则跳过），
     端点对共享前缀计数一次传给各路（>105k 判断跨路一致）
2. 读主会话历史: asyncio.to_thread(chat_graph.get_state, thread_id)   # 唯一一次读 checkpoint
3. 逐路构造 payload = [SystemMessage(persona 渲染)] + 历史消息 + HumanMessage
   —— system prompt 渲染复用同一 Prompter('chat/system')，state 里注入该路的
      agent_instructions/agent_name（jinja 自动可见，§4.6）；无 agent 的路不注入
4. 并发执行跑在独立 asyncio.create_task 的编排任务里（不是 SSE generator 里，见下）:
   results = await asyncio.gather(*[ run_one(spec) for spec in specs ], return_exceptions=True)
   run_one = provision(**温度/tokens kwargs) + model.ainvoke + clean_thinking_content
   + record_llm_usage(call_type='chat', correlation_id=f"{thread_id}:{run_id}")   # 并发路可区分成本
   —— 全程不写 checkpoint
5. 编排任务收尾: 归档（§4.4，含 await session.save() 刷新会话 updated——与
   execute_chat:368 行为对齐，否则并发回答后 会话列表排序/时间停滞）→ 向事件队列发收尾事件
```

**归档不依赖 SSE generator 生命周期（结构裁决，评审订正后定稿）**：端点把"并发执行 + 归档"放进一个**独立编排任务**（`asyncio.create_task`），SSE generator 只从 `asyncio.Queue` 中继转发事件。依据：本仓库安装的 Starlette 对 StreamingResponse 断连的处理（`.venv/Lib/site-packages/starlette/responses.py`，asgi spec<2.4 分支）是 `task_group.cancel_scope.cancel()` 取消整个响应 scope——generator 在已取消的 scope 内关闭，其 `finally` 里的任何 `await`（`asyncio.to_thread(update_state...)`）进入即再抛 `CancelledError`，**"在 generator finally 里归档"不可行**；spec≥2.4 分支（OSError→ClientDisconnect）下 generator 靠 GC 关闭，同样无法可靠 await。把归档放进 generator 之外的独立任务后：客户端断连 → generator 被取消 → 编排任务不受影响继续跑完归档（uvicorn 进程常驻，task 自行完成）。残余风险：归档进行中进程被杀则丢本轮归档——接受（与现有 /chat/execute 在响应前被杀同概率，非新增风险）。

SSE 事件 schema（`StreamingResponse` + `text/event-stream`，headers 照 `source_chat.py:440-444` 含 `X-Accel-Buffering: no`）：

```
{type:'runs_started', runs:[{run_id, label, kind, agent_id?, model_id?}]}   # 立即
{type:'run_complete', run_id, message_id, content, model_name?, agent_name?}  # 每路完成即发（伪流式：整段）
{type:'run_error',    run_id, message}                                       # 单路失败不拖垮其他路
{type:'archived',     messages: ChatMessage[]}                               # 归档后增量消息（含元数据）
{type:'complete'} | {type:'error', message}
```

前端类型 `ParallelChatStreamEvent` 加进 `frontend/src/lib/types/api.ts`。

**伪流式定位（明确接受）**：每路回答整段作为一个 `run_complete` 事件——与现有两条对话链路一致的体验基线（`source_chat.py:376-384` 同款伪流式），且 5 路并发时"完成一路显示一路"已提供渐进反馈，优于现状单路整段干等。真 token 级流式（`astream_events`/`stream_mode='messages'`）需要 chat 图异步化 + 前端打字机渲染组件，改造量大，列增强批次（§6 批次 6）。

**>105k token 自动切 large_context 的坑**（`open_notebook/ai/provision.py:37-42` 会静默覆盖指定 model_id）：并发路走同一 provision 链，行为与单路一致（超长上下文换大窗口模型）。设计上**接受**（跨路一致的保护机制），但在 `runs_started` 事件里回传实际解析出的 model_id，前端徽章如实显示实际应答模型——不默默骗用户。

### 4.4 会话持久化：串行归档进主 checkpoint

**裁决：并发回答不另建存储，归档为主会话 checkpoint 里的普通消息序列 + 元数据。**

```
归档 = asyncio.to_thread(chat_graph.update_state, config={thread_id},
       values={"messages": [HumanMessage(问题),
                            AIMessage(路1, additional_kwargs={model_name/agent_name, run_role:'answer', run_id}),
                            AIMessage(路2, ...), ...]})
```

- LangGraph `update_state` 走 add_messages reducer 追加消息、不执行节点，是标准旁路写入 API；全程只在**所有路 settle 后执行一次**（串行、单写者，跑在 §4.3 的独立编排任务里），SqliteSaver 的 threading.Lock 串行化（单实例内）足够——同 session 并发分叉竞态从根上不存在，因为并发执行阶段根本不碰 checkpoint。
- 归档时机与断连：全部路 settle（完成/失败）后由编排任务执行；客户端中途断连（AbortController/关页）时 SSE generator 被取消，但**编排任务独立于 generator**（§4.3 结构裁决），对已完成的路照样归档（数据是资产），未完成路丢弃；断连场景 `archived` 事件无人消费（前端本地已保留已完成内容的乐观渲染，刷新后以 checkpoint 为准——见下方前端时序）。
- **分组用显式 group_id，不用位置连续性推断（评审补充后定稿）**：归档时为每轮并发生成一个 `group_id`（如 `par_{uuid}`），写进每条回答消息的 `additional_kwargs`；综合结论消息带相同 `group_id` + `run_role='synthesis'`。前端聚合按 `group_id` 分组——彻底规避"普通回答穿插进并发组"的跨客户端交错（多标签页同会话、并发进行中又发了一条普通消息）把组形状渲染错的问题：组员固定、交错消息自然落组外。历史消息无 `group_id` = 普通单路回答，永不入组，零迁移。跨客户端并发写入本身：两端都走 update_state 串行追加（单连接 + threading.Lock），add_messages 语义保证不丢消息，API 层不加锁（单用户产品的边缘场景，接受"顺序按归档完成先后"）。
- **前端状态合并时序（评审补充后定稿）**：`use-parallel-chat` 收到 `archived` 事件 → 调注入的 `onArchived(messages)` 回调 → `use-notebook-chat` 把增量消息 append 进 messages state（乐观渲染的 live 对比卡切换为"历史模式"，按 message id 对账去重）→ 同时 fire-and-forget `refetchCurrentSession()` 兜底对账（照 `sendMessage:209` 现有模式）。此后若继续普通发送：`sendMessage` 全量替换 messages（`use-notebook-chat.ts:206`），checkpoint 已含并发轮次，替换结果天然一致，无两套状态拼接歧义。切换会话再切回：live runs state 清空，历史从 `session.messages` 全量重建（按 group_id 聚合渲染）——边界与普通会话切换现状相同。
- 历史渲染：`extract_chat_messages` 读 `additional_kwargs`（§1.3，`group_id` 一并透出到 `ChatMessage`），前端按 group_id 聚合渲染对比组卡片（§4.6）；`run_role='synthesis'` 渲染为综合结论气泡。**不迁移**现有消息。
- 不把消息存 SurrealDB（否决项见 Alternatives）：现有 checkpoint 架构是既定事实（ADR 层面未动过），为并发功能重造消息存储属于过度设计。

### 4.5 总结合并（用户点名"选一个模型/智能体总结后输出一份结果"）

- 新端点 `POST /api/chat/sessions/{session_id}/synthesize`，请求体 `{ source_run_ids: [run_id...], synthesizer: {kind:'agent'|'model', id?: str} }`，同样 SSE 伪流式（事件 `synthesis_started/synthesis_complete/archived/complete/error`）。
- 实现 = §4.3 的单路特例：不跑新 provision 链以外的任何编排，输入从**主会话 checkpoint 里刚归档的回答**取（按 run_id 过滤 additional_kwargs），prompt 用新模板 **`prompts/chat/synthesis.jinja`**：包含用户原始问题、N 路回答（逐路标注来源名）、以及**引用规范延续指令**（各路回答中的 `[source:xxx]` 引用 ID 原样保留——引用体系是本产品核心资产，综合结论必须可溯源）。总结路自身也带 agent_instructions（若选了智能体做总结者）。
- 归档：综合结论作为一条 `run_role='synthesis'` 的 AIMessage update_state 进主会话，排在各路回答之后。
- 前端：对比组卡片底部按钮 `parallel.mergeAnswers` → 小 Popover 选总结者（默认 = 会话当前角色/模型，任选智能体或模型）→ 生成中卡片底部显示 `parallel.synthesizing` → 完成后综合气泡出现在对比组下方，正常享受 MarkdownRenderer/引用点击/MessageActions。
- 合并策略 v1 只做"综合式"（synthesis）一种——big-AGI 的 Fuse/Guided/Compare 多策略与自定义 merge prompt 列未来增强；学术风险已提示：对有唯一正确答案的备考题，纯投票式合并会放大常见错误（popularity trap），综合式 + 保留人工对比视图正是规避形态。

### 4.6 前端：消息流 UI 形态

- 新 hook `frontend/src/lib/hooks/use-parallel-chat.ts`：状态 = `runs: ParallelRun[]`（`{run_id, label, kind, status:'pending'|'done'|'error'|'cancelled', content?, error?}`）+ 合成状态；SSE 解析复用 `use-ask.ts:155-207` 的 fetch+ReadableStream 逐行样板；**AbortController + 空闲看门狗照抄 `use-ask.ts:82-95`**（现有两条对话链路均无真取消，`use-source-chat.ts` 的 cancelStreaming 是死代码——并发场景必须补上）。
- 新组件 `frontend/src/components/chat/ParallelAnswersCard.tsx`：对比组容器 = 网格布局（`grid-cols-2`，3+ 路时 `lg:grid-cols-3`，窄屏纵向堆叠）；每路子卡 = 头部（标签徽章 = 智能体名/模型名 + 状态图标）+ 内容（复用 `MarkdownRenderer` 与引用点击体系）+ 失败态（`parallel.runFailed` + 重试按钮，单路重试调同一 parallel 端点只带该路 spec 且 `source_run_ids` 归档模式追加）。底部工具条：`parallel.mergeAnswers`。
- 消息列表集成：`ChatPanel` 的 messages.map（`ChatPanel.tsx:252-260`）改为先做**分组折叠**——按 `group_id` 把并发轮次的消息聚为一个 `ParallelGroup` 渲染单元（组员在归档时已定死，不受消息交错影响，§4.4；普通消息无 group_id、原样走 `ChatMessage`），不复制 ChatPanel、不动全屏三栏/引用点击/MessageActions（它们在子卡内部继续生效）。
- 视图形态 v1 只做并排网格；Open WebUI 实践过的"并排 vs 标签页可切换"（v0.6.19）列增强批次。不匿名（LMArena 匿名是为评测公正，学习场景直接标名）。
- 发送期间状态：`isStreaming` 单 boolean 不够用——并发期间 Composer 禁用逻辑改为"任一路 pending 时禁输入"（沿用 `disabled={isStreaming}` 的位置语义，ChatPanel.tsx:596/:602），但每路子卡独立 spinner/完成/失败。

并发相关 i18n 键：

| 键 | 中文文案 |
|---|---|
| `chat.participant` | 对话角色 |
| `chat.groupAgents` | 智能体 |
| `chat.groupModels` | 模型 |
| `chat.defaultRole` | 默认助手 |
| `chat.agentMissing` | 智能体已删除，已回退默认助手 |
| `chat.answeredBy` | {{name}} 回答 |
| `chat.synthesizedBy` | {{name}} 综合结论 |
| `parallel.compare` | 并发对比 |
| `parallel.compareHint` | 选择 2–5 个智能体或模型同时回答这个问题 |
| `parallel.runsSelected` | 已选 {{count}}/5 |
| `parallel.maxReached` | 最多同时选择 5 个 |
| `parallel.mergeAnswers` | 合并为一份答案 |
| `parallel.chooseSynthesizer` | 选择总结者 |
| `parallel.synthesizing` | 正在综合 {{count}} 份回答… |
| `parallel.runFailed` | 该路回答失败 |
| `parallel.retryRun` | 重试此路 |
| `parallel.cancelled` | 已取消，{{count}} 份完成的回答已保留 |
| `parallel.runsStarted` | {{count}} 路并发回答中… |

---

## 五、工作流必要性裁决：**缓做**（v1 不做，预设链为锁定演进形态）

### 5.1 结论

**不做自由画布工作流，也不在本期做任何编排功能。** "智能体 + 并发对比 + 总结合并"交付后，用户所述"设计哪些流程后哪个智能体处理接收决策"的诉求覆盖度评估：

| 用户场景 | 覆盖方式 |
|---|---|
| 同一问题多角色/多模型视角 | 并发回答（§4）✅ 直接覆盖 |
| 多路结论收敛为一份决策 | 总结合并（§4.5）✅ 直接覆盖 |
| 角色复用（出题人/阅卷人/教练） | 智能体配置 + 对话切换（§1–3）✅ 直接覆盖 |
| 多步链（会诊→评审→终审，如 `.zcode/workflow-drafts/论文助手多角色会诊`） | 手动串联：用智能体 A 会话→复制结论→智能体 B 会话 ⚠️ 间接覆盖（摩擦明显） |
| 条件分支/自动触发/持久编排状态 | ❌ 不覆盖 |

前三行是高频场景（每次提问都可能发生），后两行是低频场景；本期覆盖 ~80% 诉求，剩余 20% 用"手动串联"兜底。

### 5.2 论据

1. **VISION.md 直接裁决依据**：Principles「Simplicity over features — Easy to understand and use, even if it means fewer features」；Current Posture 明文「get the basics working well for everyone **before expanding**」——新表面（自由编排画布）正是该阶段应让位的扩张型功能。IS NOT 清单虽未点名工作流，但"replacement for your entire workflow"的排除方向一致。Horizon 里的「Agents operating Open Notebook」是角色反转（AI agent 经 MCP 操作本产品），与用户自建编排是两回事，不能拿来当先例。
2. **品类先例**：研究笔记本品类老大 NotebookLM 完全不做编排（只有 Configure Chat 轻量配置 + Audio Overview 等预设产物）；Mem 走零配置单 agent；Notion 止步"自定义 agent + 触发器"轻编排。只有 Dify/Coze 这类**造 bot 平台**才提供自由画布——而它们需要 Max Iterations、节点类型、变量系统等大量概念负担，open-notebook 是研究助手不是 bot 平台。
3. **架构成本**：工作流 = 新编排引擎（节点注册/变量传递/条件分支/执行状态持久化/失败恢复）+ 全新 UI 表面，规模 ≥ 本方案全部六个批次之和；且当前对话连真流式都没有（§4.3），编排基建应排在体验基线之后。
4. **用户自己没要**：原文是「你看有没有必要，如果有怎么融入你自己设计」——授权裁决而非强需求。

### 5.3 若做：形态锁定为"预设链模板"（非自由画布）

- **形态**：内置少量模板（如「多角色会诊」：读选定来源 → 3 角色并发 → 评审智能体 → 终审智能体；「真题三审」：作答 → 阅卷 → 讲解），每个模板 = 命名步骤序列，**每步绑定一个智能体 + 可调参数**，用户只选模板、选智能体、点运行——"机制预设、角色用户配"，与 transformations「prompt 模板机制化」同构。
- **接入点**：Studio 工具箱（transformations 已在 Studio 语境运行，是"对来源做结构化加工"的既有入口）新增"多步链"卡片；产物落为对话消息/笔记，复用本方案的元数据与渲染。
- **后端形态**：新 LangGraph，照 ask 图的 Send 并发扇出 + 阶段节点 + 全 async（`open_notebook/graphs/ask.py` 是仓库内被验证的编排范式），每步模型从 configurable 取。
- **明确不做**：自由拖拽画布、条件分支表达式、循环、定时触发。这些超出"研究助手"身份。

### 5.4 启动触发条件（防"缓做"变"永远不做"）

满足其一则开新 PDR 立项预设链：① dogfood 中用户**每周 ≥3 次**手动串联同一多步序列（复制粘贴结论跨会话）；② 社区/issue 出现 ≥5 个独立的多步编排请求；③ 并发对比交付后用户反馈"总结质量不够，需要分阶段多轮收敛"成为重复主题。在此之前，`.zcode/workflow-drafts/` 的多角色会诊脚本（已在本仓库）可作为预设链模板的需求样本保留。

---

## 六、实施任务清单（可独立交付批次）

> 规模为净开发人日估算（不含评审等待）；MVP = 交付用户可感知完整闭环的最小集；增强 = 后续迭代。每批一个可独立合并的 PR（批次 1+2 可合并为一个 PR——同一迁移 34，但任务独立验收）。

### 批次 1（MVP·后端）：智能体资源 CRUD

- **任务**：迁移 34 + down（§1.1 DDL）→ `async_migrate.py` 双列表登记 → `open_notebook/domain/agent.py`（§1.2，含 model 字段 `Union[str, RecordID]` 双向防护）→ `api/models.py` payload/response（含 `in_use_session_count`）→ `api/routers/agents.py` CRUD（list 带使用计数聚合查询）→ `api/main.py` 注册 → `tests/test_agents_api.py`（fake store 双面 mock 范式，照 `tests/test_source_annotations_api.py:1-7`）。
- **验收**：① `make api` 启动日志显示迁移 34 执行；② CRUD 全通且 name 唯一性/temperature 边界校验生效（pytest 覆盖）；③ 解绑模型/清空温度后字段真被清掉（nullable_fields 回归用例——这是 `_prepare_save_data` 的已知坑）；④ model 字段往返测试：写入 RecordID 后经 `Agent.get` 读回为合法值、再次 save 不炸（双向防护回归用例）；⑤ 删除前 list 端点返回的 `in_use_session_count` 与实际绑定会话数一致（智能体删除后自身不再出现在 list，无处观测"清零"——验收观测点改为删除前的计数正确性，实施修订）；⑥ `ruff check . && uv run python -m mypy .` 通过。
- **涉及文件**：`migrations/34.surrealql`、`34_down.surrealql`、`async_migrate.py`、`domain/agent.py`(新)、`api/models.py`、`api/routers/agents.py`(新)、`api/main.py`、`tests/test_agents_api.py`(新)。
- **规模**：1.5–2 人日。

### 批次 2（MVP·后端）：对话链路接入智能体 + 消息元数据

- **任务**：`ExecuteChatRequest.agent_override` + 优先级解析（§1.3）→ `ChatSession.agent` 字段（`Optional[str]` + nullable_fields，domain + 建会话/更新 payload；写入侧 `Agent.get` 校验存在）→ `ThreadState` 加 `agent_instructions/agent_name`（`graphs/chat.py:23-28`）→ `system.jinja` 加 persona 块（§4.6 注入位置：SYSTEM ROLE 之后、PROJECT INFORMATION 之前）→ provision 调用处透传 `temperature/max_tokens`（`graphs/chat.py:49,72` 两处）→ `ChatMessage` 四字段（model_name/agent_name/run_role/group_id）+ `extract_chat_messages` 读 `additional_kwargs` → 单路回答也写入元数据。
- **验收**：① 带 agent_override 请求的 system prompt 含 persona 块且 notebook/context/引用段完好（pytest 断言渲染结果）；② agent.temperature=0.2 请求经 provision 透传（单测 mock provision 捕获 kwargs）；③ 带 agent 的回答消息含 agent_name/model_name；④ **悬空回退**：会话绑定已删除的智能体后 `/chat/execute` 不报错、按默认助手应答（pytest）；⑤ 现有无 agent 请求行为逐字节不变（回归）。
- **涉及文件**：`api/routers/chat.py`、`api/routers/_chat_shared.py`、`open_notebook/graphs/chat.py`、`prompts/chat/system.jinja`、`open_notebook/domain/notebook.py`、`api/models.py`、`tests/`。
- **规模**：1.5–2 人日。**风险点**：>105k 自动切 large_context 会覆盖 agent 绑定模型（接受，行为与单路一致）；anthropic_compatible 分支的 kwargs 合并路径需一个手动验证用例（探索标注未实测）。

### 批次 3（MVP·前端）：配置页 + 对话选择器

- **任务**：`/agents` 页面四件套（§2.2）→ `lib/api/agents.ts` + `hooks/use-agents.ts` → `ChatParticipantSelector`（§3.1）→ ChatPanel/ChatColumn 替换与桥接 → `use-notebook-chat.ts` 的 agent_override 全链路（setAgentOverride/pendingAgentOverride）→ AppSidebar + CommandPalette 注册 → 14 locale 全量补键（§2.3 + §3 + chat 徽章键）→ 组件 vitest（照 transformations 同目录 *.test.tsx 惯例）。
- **验收**：① 配置页 CRUD 可用、删除有确认、空态/加载态正确；② ⌘K 搜"智能体"可达 /agents；③ 对话选择器可切换 智能体/模型/默认 三态并影响下一次回答（徽章显示 agent_name）；④ `npm run lint && npm run test && npm run build` 通过（build 隐含 14 locale satisfies 校验）。
- **涉及文件**：`frontend/src/app/(dashboard)/agents/**`(新)、`lib/api/agents.ts`(新)、`lib/hooks/use-agents.ts`(新)、`components/chat/ChatParticipantSelector.tsx`(新)、`components/sources/ChatPanel.tsx`、`app/(dashboard)/notebooks/components/ChatColumn.tsx`、`lib/hooks/use-notebook-chat.ts`、`lib/types/api.ts`、`components/layout/AppSidebar.tsx`、`components/common/CommandPalette.tsx`、`lib/locales/*/index.ts` ×14。
- **规模**：3–4 人日（其中 14 locale 机械补键约 1 人日）。

### 批次 4（MVP·核心）：并发回答端到端

- **任务（后端）**：`POST /chat/sessions/{sid}/parallel` SSE 端点（§4.3：runs 解析 → get_state 读历史 → **独立编排任务**内 gather 并发 ainvoke（无 checkpoint）+ update_state 归档 + session.save，SSE generator 仅经 asyncio.Queue 中继事件——归档不依赖 generator 生命周期）；provision 复用（model_id 去重查询 + token_count 预计算一次传入）；`record_llm_usage` correlation_id 带 run_id；runs 数量校验 1..5；group_id 生成与归档。
- **任务（前端）**：`lib/api/chat.ts` 加 sendParallel（fetch+SSE，signal 必接——不重复 use-source-chat 死代码教训）；`hooks/use-parallel-chat.ts`（per-run 状态 + AbortController + 看门狗 + onArchived 回调时序 §4.4）；`components/chat/ParallelAnswersCard.tsx`；ChatComposer 并发 Popover（上限 5）；消息列表按 group_id 分组折叠渲染；i18n `parallel.*` 14 locale。
- **验收**：① 3 路并发（混合 agent+model）每路独立完成/失败展示，失败路不拖垮其他路；② 完成后刷新页面，历史里的对比组完整再现（checkpoint 归档 + 元数据 + group_id）；③ **断连归档**：发起并发后立即 abort/关页，稍后刷新会话，已完成路仍归档（验证独立编排任务结构——Starlette 取消 scope 不影响归档）；④ 6 路被前后端双重拒绝；⑤ `runs_started` 回传的实际 model_id 与选择一致（large_context 切换时如实显示）；⑥ 并发进行中同会话插入一条普通回答，历史渲染两组互不错形（group_id 分组回归）；⑦ 并发轮完成后会话列表 updated 时间刷新（session.save 回归）；⑧ pytest：并发端点 fake 模型下全绿（两路成功一路失败的归档断言 + 断连场景归档断言）。
- **涉及文件**：`api/routers/chat.py`（或新 `api/routers/chat_parallel.py`）、`open_notebook/ai/provision.py`（token_count 可选参数）、`api/models.py`、`frontend/src/lib/api/chat.ts`、`lib/hooks/use-parallel-chat.ts`(新)、`components/chat/ParallelAnswersCard.tsx`(新)、`components/sources/ChatPanel.tsx`、`lib/types/api.ts`、`lib/locales/*/index.ts` ×14、`tests/`。
- **规模**：后端 2.5–3 + 前端 4–5 人日（+0.5 独立任务结构与 provision 复用）。**风险点**：① SqliteSaver 并发读（get_state）与归档写的锁行为在 5 路压力下需一次真实压测，**压测第一步先实测 `PRAGMA journal_mode` 实际值**（journal 模式由 langgraph `SqliteSaver.setup()` 的 WAL PRAGMA 决定——`.venv/Lib/site-packages/langgraph/checkpoint/sqlite/__init__.py:141`，仓库代码自身无任何 journal 设置，setup 依赖 langgraph 运行时"首次使用自动调用"；若实测为 DELETE（rollback journal）模式，写锁全库排他、锁冲突窗口比 WAL 更大，归档重试与 busy_timeout 缓解优先级上调）；② Next.js dev 代理下 SSE 经 rewrite 的缓冲行为需验证（后端已设 X-Accel-Buffering: no，与 source-chat 同路径，风险低）。

### 批次 5（增强 1）：总结合并

- **任务**：`prompts/chat/synthesis.jinja`（含引用延续指令）→ `POST .../synthesize` 端点（§4.5）→ 前端合并按钮 + 总结者 Poposer + `run_role='synthesis'` 气泡 → i18n。
- **验收**：① 任选智能体/模型为总结者，综合结论保留各路引用 ID 且可点击溯源；② 综合消息归档进主会话，刷新再现；③ 空输入/全部路失败时给出可理解错误。
- **规模**：后端 1 + 前端 1.5–2 人日。**判定**：用户点名需求的一部分，但依赖批次 4，属 MVP 闭环后的第一优先增强（若排期紧可并入批次 4 同 PR）。

### 批次 6（增强 2，按需排期）

| 项 | 内容 | 规模 |
|---|---|---|
| 单路重试 | 失败子卡重试按钮（同端点单路 spec 追加归档） | 0.5–1 |
| 标签页视图 | 对比组 并排/Tab 切换（Open WebUI 先例） | 1 |
| 来源对话接入 | source-chat 链路接智能体与并发（ChatPanel 已共享，主要是 hook 与端点参数化） | 2–3 |
| 真流式预研 | chat 图 async 化 + astream_events + 前端打字机组件（独立 ADR 前置——影响全部对话体验，不止并发） | 5–8，先出 spike 报告 |
| 常用组合保存 | Beam Teams 式命名组合（agent 表加 `is_preset` 或独立小表，届时再裁） | 1–1.5 |
| checkpoint 清理 | 会话删除时 delete_thread（现有缺口，并发使用会放大膨胀） | 0.5–1 |

---

## Alternatives considered

- **前端并发 N 路独立请求**（否决）：见 §4.2 三点论证——归档竞态无法干净解决、dev 代理连接预算风险、总结合并逻辑散落前端。
- **每路独立临时子 session / 临时 thread_id**（否决）：会话列表膨胀污染 UX；或 checkpoint 库膨胀（SqliteSaver 官方自述 demo 级不扩展多线程）；归并逻辑复杂且历史难再现。
- **智能体 system prompt 整段替换系统模板**（否决）：`chat/system.jinja` 承载 notebook 注入、context 渲染、数学格式与引用规范（CITING INSTRUCTIONS）——整段替换即丢引用体系，动摇产品核心（可溯源回答）。拼接式 persona 块保留全部基建。
- **并发消息存 SurrealDB 新表**（否决）：与现有"消息在 checkpoint、SurrealDB 只存会话元数据"的既定架构分裂，双存储一致性成本高；update_state 归档是零迁移的正解。
- **真 token 级流式先行**（否决，列增强）：chat 图同步节点 + 新事件循环 hack（`graphs/chat.py:42-74`），astream 化是独立大改造，且前端无打字机渲染组件；伪流式（每路整段）与现状体验一致并已提供逐路渐进反馈。
- **ModelSelector 原地改造**（否决，理由订正）：初稿称"被 transformations 引用"有误——ChatPanel 用的是 `components/sources/ModelSelector.tsx`（仅 ChatPanel 一处引用），transformations/podcasts/search 用的是另一个 `components/common/ModelSelector.tsx`，原地改并不波及它们。否决原地改的真实理由是职责分野（"对话角色"含前缀编码与默认态语义，与纯模型选择是两个概念）与组件归属（对话组件应落 `components/chat/` 域）；见 §3.1。
- **工作流：Dify/Coze 式自由画布**（否决）：见 §5.2。
- **工作流：Notion 式 agent+触发器**（否决但留观察）：触发器需要后台调度基建（ADR-004 worker 语境），且研究场景的"定时加工"已有 transformations 手动运行覆盖，优先级低于预设链。

## Consequences

- **做这个让什么变容易**：多模型/多角色对比成为对话的原生能力（一次 SSE 连接、归档即历史）；智能体让备考角色（出题/阅卷/讲解）一次配置处处复用；provision kwargs 透传打通后，未来任何"带参数调用模型"的功能（如 transformations 的温度）零额外后端成本；usage 记录带 run_id 后按路成本核算成为可能。
- **让什么变难/要看住**：`ChatMessage` 结构变更要求前端三处类型 + 14 locale 徽章键同步（漏则构建失败，属良性强制）；并发端点是新的编排表面，usage 的 correlation_id 语义变化需在统计页兼容；checkpoint 数据库的 journal 模式需在批次 4 压测**实测**（`PRAGMA journal_mode`）——它由 langgraph `SqliteSaver.setup()` 的 WAL PRAGMA 决定（`.venv/.../langgraph/checkpoint/sqlite/__init__.py:141`）而非仓库代码（全仓库 grep 无 journal 设置），且 `SqliteSaver(conn)` 直接构造不显式调用 setup（`__init__` 仅置 `is_setup=False`，setup 由 langgraph 运行时在首次使用时自动调用，其 docstring 自述 "called automatically when needed"）。chat 与 source_chat 两条连接写同一文件；若实测 WAL 生效，读写可并发、风险窗口小；若实测为默认 DELETE（rollback journal）模式，写锁全库排他，5 路并发 + source_chat 同时活跃时 "database is locked"（python sqlite3 默认 busy_timeout 5s）概率显著更高，缓解手段 = 归档阶段指数退避重试 + 显式设 busy_timeout。评估时不得凭"应是 WAL"的假设选缓解方案。
- **债务登记**：会话删除不清理 checkpoint 的既有缺口在并发使用下加速膨胀（批次 6 兜底）；`open_notebook/ai/models.py:212`（`ModelManager.get_model` docstring）的 "Esperanto will cache" 注释与实现不符（实际每请求新建实例）——对并发反而有利，但值得顺手修正注释；`EpisodeProfile.outline_llm/transcript_llm`（`Optional[str]` 无 validator，DDL 却是 `record<model>`，`podcasts/models.py:67-72` + 迁移 14）依赖 repo 层 `parse_record_ids` 侥幸工作，属脆弱范式，本设计的 `Agent.model` 已按 `SourceAnnotation` 范本补双向防护，EpisodeProfile 值得照此加固（独立小 PR，非本方案范围）。
- **裁决不可静默反转**：工作流"缓做"的启动触发条件见 §5.4；任何"顺手画个画布"的实现都违反本 PDR，须先立新记录。
