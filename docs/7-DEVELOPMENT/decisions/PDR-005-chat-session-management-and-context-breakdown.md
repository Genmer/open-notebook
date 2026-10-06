# PDR-005: 会话管理与上下文构成（历史编辑、in-flight 守卫、构成拆解）

- **Status**: Accepted
- **Date**: 2026-10
- **Related**: [ADR-004](ADR-004-background-workers.md)（异步优先）、[PDR-004](PDR-004-agents-and-parallel-chat.md)（并发回答与归档；本记录的 checkpoint 单写者语义延续其 §4.4）、[ADR-012](ADR-012-chat-context-preferences.md)（上下文偏好）

## Context

对话消息存 LangGraph SqliteSaver checkpoint（thread_id = `chat_session:<id>`，SurrealDB 只存会话元数据），这是 PDR-004 已确认的既定架构。但会话管理一直有三个缺口：历史只能整会话删除、无法删单条消息；source 侧流式发送没有 in-flight 守卫（同会话并发双流会踩 SqliteSaver 分叉竞态——PDR-004 §4.2 论证过的同一雷区）；上下文构成（系统提示/历史/来源/笔记各占多少）对用户完全黑箱。本期交付：checkpoint 级历史编辑端点、统一 in-flight 守卫、`/chat/context` 构成拆解（breakdown）与前端占比条/明细弹层/气泡删除入口。本文记录实施裁决与已知债务披露（含一处偏离设计原文的实施期发现）。

## Decision

### 1. 历史编辑：checkpoint 硬删（update_state + RemoveMessage），不做软删

`api/routers/chat_history.py` 的 `POST /chat/sessions/{sid}/messages/delete|clear` 直接对**所属图**的 checkpoint 做 `update_state` 写入：按 id 逐条 `RemoveMessage`，清空用 `REMOVE_ALL_MESSAGES` 哨兵。裁决理由：

- **单一数据源**：get_state 是所有读者的唯一出口（stream complete、`/chat/execute`、GET 会话、消息计数、chat_parallel 归档）。硬删后零读者侧改动；软删（`is_deleted` 标记或消息表 tombstone）要求每个读者过滤，等于在 checkpoint 之外再造一层视图逻辑。
- **原子性**：任一请求 id 不在 checkpoint 中则整体 404、什么都不删（`chat_history.py:118-123`）；空列表/超 500 条 400。
- **归属分派**：目标图由会话的 `refers_to` 边解析（`_chat_shared.resolve_session_owner_kind`）——两个图 state channel 不同，写错图会把 source 专属 channel 抹白。读侧（breakdown 历史段）同规则分派。
- **会话行不重存**：删除只动 checkpoint，不 bump 会话 `updated`，避免会话列表因内容删除而跳顶。

**blob 语义边界（必须知道的事）**：`update_state + RemoveMessage` 写入的是 checkpoint 版本链上的**新版本**（get_state 的逻辑视图里消息即刻消失），它不是对 sqlite 文件里历史 checkpoint 行/blob 的物理清除——物理删除唯一路径是 `checkpointer.delete_thread`（仅会话删除端点使用，见 `api/routers/chat.py:349-358`）。本设计不依赖旧版本被物理回收；sqlite 文件的版本留存与膨胀随 langgraph checkpoint 实现走，若未来需要瘦身，方向是定期 vacuum 旧 checkpoint 行，而不是改删除语义。

### 2. 删除端点与 in-flight 守卫合并：409 保护

删除/清空前检查 `session_in_generation`（`_chat_shared.py:152-166`）：notebook stream（`chat_stream.py` `_inflight`）∪ source stream（`source_chat.py` `_inflight`）任一命中即 409「A generation is already in progress」。会话删除端点（notebook `chat.py:336-340`、source `source_chat.py:329-332`）同一守卫。前端配套：删除入口在 `isStreaming || parallel.phase === 'running'` 时隐藏、`temp-*` 乐观气泡不显示入口（ChatPanel `messageDeleteLocked`）、并行组的问题消息 `suppressDelete`（删问题会孤立答案组）。

### 3. source 流式 in-flight 行为变化（披露）：并发双流从「各自跑」变为 409

`api/routers/source_chat.py` 的 send 端点新增 `_inflight` 集合守卫（`:501-503`）：同会话第二个并发流式请求现在 409。**这是行为变化**——此前两个并发 sendMessage 会各自 invoke 同一 thread（SqliteSaver 分叉竞态，历史交错不可测）。守卫语义与 `chat_stream.py` 完全同构（成员检查与 add 之间无 await，单事件循环内原子，无 TOCTOU）。旧客户端若依赖并发双流会看到 409——这是有意的修正而非回归。

### 4. `/chat/execute` 复活窗口（披露）：守卫不覆盖它

删除端点的 409 只合并了两个 stream 守卫；`/chat/execute` **刻意不在守卫内**（红线：该端点语义零变化，`chat_stream.py:23-24` 头注明言）。因此存在窗口：一个已在跑的 execute invoke（基于删除前的 checkpoint 快照）在删除完成后落盘，其新 checkpoint 的 parent 链在删除版本之前，get_state 取最新版本时被删消息可能「复活」。接受理由：前端默认路径全部走 stream（已守卫）；execute 只剩旧 API 客户端与回滚用途；把 execute 纳入守卫即改变其语义，违反冻结红线。缓解：前端删除入口在生成期间隐藏，正常 UI 路径不会制造该并发。

### 5. 实施期发现（偏离设计原文）：`await task` 必须 `asyncio.shield` 包裹

设计原文为 `result = await task`。实测：客户端断连时 Starlette 取消响应 scope，`Task.cancel()` 会**级联取消被 await 的内部 future**——裸 `await invoke_task` 会让 wrapper 一并被取消，`add_done_callback` 提前触发、in-flight 守卫过早释放，恰好重开本守卫要关闭的 lost-update 窗口。修复：`result = await asyncio.shield(invoke_task)`（`source_chat.py:429-436` 注释自证）——shield 让 wrapper 继续等（工作线程无法取消、必须落完 checkpoint），CancelledError 照常传给 generator 结束流，只有 invoke 真正完成才释放守卫。测试依据：`tests/test_chat_history_api.py` h15（完成即释放）/ h16（断连后守卫保持到落盘）/ h17（前置失败释放守卫）。**后续任何「独立任务 + done_callback 释放守卫」的结构都必须套 shield，这是可复用结论。**

### 6. 上下文构成拆解（breakdown）

`/chat/context`（`chat.py:480-545`）在既有装配数据上零成本附加 `compute_context_breakdown`（`_chat_shared.py:286`）：四段固定顺序 system_prompt / history / sources / notes，字符数与占比 + per-item 明细（历史段带 message_id/role，来源段带模式 full/insights）。**序列化口径**：各段按「实际放进 prompt 的那个对象」计数字符（来源/笔记项 `len(str(item))`、历史项 `len(content)`、系统段渲染骨架），不引入第二套组装路径，因此 sources+notes 段与响应顶层 `char_count` 恒可对账；token 不引入新 tokenizer，沿用 `token_count` 对拼接全文的粗估。要点：系统段用 `_render_system_skeleton`（context=None）渲染，防 CONTEXT 块双计；可选 `session_id` 让历史段反映该会话 checkpoint（读侧按归属分派，见 §1）；session 失效降级为零历史段而非失败（显示型请求不硬崩）。前端：`ContextBreakdownBar`（占比条）+ `ContextBreakdownDialog`（明细弹层，内嵌历史段逐条删除/清空入口）。后端 predates 字段时 `breakdown` 为 null，前端不渲染。

### 7. 消息删除入口的最终形态（验收修复补齐）

三层入口共享同一 mutation 语义（乐观移除 → checkpoint 响应权威替换 → 失败 refetch 对账）：① notebook 占比条 → 明细弹层 → 历史段逐条删除/清空（`ContextBreakdownDialog`）；② 消息气泡入口——human 气泡 hover 删除钮、AI 气泡 `MessageActions` 可选 `onDelete`（ChatPanel 内 `ConfirmDialog` 确认，受 §2 的锁与 temp-* 过滤）；③ source 详情页同等接入（`use-source-chat.ts` 的 `deleteMessages/clearMessages` 与 notebook hook 同款）。删除走统一端点 `/chat/sessions/{sid}/messages/delete`，后端按 refers_to 分派到 source 图或 notebook 图（`tests/test_chat_history_api.py` h8 验证 source 会话分派保 channel）。

### 8. 两条 DELETE 会话路径的 `delete_thread` 降级语义（披露）

notebook（`DELETE /chat/sessions/{id}`）与 source（`DELETE /sources/{sourceId}/chat/sessions/{id}`）两条会话删除路径同为两段式：先删 `chat_session` 行（前置 §2 的 409 守卫），再 `chat_graph.checkpointer.delete_thread` 清 checkpoint。**checkpoint 清理失败刻意降级为 warning 而非错误响应**：行已删、请求不可重试（客户端重试只会吃 404），把已成功的删除报成失败会诱导无意义重试；两个 saver 指向同一 sqlite 文件、chat_graph 的 checkpointer 覆盖所有 thread，残留 thread 是已记日志的缺口。代价：该清理不参与任何事务，进程在两段之间崩溃会留孤儿 checkpoint（与 §Consequences 的 Notebook.delete 缺口同类，单会话路径至少尝试清理）。

### 9. parallel 抖动（披露，`chat_parallel.py` 冻结遗留）

并发问答（PDR-004）**没有后端 409 门禁**（该文件语义冻结红线，本次未动）。其归档是每个 run settle 后串行 `chat_graph.update_state` 追加消息（`chat_parallel.py:243/467`）——若一次历史删除恰落在「synthesis 读取分组消息」与「归档 update_state 落盘」之间，两次写入的次序决定最终 checkpoint 内容，已删消息可能随归档写入「跳回」（抖动），且并行 run 的无 checkpoint ainvoke 不受影响、只有归档侧有此缝。缓解仅为前端锁：`isStreaming || parallelChat.phase === 'running'` 期间全部删除/清空/删会话入口禁用（ChatPanel `messageDeleteLocked`/`sessionDeleteLocked`、`ContextBreakdownDialog` `editLocked`）。纯 API 并行调用者需自行串行化；解冻 chat_parallel 时应把 `_inflight` 并入 §2 的合并守卫。

## Alternatives considered

- **软删（is_deleted 标记 / SurrealDB 消息表 tombstone）**（否决）：所有读者都要过滤，破坏「get_state 是唯一数据源」；且消息本就不在 SurrealDB。
- **把消息镜像进 SurrealDB 再删**（否决）：双存储一致性成本（PDR-004 已否决过同款）；checkpoint 已是事实存储。
- **给 `/chat/execute` 也加 in-flight 守卫以关死复活窗口**（否决）：违反「/chat/execute 语义零变化」冻结红线；收益仅覆盖非默认路径。
- **Notebook.delete 内联 checkpoint 清理**（见下，列为债务而非本期裁决）：需要 domain 层持有图引用与线程开销，本期未做。

## Consequences

- **变容易**：历史编辑成为 checkpoint 原生能力（零读者改动）；会话/消息/来源三条删除线共用一个 409 守卫语义；上下文构成对用户透明（占比条 + 明细 + 从明细直达编辑）。
- **已知债务（登记，非阻塞）**：
  - **N+1**：会话列表逐会话一次 `get_session_message_count`（`chat.py:136-141`，每次全量 get_state）。单用户会话规模下可接受；若列表变慢，方向是把 count 落到会话行（写入时刷新）。
  - **Notebook.delete 级联缺口**：级联删除 chat_session 行时（`open_notebook/domain/notebook.py:314-317`）不调 `checkpointer.delete_thread`——与单会话删除端点（`chat.py:349-358`，含清理与失败降级日志）不一致，删笔记本会留孤儿 checkpoint。Source.delete 更缺：既不删其 chat_session 行也无 checkpoint 清理（`notebook.py:738-792`，迁移 33 的清理 EVENT 只覆盖 source_annotation）。修复方向：把「删会话行 + delete_thread + 降级日志」收敛为一个共享清理函数供端点与级联调用。
  - **复活窗口**（§4）与 **sqlite 版本留存**（§1 blob 边界）：均接受并已披露，重启相关改动需新记录。
- **要看住**：新增「独立任务 + done_callback」结构必须 `asyncio.shield`（§5 可复用结论）；前端删除入口的锁（isStreaming ∥ parallel running ∥ temp-*）与后端 409 是双保险，任何一侧单独放宽都会重开竞态窗口。
