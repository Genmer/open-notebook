# G 线设计定稿：题目生成工作台 —— 页面内生成 + 本地缓存 + 备注重生成

- 作者：PM（生成工作台）· 设计整合自 PRD 终稿
- 日期：2026-10-11（定稿）；2026-10-11（实施，见 §7）
- 状态：已实施（端点 + 管线 + 模板×3 + 前端工作台 + localStorage 缓存 + 36 键 i18n 全部落地）
- 来源：2026-10-11 自 gitignore 的 workflow-drafts 定稿迁入（`.zcode/workflow-drafts/ruankao-ux-batch-design.md` 的 G 线部分——裁决索引、§1 终稿、落点与冲突清单、i18n 键清单、测试验收与红线小节；同稿 L 线部分已先行迁入 [width-layout-design.md](width-layout-design.md)；草稿本体与 PRD 输入不入库）。
- 核实声明：§2/§5 中的 file:line 为设计会话**改前**实读证据；§7 实施记录为 2026-10-11 收尾当日对现工作区**实读复核**。
- ADR 评估：**无新决策记录**（论证见 §8）。

---

## 1. 本稿裁决索引（G 线部分）

| # | 类型 | 内容 |
|---|---|---|
| 0-1 | **修正** | locale 数：G PRD 写 16 → **实为 14**（`ls frontend/src/lib/locales` + `locales/index.ts` 实读）。i18n 门禁口径：14 locale 同步，en-US/zh-CN 必翻，12 个 fallback locale 过解析断言 |
| 0-2 | 裁决 | 融合 vs 三页 → **融合**（§2.1） |
| 0-3 | 裁决 | outline `max_tokens` 8192 → **6144**，三 kind 常量表集中一处（§2.4） |
| 0-4 | 裁决 | 响应模型 OpenAPI 形态 → **单端点 + Union response_model**（§2.4） |
| 0-5 | 裁决 | 缓存上限 100 题 → **定稿为常量 `GENERATIONS_MAX_QUESTIONS = 100`**，无遥测不做数据驱动调参（§4） |

（原稿裁决 0-6/0-7/0-8 为 L 线两线归属与触屏兜底，见 [width-layout-design.md](width-layout-design.md)。）

## 2. 生成通道：端点与三个 kind

### 2.1 融合 vs 三页：融合

**同一道题 = 一个工作台 = 详情弹窗内三个产物区块竖排，不新增任何页面、路由、tab。** 理由三维度：①备考动线——三产物是同一道题破题的递进阶段（论点矩阵 → 问题2要点 → 论点提纲），现引导行已互相引用，同屏可对照；②状态管理成本相同甚至更低——生成状态按「题目×kind」二维键组织，融合只需一个挂载点；③导航深度——融合 0 新路由，寄生既有详情弹窗，`?tab=questionBank` 深链不变。空间顾虑由加宽（§5.1）+ 区块折叠缓解；区块高度差异大，竖排不做左右分栏。

### 2.2 端点与请求 schema

**`POST /api/ruankao/questions/generate`，同步、无状态、无 path 参数**（题目数据来自请求体——题目是前端 localStorage 记录，不是服务端资源，因此不查库）。骨架照 fixed-parts 先例（`api/routers/project_envs.py` generate_fixed_parts）：校验请求 → `asyncio.wait_for(渲染函数, 600)` → 异常映射 422/502/504。

```jsonc
{
  "kind": "breakdown" | "q2_points" | "outline",  // 必填；非法值 → pydantic 自动 422
  "title": "论负载均衡技术的应用",                 // 必填，trim 后非空 → 否则 422 no_title
  "year": "2024 上",                              // 可选，'' 视为未填
  "domain": "微服务与分布式",                      // 可选，'' 视为未填
  "prompts": { "q1": "…", "q2": "…", "q3": "…" }, // 可选；三问原文逐字透传，空串省略
  "note": "往云原生方向拆，避开纯算法对比"          // 可选；重新生成时的人工调整方向
}
```

- `title` 空/缺失 → `422 {"message": "...", "reason": "no_title"}`（对齐 no_material 语义）。**实施口径**：不用 pydantic `min_length=1`——那会让空串 422 的 detail 变 list 丢掉 `reason=no_title`；由 handler trim 统一裁决（实施记录 §7.1）。
- **请求体只含考试元数据与备注——红线的结构性保证**：端点没有 source_id 参数、管线不做任何检索，范文**在构造上不可达**（同 fixed-parts 的 ADR-017 论证）。

### 2.3 响应 schema（三 kind 定稿）

**`breakdown`（论点矩阵）**：

```jsonc
{
  "kind": "breakdown",
  "angles": [  // 4-6 个候选论点角度（validator 校验数量）
    {
      "name": "云原生环境下的弹性负载均衡实践",
      "thesis_hint": "主旨候选句方向（一句，考生须自己改写定稿）",
      "material_match": "高/中/低 + 一句说明：什么样的考生项目素材容易支撑该论点",
      "difficulty": "easy" | "medium" | "hard",      // 交锋难度（素材组织成本）
      "similarity_risk": "low" | "medium" | "high"   // 雷同风险：大众角度 high
    }
  ],
  "combo_advice": "组合建议：建议选哪 2 个角度、为什么、如何与摘要/背景呼应"
}
```

**`q2_points`（问题2要点）**：

```jsonc
{
  "kind": "q2_points",
  "framework": "技术方法框架：该题目惯用的论述框架名与展开逻辑（一段话）",
  "points": [  // 3-5 个要点（validator 校验数量）
    { "heading": "要点标题", "detail": "展开说明（含该要点常引用的技术/口径类型）" }
  ],
  "outline_hint": "由要点到段落的组织建议（顺序、衔接、常见坑）；正文必须考生自己写"
}
```

**`outline`（论点提纲）**：

```jsonc
{
  "kind": "outline",
  "paragraphs": [  // 恒 2 段（validator 校验恰 2 且 role 覆盖 q2/q3）
    {
      "role": "q2" | "q3",
      "outline": "该段 ~500 字提纲：论点主旨候选句 + 分层展开顺序（条目式）",
      "data_anchors": ["数据锚点口径类型（提示口径，不代造数字）"]
    }
  ]
}
```

### 2.4 后端实现规格（先例对照）

| 项 | 规格 | 落点 |
|---|---|---|
| 路由文件 | 新建 `api/routers/ruankao_questions.py`；`api/main.py` 注册 `prefix="/api"` | 实施记录 §7.1 |
| 模型 | `QuestionGenerateRequest`（`kind: Literal[...]`）+ `BreakdownResult`/`Q2PointsResult`/`OutlineResult`；**response_model = 三者 Union**（裁决 0-4） | `api/models.py` |
| 管线模块 | 新建 `open_notebook/ai/ruankao_question_pipeline.py`：`render_question_breakdown / render_question_q2_points / render_question_outline`，复用同包 `_invoke_json`（不 import api/，worker 兼容） | 实施记录 §7.1 |
| validator | breakdown：angles 4-6 且枚举合法；q2_points：points 3-5；outline：paragraphs 恰 2 且 role 覆盖 q2/q3 | 管线 `_validate_*` |
| max_tokens | kind 常量表：`BREAKDOWN=4096 / Q2_POINTS=4096 / OUTLINE=6144`（裁决 0-3；6144 理由：两段 500 字提纲 + data_anchors + JSON 开销 ≈ ≤4000 tokens，且消除「部分供应商单次输出上限低于 8192」的验证义务） | `QUESTION_KIND_MAX_TOKENS` |
| 超时/错误映射 | `asyncio.wait_for(..., 600)`：`TimeoutError`→504 `model_timeout`；渲染 `ValueError`（解析两试失败）→502 `model_error`；`OpenNotebookError`（含 ConfigurationError）透传既有契约 | 实施记录 §7.1 |
| 无状态断言 | 成功路径零 `.save()`、**零 `repo_query`**，且路由模块不持有任何持久化绑定（hasattr 负断言）——强于 fixed-parts 先例 | `tests/test_ruankao_questions_generate.py` |

## 3. 三个 jinja 模板要点（红线内嵌）

文件：`prompts/ruankao/question_breakdown.jinja` / `question_q2_points.jinja` / `question_outline.jinja`（先例：`prompts/project_env/fixed_parts.jinja`）。

**三模板共享的固定条款（红线，测试防删）：**

1. 上下文白名单：**只有**题目标题、年份、技术域、三问原文、用户备注。没有任何检索结果、笔记本上下文、范文文本——模板变量表就这五项 + `format_instructions`，多一个检索类变量即违规。
2. 输出中不得复述或改写任何范文段落；素材匹配描述的是「考生常见项目类型如何支撑」，不是引用具体文章。
3. 提纲与主旨句是**示范与候选**，明示考生必须自己改写定稿；数据锚点只给「口径类型」不代造数字。
4. 用户备注是方向约束：与题目元数据冲突时以备注优先，但备注不能诱导输出范文内容。
5. `Output ONLY the JSON object`——no preamble, no markdown fences（经 `{{ format_instructions }}` 注入）。

**各 kind 专属要点**：breakdown 恰 4-6 角度、大众角度必标 `similarity_risk: "high"`、`combo_advice` 落到「选哪 2 个 + 为什么 + 与摘要/背景呼应」；q2_points `framework` 点名惯用论述框架、恰 3-5 要点、`outline_hint` 重申正文考生自己写；outline 恰 2 段（role=q2/q3）、每段 ~500 字条目式提纲、`data_anchors` 只给口径类型清单。

## 4. 缓存 schema（localStorage）

**存储键：`ruankao.questionGenerations.v1`**（v1 后缀对齐 `ruankao.essayDrafts.v1`/`ruankao.trainingSessions.v1`，ADR-018）。实现落点：`frontend/src/lib/ruankao/question-generations.ts`（纯函数，可单测）。

```ts
export const GENERATIONS_STORAGE_KEY = 'ruankao.questionGenerations.v1'
export const GENERATIONS_KINDS = ['breakdown', 'q2_points', 'outline'] as const
export type GenerationKind = (typeof GENERATIONS_KINDS)[number]
export const GENERATIONS_MAX_QUESTIONS = 100   // 裁决 0-5

export interface StoredGeneration {
  content: BreakdownResult | Q2PointsResult | OutlineResult // 与端点响应同形
  generatedAt: string   // ISO
  note?: string         // 本次生成所用备注（空缺 = 无备注生成）
}

interface GenerationsStoreV1 {
  version: 1
  /** key = 题目稳定标识（见下），value = 按 kind 的最新结果（单结果，无版本数组） */
  entries: Record<string, Partial<Record<GenerationKind, StoredGeneration>>>
}
```

- **题目标识策略**：题目 `id` 优先（种子 id = 稳定 hash、user 条目 = 持久化 UUID，正常路径全部命中）；兜底 `normTitle = title.trim().replace(/\s+/g, ' ').toLowerCase()`（防御未来出现无 id 条目）。两种 key 共存同一 map，读取时 id 未命中再试 normTitle。
- **读取宽容**（对齐 `question-bank.ts` sanitize 姿态）：JSON 解析失败 / version 不符 → 回退空 store；单条坏目剔除不拖垮整体；`content.kind` 与 map 键不一致的条目丢弃。
- **容量与淘汰**：上限 100 题（裁决 0-5——项目无遥测，无数据可先验调参；错误上限的代价 = 最旧一题的结果被静默淘汰、可重新生成，损害低），超出按「该题最近一次生成时间」最旧淘汰。写入抛 `QuotaExceededError` → 先淘汰最旧 10 条重试一次，仍失败则**静默放弃本次缓存**（UI 会话内存内仍可见结果，不抛未捕获异常）——对齐 `essay-drafts.ts`/`question-bank.ts` 先例。
- **重新生成 = 带 note 覆盖，不保留上一版**：用户语义是「下次直接打开**这个**结果」（单结果心智）；版本列表把工作台变成文档管理器、存储翻倍且与 100 题上限互斥、换方向后旧版论点是干扰项。兜底：(a) 覆盖前 `window.confirm`（文案说明旧版将被覆盖、可先复制留存）；(b) [复制] 按钮常驻，考生可先拷走旧版。

## 5. 工作台 UI 结构

### 5.1 弹窗承载

- 详情 `DialogContent` 由 `sm:max-w-2xl` 升为 **`sm:max-w-4xl`**，保留 `max-h-[85vh] overflow-y-auto`。**必须带 `sm:` 前缀**：基类自带 `sm:max-w-[calc(100%-2rem)]`（`frontend/src/components/ui/dialog.tsx`），裸 `max-w-4xl` 在 ≥640px 会被基类压住（「sm: 前缀坑」，验收 C9 断言防回归）。
- 竖排布局：题面区（origin 徽标/标题/三问原文/来源，原结构保留）→ 三个产物区块 → 底部 D①/D② 完整文章通道按钮原样保留。

### 5.2 区块状态机（每 kind 独立，互不阻塞）

```
idle ──[生成]──▶ generating ──成功──▶ ready(generatedAt, note?)
  ▲                 │                    │
  │                 └──失败──▶ error(reason) ──[重试]──▶ generating
  │                                          ▲
  └──────────── 挂载时无缓存 ────────────────┘
ready ──[重新生成 → 展开备注 → confirm 覆盖]──▶ generating
ready/error ──[复制]──剪贴板（失败走既有兜底弹窗同款）
ready/error ──[发给教练]──coach-handoff 桥（题面 + 该产物全文 + 对应引导行）
```

- 挂载读缓存 → 命中直接 `ready`（显示 generatedAt 与 note 徽标），未命中 `idle`。
- error 文案按 reason 映射：`no_title`/`model_timeout`/`model_error`/`network_error`。
- **testid 约定**：`ruankao-qbank-workbench-block-<kind>`、`-generate-<kind>`、`-regenerate-<kind>`、`-note-input-<kind>`、`-copy-<kind>`、`-coach-<kind>`、`-status-<kind>`、`-content-<kind>`（辅助：`-toggle-`/`-retry-`/`-note-apply-`/`-error-`/`-generated-at-`）。
- 折叠策略：ready 默认展开，idle 默认折叠一行；手动展开/折叠记忆在会话内存态，不入 localStorage。

### 5.3 单飞与「关弹窗即中断」

- **面板级单飞**：同一时刻至多 1 个生成请求在途，其余区块 [生成]/[重新生成] 禁用。理由：`_invoke_json` 全局节流锁注释明言并发齐发是触发供应商限流的第一诱因（`project_env_pipeline.py`），UI 单飞是最便宜的第一道闸。
- **接受生成中关弹窗 = 中断**（同步端点 + 卸载断连，runToken 令牌失配 → 结果丢弃、不写缓存，重开回 idle）：单次典型 30-90s，误关损失 = 再点一次；转 worker 需任务表 + SCHEMAFULL 迁移 + `DATA_TABLES` 注册 + 导出测试三件套（ADR-018 升级义务），为 1-2 分钟调用不成比例（ADR-004 worker 定位是十分钟级任务）。缓解（必做）：生成中区块显示 `interruptHint` 文案 + 强制展开 + 弹窗标题行进行中徽标；ESC/遮罩不拦截。

### 5.4 备注输入与次选通道

- **备注输入**：仅 [重新生成] 展开（idle 首次生成不设备注框，降低首用成本）；单行 Input，placeholder 给方向示例；[带备注重新生成] 触发 confirm（文案含「旧结果将被覆盖」）→ 携 note 的新请求。
- **[复制]**：产物全文进剪贴板，成功 toast 用新键 `workbench.copyDone`（`copyForCoachDone` 是「复制给教练」长提示，语义不合，不复用）；失败走既有兜底弹窗（`copyFallbackTitle` 复用）。
- **[发给教练]**：桥本体 `coach-handoff.ts` **零改动**，预填 = 题面（`buildCoachText`）+ 该区块产物全文（若有）+ 对应引导行常量（`COACH_GUIDE_*`，中文教练语料不走 i18n）；产物未生成时退化为现状（题面+引导行）。「预填不代发」红线不变。
- **列表行「复制给教练拆题」原样保留**——零后端、不依赖模型配置的兜底通道，是未配模型用户的唯一路径。原底部 A/B/C 教练按钮内化为三区块教练通道。

## 6. 红线小节

1. **范文红线（ADR-017，最高优先级）**：生成上下文只有考试元数据（标题/年份/三问/domain）与用户备注——端点无 source_id、管线无检索、模板无检索类变量，范文**在构造上不可达**；输出不得复述/改写任何范文段落；模板红线条款由后端测试防删。检索仍只走 `text_search`/`vector_search` 公共入口——本线代码零检索、零 `.save()`、零 `repo_query`。
2. **考生自己定稿**：提纲与主旨句是候选示范，模板与 UI 文案明示考生自己改写定稿；数据锚点只给口径类型不代造数字；备注可定方向但不得诱导输出范文内容。
3. **「预填不代发」**：coach-handoff 桥本体零改动；工作台产物与列表复制通道同一产品语义——供参照，不代考生成稿。
4. **local-first（ADR-018）**：零服务端持久化、零建表、零迁移、零 worker 任务；升级触发器（跨设备/共享/导出）未命中不升级。
5. **UI 回归红线**：列表行「复制给教练拆题」动作不删除不变形（未配模型用户的唯一通道）；D①/D② 完整文章通道原样保留；全部 `data-testid`/`aria-label` 原名保留。
6. **`sm:` 前缀坑**：覆写 DialogContent 宽度必须带 `sm:` 前缀，C9 断言防回归。
7. **限流防线**：面板级单飞（同一时刻至多 1 个生成请求），叠加服务端 `_invoke_json` 节流锁双保险。
8. **i18n 门禁**：36 新键 ×14 locale 全同步 + `new-keys.test.ts` 钉账；组件内键用完整字面量；插值占位符全 locale 齐平。
9. **流程红线**：Conventional Commits；CHANGELOG Added/Changed 各归其位不建重复小节；L 线合入前 G 前端不得动 `QuestionBankPanel.tsx`（合入顺序 L → G，两线以 testid 锚定区域不依赖行号）。

## 7. 实施记录（2026-10-11，收尾当日对现工作区实读复核）

### 7.1 后端

- `api/routers/ruankao_questions.py`（新建）：`QUESTION_GENERATE_TIMEOUT_SECONDS = 600`（`:45`）；handler 侧 `title.strip()` 空 → 422 `{"message": …, "reason": "no_title"}`（`:59-67`——**实施口径**：不用 pydantic `min_length=1`，那会让空串 422 的 detail 变 list 丢掉 reason）；三 kind 分支各 `asyncio.wait_for(…, 600)`（`:72`/`:91`/`:108`）；`TimeoutError`→504 model_timeout（`:126-127`）、`ValueError`→502 model_error（`:128-130`）、`HTTPException`/`OpenNotebookError` 透传（`:131-134`）、兜底 500（`:135-140`）。
- `api/main.py:50` import、`:439` `app.include_router(ruankao_questions.router, prefix="/api", tags=["ruankao-questions"])`。
- `open_notebook/ai/ruankao_question_pipeline.py`（新建）：复用 `project_env_pipeline` 的 `_invoke_json`/`get_light_model`（`:19`，不 import api/）；`QUESTION_KIND_MAX_TOKENS = {breakdown: 4096, q2_points: 4096, outline: 6144}`（`:68`，裁决 0-3）；validator ×3（`_validate_breakdown`/`_validate_q2_points`/`_validate_outline`，`:81`/`:98`/`:113`）；`_question_data` 上下文白名单恰 title/year/domain/q1-q3/note（`:131`）；render ×3（`:158`/`:186`/`:215`）。
- `api/models.py`：`QuestionGeneratePrompts`（`:1878`）、`QuestionGenerateRequest`（`:1886`）、`QuestionBreakdownAngle`（`:1897`）、`BreakdownResult`（`:1905`）、`QuestionQ2Point`（`:1911`）、`Q2PointsResult`（`:1916`）、`QuestionOutlineParagraph`（`:1923`）、`OutlineResult`（`:1929`）、`QuestionGenerateResponse = Union[BreakdownResult, Q2PointsResult, OutlineResult]`（`:1934`，裁决 0-4）。
- `prompts/ruankao/question_{breakdown,q2_points,outline}.jinja`（新建 ×3）：QUESTION 段标题/年份/域/三问逐字白名单 + `CANDIDATE NOTE (direction constraint)` 条件段 + JSON-only 约束。

### 7.2 前端

- `frontend/src/lib/ruankao/question-generations.ts`（新建）：`GENERATIONS_STORAGE_KEY = 'ruankao.questionGenerations.v1'`（`:14`）、`GENERATIONS_MAX_QUESTIONS = 100`（`:19`）、`QUOTA_RETRY_EVICT_COUNT = 10`（`:22`）、`normTitleKey`（`:43`）、key = `id || normTitleKey(title)`（`:50`）、宽容读取（`:163` 起）、quota 淘汰重试/静默放弃（`:203-210`）、`readGeneration`（`:220`）/`saveGeneration`（`:232`）与最旧淘汰（`:251-252`）。
- `frontend/src/lib/api/ruankao-questions.ts`（新建）：`ruankaoQuestionsApi.generate`（apiClient 姿态）；`frontend/src/lib/types/api.ts` 增三响应类型与 discriminated union 请求/结果类型。
- `frontend/src/components/ruankao/QuestionBankPanel.tsx`：详情弹窗 `max-h-[85vh] overflow-y-auto sm:max-w-4xl`（`:1034`，sm: 前缀防基类压制）；`runTokenRef` 中断令牌（`:413` 声明、`:451` 失配自增、`:664-704` 生成回调全程校验——失配即结果丢弃不写缓存）；工作台挂载 grid `ruankao-qbank-workbench`（`:1162`）与全套 testid（`:1182` block、`:1189` toggle、`:1208` status、`:1220` generate、`:1234` regenerate、`:1244` copy、`:1259` coach、`:1278` retry、`:1302` generated-at、`:1324` content、`:1345` error、`:1373` note-input、`:1386` note-apply）；生成中 interruptHint 强制展开（`:668`）。列表行 L 线紧凑行 JSX 原样共存（其布局断言 describe 在同测试文件 `:871-894`，两线区域零越界）。

### 7.3 i18n

36 新键（`ruankao.questionBank.workbench.*`：顶层 21 + breakdown 10 + q2 2 + outline 3）×14 locale 全同步；en-US（`locales/en-US/index.ts:2767`）与 zh-CN（`locales/zh-CN/index.ts:2763`）为定稿真译文，其余 12 locale 按 §6-8 门禁落盘；`locales/new-keys.test.ts:1944` `QUESTION_WORKBENCH_KEYS` 钉账 + 独立 describe 四断言（en-US/zh-CN 非空、12 fallback 解析不裸键、删键回退 en-US）+ `generatedAt` 的 `{{time}}` 占位符全 locale 齐平断言。36 键的 zh-CN/en-US 定稿文案以 locale 文件为准（键清单钉在测试里，本文不复制防漂移）。

### 7.4 测试（as-built）

- 后端 `tests/test_ruankao_questions_generate.py`（新建，9 函数参数化后 13 用例）：三 kind 成功形状 + 元数据/note 逐字透传（`:96`/`:147`/`:169`/`:246` ×3 kind）、no_title（`:191`）、非法 kind 422（`:206`）、502（`:215`）、504（`:230`）、A6 双零断言——`repo_query` mock 未调用 + 路由模块 `hasattr` 负断言无 `repo_query`/`ProjectEnv`/`Source` 绑定（`:128-146`）、A8 三模板红线关键字防删（`:296` ×3 模板）。
- 前端 `frontend/src/lib/ruankao/question-generations.test.ts`（新建，8 用例）：B1-B7 全覆盖，B7 双路径（quota 淘汰 10 条重试 `:209` / 持续失败静默放弃 `:259`）。
- `frontend/src/components/ruankao/QuestionBankPanel.test.tsx`：C9 弹窗加宽断言（`:426`）、`describe('question workbench')` C1-C8（`:502-735`，mock `ruankaoQuestionsApi.generate`：三区块初始态、单飞禁用+interruptHint、成功渲染+落缓存、504/502/断网文案分流、备注重生成携 note、复制与兜底弹窗、教练桥载荷与退化、生成中关弹窗中断无残留）；列表级既有用例与 L 线 compact row 断言块零改动共存。

## 8. ADR 评估：无新决策记录

本线**不立新 ADR**，理由：

1. **同步无状态生成端点是既有模式的第三个实例，且该模式已有明文「不单独立记录」的先例**：generic-paragraph → fixed-parts → questions/generate 三代同构（校验 → `wait_for` → 422/502/504，零持久化）。ADR-018 的 Consequences 已写明「The fixed-parts endpoint and the coach-handoff bridge deliberately get no record of their own (an increment on the existing stateless-endpoint pattern…)」——问题生成端点正是同类增量；「为什么不走 worker」的定位论证由 ADR-004（worker 定位十分钟级任务）覆盖，端点 docstring 亦已注明。
2. **本地缓存是 ADR-018 local-first 规则的直接适用**：versioned key、宽容净化、容量上限、quota 兜底、升级触发器未命中不升级——全部落在 ADR-018 已裁决的规则内，`ruankao.questionGenerations.v1` 是该规则下的第四个 store，非规则变更。
3. **余下的裁决（outline 6144、Union 响应、100 题常量、单结果覆盖）是实现口径**，记录于本文 §1 并由测试钉住，不构成需要防重开的结构性决策。

## 9. 验收标准（对账）

- 后端：三 kind 200 形状、422 `no_title`（trim 后空统一此路径）、非法 kind 422、502/504 映射、note 逐字透传、A6 双零、A8 模板红线防删——§7.4 全落。
- 前端：B1-B7 缓存纯函数、C1-C9 交互（单飞/interruptHint/关弹窗中断/备注重生成 confirm/复制兜底/教练桥/弹窗 `sm:max-w-4xl`）——§7.4 全落。
- i18n：36 键 ×14 + 四断言 + 占位符齐平——§7.3 全落。
- 质量门禁：本批按任务限定跑定向自检（受影响 pytest/vitest 文件 + tsc --noEmit），全量 `pytest tests/` / `npm run test:coverage` / `npm run build` / lint 未在实施与收尾会话内全量重跑——如实记录，非断言全绿。
