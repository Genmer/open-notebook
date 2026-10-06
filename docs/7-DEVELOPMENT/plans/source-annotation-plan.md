# 来源标注系统产品规划（已裁决定稿）

> 综合来源：产品战略师、竞品调研员、内容视图勘察员、PDF 渲染勘察员、数据建模师、交互设计师、UI 视觉设计师、阅读地图设计师、分期规划师、AI 增值策划师共 10 份探索报告；本稿经产品评审（17 issues + 14 missing）与技术评审（9 issues + 6 missing）逐条处理（见 §12「评审处理记录」）。冲突处显式裁决并给理由（**【裁决】**）。
>
> **定稿状态（2026-10）**：评审修订终稿的 18 项开放问题已全部裁决、无遗留待定，逐条结果见 [PDR-003](../decisions/PDR-003-source-annotation-system.md) 与本文 §11「已裁决事项（原『开放问题』）」；正文与裁决冲突处已按裁决更新（受影响处标注**【已裁决修订】**）。MVP 执行拆解见 [MVP 任务清单](source-annotation-mvp-tasks.md)。

---

## 1. 产品定位与原则

### 1.1 一句话定位

标注模块 = **「挂在来源原文位置上的个人阅读痕迹层」**：划线（线型 × 颜色 × 语义）+ 批注文字（可选）+ 掌握状态。它不是笔记系统，而是让「第 N 遍重读比第 N-1 遍更省力」的记忆外置层。与 `VISION.md:16-28` 的「研究助手、非编辑器」身份相容。

### 1.2 与现有实体的边界（防数据割裂是硬约束）

| 实体 | 本质 | 存储 | 是否进 RAG | 与标注的关系 |
|---|---|---|---|---|
| **Note** | 独立文档（title/content，经 artifact 边挂 notebook，`open_notebook/domain/notebook.py:786-790`） | note 表 | 是（`Note.save` 自动提交 embed_note，`notebook.py:799-832`） | 标注可单向「转存为笔记」（复用 SourceInsight.save_as_note 模式，`notebook.py:421-431`），**绝不自动同步** |
| **SourceInsight** | AI 派生物（`notebook.py:369`） | source_insight 表 | 是 | insight 可消费标注（「基于我的划线生成汇总」），反向不行 |
| **Artifact** | AI 生成产物，落为 Note(note_type="ai") | note + artifact 边 | 是 | P3 起标注可作为 artifact 生成的显式输入 |
| **标注（新）** | 用户原始阅读痕迹，原文位置的元数据 | **独立新表 source_annotation** | **否（默认）** | 不 embed、不进聊天上下文、不占 notes 列表 |

**【裁决】标注独立建表，坚决不复用 Note 表。** 理由：① `Note.save` 自动提交 embed_note 命令（`notebook.py:819-827`），标注走它会灌爆 embed 队列；② `build_notebook_context` 默认拉取笔记本全部 notes（`open_notebook/utils/context_builder.py:328`），存成 Note 意味着标注**静默进入所有 chat/artifact 上下文**，违反「被 AI 使用要明示」；③ 概念混淆——笔记是文档，标注是位置元数据。

**【裁决】导出注册三清单，缺一不可**（评审修正，本会话核实）：source_annotation 须同 PR 注册进 ① `DATA_TABLES`（`commands/data_transfer_commands.py:93-101`）；② `TABLE_FIELDS` 字段白名单（`_export_row` 按它过滤，`:551-557`）；③ **`RECORD_FIELDS`（`:258-264`）登记 `source_annotation: {"source"}`**——导入侧 `_prepare_import_row` 只对登记字段做 string→RecordID 转换（转换分支 `:968-974`），不登记则裸字符串经 `_build_create_sql`（`:990-1011`）写进 SCHEMAFULL record 字段，SurrealDB 类型校验会拒绝写入或产生坏数据，直接击穿「import 后恢复」验收。色语义命名单例表 annotation_settings 同步加入 `CONFIG_TABLES`（`:104-106` 的固定 id 单记录模式）。ALL_TABLES 校验（`:111-113`）由 DATA_TABLES 自动满足；DATETIME_FIELDS 已含 created/updated（`:265`）。

**【裁决】源删除的资产防护（新增，回应「一次误删即毁灭数月痕迹」）**：① 前端删除源确认对话框显示「将连带删除 N 条标注、M 条笔记、K 条洞察」并要求二次确认（N 在对话框打开时按源取标注计数）；② **【已裁决修订·PDR-003 裁决 6/8】备份钩子挂在 `Source.delete()` 内、`super().delete()` 之前**（`open_notebook/domain/notebook.py:738-783` 是全部删除路径的收敛点：API DELETE 端点、group 级联与 notebook 独占删除均经此——实现在 API 路由层会被独占级联绕过，直接击穿误删防护）；**无标注则跳过备份**（消解上传失败清理为刚创建的零标注源写空 JSON 的噪音）；文件名 `annotations-backup_{sourceId}_{YYYYMMDD-HHmmss}.json`；备份 JSON 内嵌 source 元数据快照（id/title/url/created/page_count）+ 全量标注，格式与 P2 JSON 导入器兼容；**page_count 取值口径（2026-10-03 独立复核澄清）：Source 资产无页数字段（`Asset` 仅 file_path/url，`open_notebook/domain/notebook.py:345-347`，且 `page_count` 在 open_notebook/api/commands 全仓 Python 零命中），故 page_count = 全量标注 max(page)+1（「标注覆盖页数下界」，611 页册只标到 P100 记 101），JSON 以 `page_count_basis: "max_annotated_page_plus_one"` 注明口径，仅作导入预检的粗筛臂（主判据 = quote 抽检，见 §6.3）**；**永久保留，不做自动轮转**——单备份 >50MB 或 EXPORTS_FOLDER 标注备份总量 >1GB 再议轮转，届时出 ADR；用户文档注明备份位于 exports 目录、随手动清理处理。**不做软删除/回收站**——需要状态字段+恢复 UI+过期清理（约 2+ 人日），且与现有「删 source 即全级联」行为不一致；自动备份已覆盖误删恢复需求。风险表见 §8 #15。

### 1.3 产品原则（五条）

1. **标注是轻动作**：任何操作 ≤2 次交互；**无常驻模态框，不可逆的批量操作例外**（修订：原「无模态框」字面与批量删除确认冲突，见 §3.2 裁决）。
2. **痕迹是资产**：锚结构对齐 W3C Web Annotation（TextQuoteSelector：exact+prefix+suffix），引文快照 + 页码双锚，可导出可导入、不私有锁定。竞品反模式教训：微信读书导出锁死催生第三方灰色工具链、Weava 导出付费墙——对隐私优先、可自托管的 open-notebook，导出必须是一等公民。
3. **原文是唯一坐标系（远期理想态）**：v1 两视图各自锚定、总览以引文+页码统一呈现，跨视图自动镜像不做（§5.3 裁决）。
4. **默认不打扰 AI**：标注不改变 RAG 行为，作为上下文需显式开关且默认关。
5. **全部文案进 14 locale**（`frontend/src/lib/locales/zh-CN/index.ts:1` TranslationShape 约束）。i18n 三重门禁与预算见 §7。

### 1.4 北极星判据与明确不做

**判据：「该功能是否让第 N 遍重读比第 N-1 遍更省力？」**

兑现排布（评审修正：原稿全部读回能力压在 P2，前两期沦为纯写入系统）：P1 尾即交付最简「本源标注列表 + 按色过滤 + MD/JSON 最简导出」，P2 交付完整总览与复习手册——见 §7。

明确不做（含修订后判据）：
- **划线时自动触发的逐条 AI 解释不做**（打断心流）；**用户显式点击的划线段分析见 §9.2**——两者判据不同：前者是被动弹出，后者满足 §9.3 准入判据（显式触发 + 结果可跳转原文），且输出粒度与 insights 不同（片段级、用户锚定 vs 章节级、AI 选段）。修订消解初稿 §1.4 与 §9.2 的自相矛盾。
- 协作分享（单用户产品，PDR-001）；评论线程/回复（标注是独白不是讨论）；
- 自由绘图标注（违背轻动作；现查看器是单 canvas 位图无文本层，`frontend/src/components/sources/PdfSourceViewer.tsx:205-240`、`:492-497`，成本极高）；
- SRS 间隔复习调度（需要调度器+通知系统，超出研究工具边界）；
- AI 自动给标注打标签、AI 生成「理解演变叙事」、总览页 AI 摘要（详见 §9.3）。

### 1.5 备考专用 vs 通用研究工具

**【裁决】机制通用、语义用户定义。** 产品只给「5 色盘 + 2 线型 + 可命名的颜色含义」；「红=完全不会」是用户的命名数据，不是产品逻辑。不做备考专用实体（无考试倒计时、错题本实体、复习计划）；错题回顾用通用「颜色+时间过滤」实现。若「备考模式」请求持续出现，走 `VISION.md:43-45` 的 PDR 流程显式重估。

### 1.6 北极星的验证计划（新增，回应评审 missing）

无正式用户研究预算，采用两级验证：
- **P2 后定量埋点（前端本地计数，不回传）**：总览跳转次数、导出使用次数、二遍阅读期新增标注数/一遍期比值（比值下降 ≈ 「更省力」的代理指标）。
- **定性 dogfood 清单（维护者自用真实真题册）**：第二遍开始前能否在 5 分钟内只看「易错色」清单定位全部错题；导出的 MD 手册能否直接用于考前一晚过点。两项均列入 P2 验收附注（人工执行）。

---

## 2. 信息架构与功能清单

### 2.1 入口结构

**【裁决】主入口 = 源详情页第 4 个 tab「阅读地图」。** 现有 tab 结构 content/insights/details（`frontend/src/components/sources/SourceDetailContent.tsx:549-556`，本会话核实），insights 已带计数（`:552-554`），新增 `value="reading-map"` 带标注计数完全同构。**不新增侧边栏顶级页**——`frontend/src/components/layout/AppSidebar.tsx:49-82`（本会话核实）现有 4 个分组（collect/process/create/manage）共 12 个叶子项，再加一级碎片化 IA。命名弃用「我的痕迹」（信息量更小）。

**辅入口 = 源列表卡片角标**：`SourceCard.tsx:345-384` 元信息行对称加「N 条标注」chip + 迷你热度条；点击经 `router.push('/sources/${id}')` + `?tab=reading-map` 深链直达（`[id]/page.tsx` 现无 tab 参数，Tabs 现为 `defaultValue="content"` 非受控，`:549`，需小改受控化）。**annotations_count 计算方式同构 insights_count 子查询**（`api/routers/sources.py:673` 现有 `(SELECT VALUE count() FROM source_insight WHERE source = $parent.id …) AS insights_count`，本会话核实，改为查 source_annotation 即可）。

**笔记本级跨源聚合页 → P3**。**【裁决】聚合查询按 source∈notebook（reference 边）实时求值，source_annotation 表不设 notebook 字段**（评审修正，理由见 §5.1）。

### 2.2 标注核心心智（两视图统一）

**选中 → 浮条 → 落标 →（可选）写批注 → hover 查看 → 点开编辑**。同一套交互语法，仅锚点机制不同。

**【裁决】「评论」与「备注」合并为单一「批注」概念**（评审采纳建议①，消解两概念无判别规则的问题）：一条标注 = 锚点（文本/矩形）+ 色与线型 + **可选 body（批注文字）** + **display_position（body 的呈现槽位：NULL（未指定）| hover | inline | margin | overview）。【已裁决修订·PDR-003 裁决 9】MVP 期创建一律写 NULL；P1 起创建时按当前视图写默认档（PDF→margin、文本→inline），hover 降为普通显式选项；NULL 的三态渲染语义见 §3.3。** 用户视角只有一个动作「划线，顺便写一句话」，呈现位置是这句话的属性而非另一种东西。数据上无 kind 字段、无 parent 自引用，删除级联与撤销恢复随之简化为单记录语义。工具条由 9 键减为 8 键（[批注] 单键）。

### 2.3 功能清单 × 分期矩阵

| 功能 | MVP | P1 | P2 | P3 |
|---|---|---|---|---|
| PDF 视图 TextLayer + 划词（含 spike 判据与降级预案 §5.6；页级路由 + 12 页抽样三分支） | ✅ | | | |
| 划线（5 色 × 波浪/直线）+ 批注 body（hover 卡） | ✅(PDF) | ✅(文本视图) | | |
| 锚点持久化（PDF user space + quote 冗余） | ✅ | | | |
| 文本三段锚 + 三级重锚 + 孤儿降级 | | ✅ | | |
| 源文件替换检测（page 超界/quote 失配 → orphaned）；MVP 期仅有 page 超界轻量提示（PDR-003 裁决 16） | 提示 | ✅ | | |
| 按页懒加载 | ✅ | | | |
| **最简「本源标注列表」（按色过滤 + 跳原文 + 键盘可达）** | | ✅(新增) | | |
| **MD/JSON 最简导出（Blob 下载）** | | ✅(新增,期尾) | | |
| 批注呈现位置选项 inline/margin（overview gate P2；三态语义见 §3.3） | | ✅ | | |
| 扫描页矩形框选兜底（含 orphaned 重新框选操作） | | ✅ | | |
| 右侧痕迹栏（仅 PDF 视图，与目录**条件**互斥：<900px 容器剩余宽度；沟槽态豁免） | | ✅ | | |
| display_position=overview 档 | | | ✅(随阅读地图) | |
| 「显示我的痕迹」全局开关（localStorage，默认开）+ 色语义改名 popover | | ✅ | | |
| 阅读地图 tab（章节地图/时间线/全部痕迹，虚拟化=手写窗口化） | | | ✅ | |
| 跳转闭环（store 广播 + 深链 + 返回浮标，页级+锚点滚动） | | | ✅ | |
| 完整导出（scope/章末汇总/Anki CSV/存为笔记）+ JSON 导入（自备份恢复，含一致性预检） | | | ✅ | |
| 源列表标注角标（annotations_count 子查询） | | | ✅ | |
| 标注进 artifact 生成（显式开关，默认关） | | | | ✅ |
| 划线段显式「AI 分析」按钮 | | | | ✅ |
| 跨源复习册 / 笔记本级聚合页（按 reference 边求值） | | | | ✅ |
| 理解演变并排对比视图（非 AI） | | | | ✅ |
| 跨视图双写锚（一次双算两锚） | | | | 候选池末位（PDR-003 裁决 13） |
| 跨页划线 / 触屏 / 标注互链 / 第 6 自定义色 / 乐观锁并发 | | | | 按条评估 |

> 矩阵修正（评审）：原「锚点持久化 + 三级重锚 + 孤儿降级 ✅(MVP)」对 PDF-only 的 MVP 言过其实——PDF 锚在字节不变前提下不漂移，三级重锚是文本锚机制，随 P1 交付；MVP 交付的是 PDF 锚持久化 + 文件替换检测的数据基础。

---

## 3. 交互规范（各规格点标注交付期）

### 3.1 划词浮出工具条【MVP：PDF 视图；P1：文本视图】

**前提（PDF 视图）**：现有 canvas 无文本层（`PdfSourceViewer.tsx:492-497`，本会话核实为裸 canvas、无 wrapper），须先叠加 pdf.js TextLayer（pdfjs-dist 6.3.289 已内置，本仓库从未用过，预留 1 天 spike，失败判据与预案见 §5.6）。**【已裁决修订·PDR-003 裁决 1】交互路由永远按页判定，与全册文件性质解耦**：有文本层的页出划词浮条；无文本层的页 MVP 期出 inline 提示条（见下）；P1 框选工具条交付后自然补全页级路由。

**出现**：mouseup 且选区非折叠；位置 = 选区包围盒上方居中、间距 8px（`Range.getBoundingClientRect()` 视口坐标 + `position: fixed`，免疫双层 `overflow-y-auto` 嵌套——宿主 `sources/[id]/page.tsx:47` 与 `SourceDetailContent.tsx:548`）；150ms 淡入；上方空间不足（含滚动视口下缘翻转后仍溢出的情形）翻转到下方。

**消失与重现**：点击空白、Esc、选区被清除、开始下一次拖选；页面滚动即消失。**【裁决·评审修正】滚动停止后 150ms 防抖检查：选区仍存在且非折叠 → 工具条在新包围盒位置重新浮现**——否则「选区在视口下缘 + 拖选自动滚动」的用户会永远够不到工具条，违反 ≤2 次交互原则。

**布局（MVP 形态）**：`[●●●●● 色点] │ [〰/— 线型] │ [批注] │ [复制]`，单行 h-9（参照 `PdfSourceViewer.tsx:295` 的 h-12 层级）。

- 点色点 = 立即划线（当前默认线型，一步落标，无 body）；点线型仅切换后续默认；**[批注] = 划线 + 弹出输入框**（输入框内 P1 起附呈现位置选择，MVP 固定 hover 卡）。
- 快捷键分批【裁决】：MVP 仅 `Esc`；P1 上 `H` 划线（上次颜色+线型）/ `C` 批注 / `1-5` 切色（无现成快捷键库，与 InlineEdit、评论框的焦点冲突需逐一排查，分批降险）；`Alt+A` 痕迹显隐、`Alt+O` 总览放 P2。
- **MVP 期扫描页提示**【新增，回应评审 missing；PDR-003 裁决 1 定为页级路由入口】：当前页 `getTextContent` 为空时，工具栏下方显示 inline 常驻提示条「此页无文本层（扫描页）：文字划线不可用，框选批注将在下一期支持」（非 toast，避免反复打扰；P1 交付框选后移除）。**仅在划词主路径分支渲染**（2026-10-03 独立复核补）：换范围分支（§5.6 三分支之①）下矩形框选就是当期 MVP 主路径，本提示条不渲染——否则「下一期支持」对当期可用的功能说假话。

### 3.2 批注的查看、编辑与删除【MVP：hover 卡+pin；位置选项 P1】

**【裁决·已裁决修订（PDR-003 裁决 10）】hover 批注卡用已有 Radix Popover（`popover.tsx`，@radix-ui/react-popover ^1.1.15）受控模式实现，自研 150ms 开 / 300ms 容留延时（指针移入卡片不消失），不新增 @radix-ui/react-hover-card 依赖（封死）。** 若实测手感不佳，调参空间 = 自研延时两参数（开 150ms / 容留 300ms，可调区间 100-400ms）+ 卡片锚定位置微调；两轮调参仍达不到「hover 命中无感知丢失、无误消」再开 ADR 议依赖。容留参数全文统一 300ms（§4.4 原「关 200ms 容留」表述废止）。无 body 的纯划线 hover 只显示色点放大 + 引文轻提示（Glasp 式克制）。

**卡片结构**（视觉规格见 §4.4）：顶部 2px 色条 + 引文首行 + 批注内容 + 相对时间 + 右上角编辑/删除 ghost 图标（h-6 w-6，同 `PdfSourceViewer.tsx:553-561` 规格）。

**点开 = pin 编辑态**：单击划线（或卡内「编辑」）进入固定编辑态：文本域（body）+ 色点行（改色即时生效）+ 线型 toggle + **呈现位置 Select（P1 起，选项随视图可用性灰显，见 3.3）**。点击外部 / Esc 收起。

**【裁决·评审修正】删除交互与原则 1 对齐**：**单条删除无确认、即时执行**，sonner toast 内嵌「撤销」按钮（8s）恢复——合并实体后无子批注级联，撤销即恢复单条记录，语义干净。**仅批量删除（P2 总览多选）保留 AlertDialog 确认**（不可逆：批量操作不提供 toast 撤销）；原则 1 措辞已同步修订为「无常驻模态，不可逆批量操作例外」。v1 不做全局 undo 栈。

### 3.3 批注呈现位置【选项 P1 交付；overview 档 P2】

一条带 body 的标注，其 body 有四个呈现槽位（display_position，事后可改）。**【已裁决修订·PDR-003 裁决 9】三态语义（对实现者无歧义）**：

- **NULL（未指定；MVP 期创建的默认值）**：无 body = 纯划线（hover 只显色点放大）；有 body = 跟随当前视图默认档呈现（PDF→margin 痕迹栏、文本→inline）——而非固定 hover：MVP 期（标注最密集的头一遍）写的批注升级后自动进 P1 主打亮点痕迹栏，存量数据不落进被否决的形态。
- **hover**：正文只显示划线本体，body 在 hover 卡与最简标注列表中出现。
- **inline 行间嵌入**：引用块插入正文流（文本视图 = MarkdownRenderer 相邻段间；PDF 视图 = 当前页下方注脚块，可折叠），带色条 + body 文本，适合长注释。
- **margin 右侧痕迹栏**：正文右侧固定 256px 栏，短批注 + 锚点色条按位置排布，点击滚动到原文。**【裁决·评审修正】margin 档 v1 仅 PDF 视图支持**：MarkdownRenderer 单列流式布局加右侧固定栏需容器级布局改造，成本与收益不匹配；文本视图的位置选择器中 margin 灰显并注明「PDF 视图专属」。**P1 起创建时按当前视图写默认档（PDF→margin、文本→inline），hover 降为普通显式选项。**
- **overview 仅总览可见【gate 到 P2】**：正文只留划线痕迹，body 只在阅读地图总览出现。**评审修正：P1 无总览，此档无展示面，P1 选择器不出现该选项**（枚举在 schema 中保留，UI gate）。

**「显示我的痕迹」全局开关**【P1】：工具栏 Toggle，一键隐藏全部标注本体进入纯阅读模式（含划线与 hover 响应）；**持久化 = 全局 localStorage（键独立命名防碰撞，frontend/AGENTS.md:22 惯例），默认开**；不按源记忆（简化）。

**【裁决·已裁决修订（PDR-003 裁决 2）】PDF 右侧痕迹栏与左侧目录条件互斥**：① 沟槽态 16px 常驻，不参与互斥（与目录同开无宽度压力）；② 面板态 256px 与目录互斥仅在 **viewer 容器剩余阅读宽度 <900px** 时生效（按容器实际宽度动态判定，不用屏宽 media query——容器宽度才是阅读面真实约束；`PdfSourceViewer.tsx:372-471` 左侧目录 256px；≥900px 允许同开）；③ 面板态被目录自动收起时，目录面板顶部显示一行轻提示「批注栏已收起」（消除「批注丢了」误判）。痕迹栏定宽 256px 与目录对称。成本 <0.5 人日。

### 3.4 状态机（四个）

- **A 工具条**：`hidden →(mouseup+非空选区) arming →(150ms) visible →(动作|Esc|空白点击|新选区) hidden`；arming 期间选区变化回 hidden；`hidden →(滚动停止 150ms 防抖+选区存续) visible`（重现路径，§3.1）。
- **B 标注卡**：`dormant →(hover 150ms) preview →(click) pinned →(改动) dirty → save/saved(回 preview)`；pinned + Esc 无改动直接收起，有改动先保存。
- **C 锚点**：`resolved（精确命中）→ drifting（前后文模糊命中，黄色角标提示「已漂移」）→ orphaned（失锚：正文隐藏、仅列表灰显 + 「已失锚」角标，不静默删数据）`。**【已裁决修订·PDR-003 裁决 16】「重新框选」操作随 P1 矩形框选同 PR 交付**（边际成本 ≈0，作用于该期全部 orphaned 场景；P2 总览 orphaned 灰显条目挂同一操作入口）；**MVP 期轻量口径**：渲染时 page > 文档总页数（O(1) 判定：读文档 pageCount 对比平铺 page 字段，无需 quote 失配检测）即显示「源文件已变更，重新框选将于下期可用」——不引入 P1 的完整替换检测，但让 MVP 期最易检测的 orphaned 情形（换文件后页数缩水）有诚实提示。**PDF 锚进入这些态的时机（评审补）：源文件被替换/重上传——检测 page 超界或页内 quote 失配即整体标 orphaned 并提示「源文件已变更，标注需重新框选或重传原文件」；v1 不做自动重扫（quote 失配检测随 P1 替换检测交付）。**
- **D 呈现位置**：`NULL|hover|inline|margin|overview` 即时切换，只改渲染槽位不重建标注（可用性随视图，§3.3）。

### 3.5 边界情况处理表

| 场景 | 处理 |
|---|---|
| 划线跨页（PDF） | **v1 不支持，toast 明示「跨页内容请分段标注」，不静默截断**（单页翻页架构 `PdfSourceViewer.tsx:82` 天然不可跨页选；跨页划线列 P3） |
| 跨章节 | 允许；锚点存起止位置，总览按起点章节归类（PDF 章节用 `pdf-utils.ts:98` sectionEndPage 判定） |
| 重叠划线 | 允许创建；渲染叠加（背景 multiply）；hover 命中最上层并显示重叠计数，pin 后列出全部重叠项分别操作 |
| 内容更新后锚点漂移 | 文本锚三级重锚（§5.3）；失败入 orphaned 态，数据保留；PDF 锚漂移仅因文件替换（§3.4-C） |
| 快速连续标注 | 乐观本地落标、请求队列化串行提交；工具条创建后立即消失不阻塞下一次划选；失败 toast + 重试 |
| 扫描页 / 无文本层 PDF | 页级路由（PDR-003 裁决 1）：MVP 该页 inline 常驻提示（§3.1）；P1 起降级为「矩形框选批注」（矩形锚），工具条只出 [批注] |
| 选区含公式（KaTeX） | 文本索引必须排除 `.katex-mathml` 子树（KaTeX 输出双份文本已实测，`node_modules/katex/dist/katex.mjs:6201`），否则偏移必错 |
| 选区全为代码块/表格 | 允许；锚点记节点路径（markdown 结构锚） |
| **超长选区**【评审补】 | 选区 >5000 字符禁止落标，toast「选区过长，请分段标注」（quote 是重锚依据不可截断，上限即选区上限）；body ≤4000 字符（前端 maxlength + 后端校验） |
| 611 页大文档 | 按页懒加载（仅拉当前页 ± 缓冲页）；标注索引 memo 化（full_text 百万字符级，避免每 render 重扫 textContent） |
| **并发编辑**【评审补】 | v1 last-write-wins，无版本字段；PUT 时后端刷新 updated（`base.py:164` 显式写）；多 tab 同时编辑同一标注的极端场景接受后写覆盖，乐观锁列 P3 按需 |

### 3.6 键盘与效率

- 选区态：`H` 划线、`C` 批注、`1-5` 切色、`W/S` 波浪/直线、`Esc` 取消（P1 起，MVP 仅 Esc）。
- 全局（源详情页内）：`Alt+A` 痕迹显隐、`Alt+O` 总览（P2）。
- 批量管理（P2 总览内）：多选 + 批量改色/改位置/删除（AlertDialog 确认）；**批量操作 = 前端循环单条 PUT/DELETE，不建批量端点**（N<100 量级可接受；批量删除不提供 toast 撤销）；`/` 聚焦搜索，**检索字段 = quote + body**（前端已取回列表上过滤）。
- 自研 keydown 监听限定作用域在源详情容器内，输入框聚焦时让路。

### 3.7 无障碍规格【新增，回应评审 missing；键盘路径列入 P1 验收】

- **键盘路径**：划线元素 `tabindex=0`、`role="button"`、`aria-label="{色语义名}划线：{quote 前 40 字}"`；Tab 依文档序聚焦划线，Enter/Space 开 pin 编辑卡，Esc 逐层退出（先卡后焦点回划线）；工具条按钮自然焦点序。
- **色盲冗余编码**：颜色语义不得是唯一通道——过滤 chip、痕迹栏面板态行、总览条目在色方块旁显示语义文字标签（默认命名首字或用户命名的截断，如「重」「掌」「疑」）；成本极低且顺带解决「忘了自己命过什么语义」。沟槽态刻度过细不承文字，以 tooltip 补偿。
- **hover 卡**：内容不进 aria-live（避免朗读风暴），pin 态卡 `role="dialog"` + `aria-modal=false`；扫描页提示条 `role="status"`。

---

## 4. UI 视觉规范（Quiet Green 体系）

### 4.1 三条硬法则的落地（`frontend/src/app/globals.css:8-19`）

- 「色不洗阅读面」→ 个人标注是用户墨迹而非系统染色，是 `--excerpt-wash`（globals.css:206）之后的第二处获准洗底：**仅 18-22% 低透明洗底 + 1.5px 线**，永不整块实色。
- 「popover 独享真影」→ hover 批注卡用 `--shadow-pop`（globals.css:213），其余标注元素 hairline 无影。
- 「方角 4-6px / mono 只用于数据」→ 标注几何 `rounded-sm`(4px)；时间戳/页码 `font-mono`。

### 4.2 色板：5 色默认 + 1 色保留，零新增 hue

**【裁决】默认盘 = gold / fern / plum / slate / clay，第 6 保留 mauve；teal 不进默认盘。** 理由：划线是个人墨迹层，teal 在本产品是 AI 嗓音（globals.css:232-233），让用户墨迹占用它会模糊「我的标注 vs AI 的话」的界线；「疑问」语义由 plum 承担；clay 进盘保留软考刚需「易错」语义，与系统 warn 的弱共享靠形状区分（圆点=系统状态，线/方块=个人墨迹）。

| 语义（默认命名，可改名） | token（只写 :root） | 浅色 | 深色 | 用途建议（软考语境） |
|---|---|---|---|---|
| 重点/必背（默认色） | --anno-gold: var(--gold) | #a97b12 | #cfa13e | 考点、公式、必背结论 |
| 已掌握 | --anno-fern: var(--fern) | #2e6b4f | #55b285 | 已理解/验证过的推导 |
| 疑问/待问 | --anno-plum: var(--plum) | #5d4991 | #a290d3 | 存疑、准备深挖的点 |
| 参考/关联 | --anno-slate: var(--slate) | #4e6b84 | #8fafc8 | 引用其他材料/交叉考点 |
| 易错/纠错 | --anno-clay: var(--clay) | #b0451f | #f08a5c | 做错的真题、陷阱选项 |
| 保留第 6 色 | --anno-mauve: var(--mauve) | #8d5b80 | **#c892ba**（globals.css:317，评审补正） | 不进默认盘；留给用户自定义语义 |

全部别名到现有 owned hues（globals.css:139-172 定义、:301-328 暗色覆盖），遵守「别名只定义一次，暗色自动重解析」（globals.css:16-18），classic 皮肤（:372-517）自动适配。红线色禁用。**【裁决】颜色即状态**：不设独立 status 字段，「未掌握→已掌握」流转 = 把 gold 划线改成 fern（pin 态一键改色），总览按色过滤即按状态过滤。**【裁决·评审修正】色语义命名存服务端**：新单例表 `annotation_settings`（固定 id `open_notebook:annotation_settings`，SCHEMALESS，存 `{color_names: {gold: "重点", …}}`，CONFIG_TABLES 同构模式 data_transfer_commands.py:104-106），GET/PUT 小端点 MVP 交付（<0.5 人日）；localStorage 仅作缓存——清浏览器/换设备不丢命名，与「痕迹是资产」一致。**【已裁决修订·PDR-003 裁决 18】「可改名」的编辑 UI 落 P1**：「显示我的痕迹」开关所在工具栏区增设设置 popover（五色名编辑表单，读写 annotation_settings 端点，+0.25 人日）；MVP 期无 UI 入口为已接受状态——默认命名（重点/已掌握/疑问/参考/易错）MVP 期即可用，不阻塞验收。

**PDF 白纸适配（关键实测结论，需 spike 复测确认）**：亮色 hue 落白 PDF 页 3.8-6.3:1（非文本图形 ≥3:1 达标）；暗色 hue（如 #cfa13e）落白页仅 2.38:1——而 PdfSourceViewer 的 canvas 暗色下仍是白纸（无反色滤镜）。**PDF 覆盖层专用一组不进 .dark 的固定 token**：`--anno-gold-ink:#a97b12` 等（=亮色值），洗底 `--anno-gold-paper: rgba(169,123,18,0.22)`；解析文本视图才用主题跟随别名。**此项对比度数值出自 UI 视觉师会话的 node 脚本（本会话未复跑），纳入 MVP spike 验收清单复测（§5.6）。**

**荧光洗底**：`--anno-*-wash: color-mix(in srgb, var(--anno-*) 20%, transparent)`（clay 18%）；手法沿用 `frontend/src/components/usage/UsageHeatmap.tsx:21-24` 先例。

### 4.3 线型参数

**解析文本视图（CSS）**：`text-decoration: underline wavy var(--anno-*); text-decoration-thickness: 2px; text-underline-offset: 3px`；直线去掉 wavy。浏览器波长不受控（Chrome 2px 厚约 λ≈8、A≈2），是近似值。

**PDF 视图（SVG overlay）**：波浪 `M x0 y0 q 2 -3.5 4 0 t 4 0 t 4 0…`（λ=8、A=1.75，user-space 单位 @scale=1），基线 = 文字基线 +3.5~4px，linecap/linejoin round。**【裁决】线宽 `vector-effect="non-scaling-stroke"` 恒定 1.5 CSS px，波长振幅随缩放**——2.5x 下 3.75px 粗线会破坏「1.5px 线」硬法则。**【已裁决修订·PDR-003 裁决 11】备选「缩放时重生成 path」触发判据定死**：MVP 验收③缩放往返（0.6↔2.5 ×5 次）中，2.5x 档下 non-scaling-stroke 出现可感知锯齿或断续（与 1x 档截图对比）即启用，吸收进既有「划线渲染+缩放换算 2 人日」不加预算；判据不触发则备选代码不写。

**选中态**：ink 加深 + 洗底升 30% + 1px 同色 ring。扫描页框选：1.5px ink 虚线框 + 同色 12% 填充。

### 4.4 hover 批注卡规格

容器 `z-50 w-80 rounded-md border bg-popover p-3 shadow-pop`（**结构参照 `frontend/src/components/ui/popover.tsx:33` 的 z-50 / rounded-md / border / shadow-pop；宽度与内距按本规格 w-80 / p-3 执行——该基建现值为 w-72 / p-4，非同款，不得照抄**）、portal 渲染逃逸滚动容器；左脊线 3px 全高标注色；引文块 bg `--excerpt-wash` + rounded-sm + text-xs + line-clamp-2；正文 text-[13px]；元信息 `font-mono text-[11px] text-ink-faint`（页码+时间）；动效 150ms 淡入 + 上移 2px（--motion-base，globals.css:259）；开 150ms / 容留 300ms（原「关 200ms 容留」表述已按 PDR-003 裁决 10 废止，全文统一 300ms）。

### 4.5 右侧痕迹栏（双态，仅 PDF 视图）

- **沟槽态 16px**：每条标注一枚刻度 `3×min 10px rounded-sm`，y ∝ 文档位置归一化（长页按页内偏移归一化）；hover 弹倒色 tooltip 给摘录+页码，click 跳转；**【已裁决修订·PDR-003 裁决 12】密度 >40 条时按页聚合**：刻度位纵向对应页区间，同页多条合并为色块 + mono 计数角标，颜色取该页占比最高语义色；P1 真题册 dogfood 若不可读，降级出口 = 沟槽退纯密度指示（不承载 hover 摘录与点击跳转，跳转一律走面板态），不引入第三形态。沟槽态常驻、不参与与目录的互斥（§3.3）。
- **面板态 256px**：行高 36px，`8px rounded-sm 色方块 + 语义文字标签（§3.7 冗余编码）+ text-xs truncate 引文`，行 hover:bg-accent/50（同 `PdfSourceViewer.tsx:411`）；副行 `font-mono text-[10px] text-ink-faint`「P.123 · 10-02 14:30」；按页 sticky 分组头（同 :378-380）；顶部 5 枚色方块过滤 chip + 语义标签 + mono 计数。

### 4.6 视觉层级（viewer 内）

canvas z-0 → 标注 SVG overlay z-[2] → 悬浮目录 z-10（:374）→ 分析面板 border-l w-80（:504）→ hover 卡 z-50(portal)。

---

## 5. 数据模型与技术方案

### 5.1 表结构（迁移 33）

**【裁决】单表 `source_annotation`、SCHEMAFULL、单一标注实体**（无 kind、无 parent——§2.2 合并裁决的落地）。模式照抄 migrations/29 风格。真实迁移目录为 `open_notebook/database/migrations/`（本会话核实：当前到 32.surrealql）。

```sql
DEFINE TABLE IF NOT EXISTS source_annotation SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS source ON TABLE source_annotation TYPE record<source>;
DEFINE FIELD IF NOT EXISTS color ON TABLE source_annotation TYPE string;                  -- gold|fern|plum|slate|clay (语义 token 名)
DEFINE FIELD IF NOT EXISTS line_style ON TABLE source_annotation TYPE string;             -- wavy | straight
DEFINE FIELD IF NOT EXISTS body ON TABLE source_annotation TYPE option<string>;           -- 批注文字（可选）
DEFINE FIELD IF NOT EXISTS display_position ON TABLE source_annotation TYPE option<string>; -- NULL(未指定) | hover | inline | margin | overview（非 NULL 时需 body）
DEFINE FIELD IF NOT EXISTS quote ON TABLE source_annotation TYPE option<string>;          -- 冗余：总览/导出/转存笔记/重锚校验
DEFINE FIELD IF NOT EXISTS text_anchor ON TABLE source_annotation FLEXIBLE TYPE option<object>; -- {quote,prefix,suffix,start_offset,end_offset,section_title}
DEFINE FIELD IF NOT EXISTS pdf_anchor ON TABLE source_annotation FLEXIBLE TYPE option<object>;  -- {page,quads:[{x1,y1,x2,y2}]} PDF user space（item index 不持久化，见 §5.3）
DEFINE FIELD IF NOT EXISTS page ON TABLE source_annotation TYPE option<int>;             -- 平铺：PDF 视图过滤/排序/懒加载
DEFINE FIELD IF NOT EXISTS start_offset ON TABLE source_annotation TYPE option<int>;     -- 平铺：文本视图排序
DEFINE FIELD IF NOT EXISTS created ON TABLE source_annotation DEFAULT time::now() VALUE $before OR time::now();
DEFINE FIELD IF NOT EXISTS updated ON TABLE source_annotation DEFAULT time::now() VALUE time::now();
DEFINE INDEX IF NOT EXISTS idx_sa_source ON TABLE source_annotation FIELDS source;
DEFINE INDEX IF NOT EXISTS idx_sa_source_page ON TABLE source_annotation FIELDS source, page;
DEFINE EVENT IF NOT EXISTS source_annotation_cleanup ON TABLE source WHEN ($after == NONE) THEN { DELETE source_annotation WHERE source == $before.id; };
-- 色语义命名单例表（CONFIG_TABLES 同构）
DEFINE TABLE IF NOT EXISTS annotation_settings SCHEMALESS;
```

**【裁决·评审修正】删除初稿的 notebook 字段与 idx_sa_notebook 索引。** 理由：主入口（源详情页）没有 notebook 上下文——`[id]/page.tsx:48-52` 调 SourceDetailContent 只传 sourceId/showChatButton/onClose（本会话核实）；notebookId 是可选 prop（`SourceDetailContent.tsx:89`），PdfSourceViewer 的存笔记流程在无 notebookId 时直接隐藏（`PdfSourceViewer.tsx:572-575`）。stamping 方案产出的 notebook 几乎全为 NONE，且 notebook 删除后悬挂引用会污染聚合。P3 聚合按 source∈notebook（reference 边，`data_transfer_commands.py:102` EDGE_TABLES）实时求值，一个子查询即可，字段仅是缓存且是坏缓存。API 亦相应去掉 `?notebook_id=` 过滤（P3 加按边过滤端点）。

配套：`33_down.surrealql`（REMOVE EVENT → REMOVE 两张表，顺序同 29_down）；**迁移手动注册进 `open_notebook/database/async_migrate.py` up/down 两个列表**（迁移不自动发现，`docs/7-DEVELOPMENT/change-playbooks.md:116-125`；遵守 ADR-006 一 PR 一迁移）；created/updated 不写 TYPE（ObjectModel 写空格分隔 datetime 字符串，照抄 `1.surrealql:13-14` / `29.surrealql:8-9`）。**导出注册**：DATA_TABLES 加 source_annotation、CONFIG_TABLES 加 annotation_settings、TABLE_FIELDS 建字段清单、**RECORD_FIELDS 加 `"source_annotation": {"source"}`**（合并实体后 record 字段只剩 source 一个，机制与理由见 §1.2）。

**级联策略（裁决）**：source 删除走 DB EVENT（同构 `migrations/1.surrealql:29-32` 的 source_insight 清理，覆盖所有删除路径）+ **删除前自动备份（PDR-003 裁决 8：钩子挂 `Source.delete()` 内、`super().delete()` 之前；无标注跳过；规格见 §1.2）**。无 comment→highlight 级联（合并实体红利）。notebook 删除不再涉及标注（字段已删）。

领域模型：新文件 `open_notebook/domain/source_annotation.py`（按域拆分模式，同 source_grouping.py）；`TextAnchor`/`PdfAnchor`/`PdfQuad` 嵌套 pydantic 模型（Source.asset 先例 `notebook.py:345-347`）；record 字段 field_validator（`source_grouping.py:42-47` 模式）；类方法 `get_for_source(source_id, page=None)`（`notebook.py:374-401` 模式）。校验：至少一种锚（text 或 pdf）；display_position 非 NULL 时需 body；body ≤4000 字符；quote ≤5000 字符。

### 5.2 API（新 `api/routers/source_annotations.py`，`api/main.py:404-442` 注册）

| 端点 | 说明 |
|---|---|
| `GET /api/source-annotations?source_id=…&page=…` | 按 source 列表（page 过滤支撑懒加载）；PDF 视图按 page、文本视图按 start_offset 排序（notes.py 平铺模式 `api/routers/notes.py:17-60`） |
| `POST /api/source-annotations` | 创建；校验 source 存在（`notebook.py:566-570` 模式）与长度上限；MVP 期 display_position 一律写 NULL（PDR-003 裁决 9）——**POST/PUT 携带非 NULL 值时服务端归一化为 NULL 持久化而非报错，归一化先于「非 NULL 需 body」校验**（2026-10-03 独立复核补：MVP 前端无位置选择器不会发该字段，此为公开 API 端点的确定语义；P1 起位置选项交付后归一化撤销、校验生效） |
| `PUT /api/source-annotations/{id}` | 部分更新（可选字段语义同 `notes.py:154-183`；色/线型/body/位置/锚修正；后端刷 updated，last-write-wins） |
| `DELETE /api/source-annotations/{id}` | 删除单条（无子级联） |
| `GET/PUT /api/annotation-settings` | 色语义命名单例读写（MVP，极简；改名编辑 UI P1 交付） |
| P3 增补 | `GET /api/source-annotations?notebook=…`（按 reference 边求值的聚合，响应含 source title 投影：`{id, color, line_style, quote, body, display_position, page, start_offset, created, source:{id,title}}`） |

异常映射沿用 InvalidInputError→400、NotFoundError→404（`notes.py:116-126`）。**【裁决】不走 surreal-commands 异步队列**：标注 CRUD 单行 KB 级写入，无 LLM/嵌入/文件 IO（自动备份除外，它挂在 source 删除路径上属一次性动作）。

### 5.3 锚定方案（本系统信任的根基）

**文本锚（解析视图，P1）**：Hypothes.is 式三段锚——quote + prefix/suffix + 创建时绝对偏移。**三级重锚**（渲染层职责）：offset 精确定位 → 精确 quote 匹配 → prefix/suffix 模糊匹配；全失败入 orphaned。**KaTeX 陷阱（已实测）**：建 textContent 索引必须排除 `.katex-mathml` 子树（KaTeX 双份文本，`node_modules/katex/dist/katex.mjs:6201`）。

**【已裁决修订·PDR-003 裁决 4】解析快照版本化锚不做**：三段锚 + 三级重锚 + orphaned 显式态的最坏结果是「显式失锚但数据保留、可重新框选」，不违反「痕迹是资产」；备考材料重跑解析是低频动作。升级触发条件定死：P2 dogfood（§1.6 清单）或真实用户反馈中出现「单次重跑解析导致 >10% 标注失锚且影响使用」，则版本化锚插队 P3 首位（估算 2 人日不变），届时补 ADR。

**PDF 锚**：`{page, quads}`，一律 **PDF user space**（**【裁决】弃归一化 [0,1] 坐标**：PDF 渲染勘察员 node 实测 `convertToPdfPoint` 往返精确——transform `[scale,0,0,-scale,0,h*scale]` y 翻转；user space 是 pdf.js 原生坐标系；归一化的鲁棒性收益是假想的，字节不变页面尺寸不变，字节变了锚点反正漂移）。**【裁决·评审修正】text item index 仅创建时用于计算 quads 与提取 quote，不持久化**——跨 pdf.js 版本的 item 切分不稳定，重锚依赖 quads + quote 双保险已足够；TextLayer 命中信息不进 schema。

**quote 快照更新规则【评审补；PDR-003 裁决 17 扩展至框选场景】**：重锚成功（drifting→resolved）或用户重新框选时，同步重写 quote 字段；orphaned 态冻结 quote 并在总览加「已失锚」角标——否则陈旧引文会流入总览、导出、转存笔记三处呈现。**框选（矩形）锚的近似 quote（getTextContent 与 quads 求交）求交为空或拼接结果不可打印/乱码字符占比 >30% 时 quote 存 NULL，不硬造引文**；quote 为 NULL 的标注在总览/导出/复习手册统一占位格式「[色方块][语义字] P.123 框选 · body 首行截断」；换范围分支（§5.6）激活时该评估前置进 P1 dogfood 议程（详见 PDR-003 裁决 17）。

**不漂移三保障**：持久化一律 user space + page；渲染时重投影（SVG viewBox 直接采用 user space，仅一次 y 翻转）；canvas 与标注层同 wrapper 消除 `Math.floor` 取整差（`PdfSourceViewer.tsx:222-225`）。**双 viewport 陷阱**：渲染 viewport 混入 dpr（`:220-221`），DOM 层换算须用第二个不含 dpr 的 `getViewport({scale})`——换算集中封装纯函数并单测。**坐标换算实测为 PDF 渲染勘察员会话的 node 脚本（本会话未复跑），纳入 spike 验收复测（§5.6）。**

**跨视图互通（裁决）**：v1 不做自动镜像（full_text 与 PDF 页文本无对齐映射，章节分析是客户端整段文本不落库 `api/source_analysis_service.py:59-67`）。统一呈现：① quote 冗余字段让总览统一为「引文+位置」；② **【已裁决修订·PDR-003 裁决 13】双写（同会话双算两锚一次写入）移出 v1-P2，列 P3 候选池末位**；触发条件 = 用户真实反馈中「跨视图看不到另一视图的标注」成为高频抱怨。若未来实现，前提约束：两锚各自独立状态机，一锚失锚不连带另一锚，orphaned 只按锚维度判定。

### 5.4 前端架构选型

**PDF 标注层 = SVG + DOM 混合**：wrapper(relative) 内 canvas + `<svg absolute inset-0 pointer-events-none>`（波浪/直线/荧光 fill；锚点 g 设 pointer-events:auto）+ DOM 绝对定位层（气泡锚点、图标）。否决第二 canvas 与官方 AnnotationEditorLayer（状态机固定、无波浪线、序列化格式与模型不匹配）。前置重构：`PdfSourceViewer.tsx:492-497` 裸 canvas 改 relative wrapper。**TextLayer**：摘约百行官方 `.textLayer` CSS 入 globals.css（仓库现无）；缩放走 `update({viewport})` 原地重排；容器设 `--total-scale-factor: scale`；锁 pdfjs 版本留升级验证清单。

**解析视图标注层 = SourceDetailContent 外层容器包裹**：`SourceDetailContent.tsx:633` MarkdownRenderer 外包 AnnotatableContent 容器（容器 ref + selection 监听 + 标注 store + Range→span 包裹）。不动 MarkdownRenderer（7 个非测试使用点；components prop 注入拿不到全局偏移）。划线视觉 = 包裹 span 承载交互 + CSS text-decoration 渲染。**降级路线【评审修正；PDR-003 裁决 14 补失败判据】**：0.5 天 Range 包裹 spike，**失败判据（任一失败即降级 Highlight API 纯视觉层 + P1 最简「本源标注列表」承载全部交互）**：① 包裹 span 后重算文本偏移与包裹前一致（含 KaTeX 公式页用例，`.katex-mathml` 排除）；② 不破坏宿主已有交互——以**链接点击**为必测项（prose `<a>` 渲染与外部链接处理；markdown-renderer.tsx:88-103 本会话核实：代码块由 SyntaxHighlighter 渲染、无复制按钮，原判据中「代码块复制」是不存在的交互，删除），其余按届时实际存在的交互补充；③ 单视图 50 条标注包裹+渲染 <100ms。三项均可 vitest 断言。降级时 P1 验收①的「划线渲染」以 Highlight API 视觉断言替代，交互验收走列表路径。

**Tooltip/Popover 基建**：只读轻提示复用 Radix Tooltip（`tooltip.tsx:4,11,25`，参照 `frontend/src/components/sources/MessageActions.tsx:101-138`）；可交互批注卡走 Popover（§3.2）。

### 5.5 并发与更新语义【评审补】

v1 last-write-wins：PUT 后端刷新 updated（`base.py:164` ObjectModel.save 显式写，本会话核实），不做版本字段/乐观锁；多 tab 同编以最后保存者胜，接受；真实冲突频发再上乐观锁（P3 候选）。

### 5.6 TextLayer spike：失败判据、文件性质三分支与降级预案【新增，回应评审 high 项；PDR-003 裁决 1 修订】

**spike 范围（MVP 第 1-2 天，真实 611 页真题册）**：集成 TextLayer 并验证下列技术判据 + 顺带四项：① **12 页均匀抽样 getTextContent 非空占比检测**（文件性质三分支，见下）；② WCAG PDF 白页对比度数值复测（§4.2）；③ 坐标往返换算复测（§5.3）；④ SurrealDB 嵌套字段索引/ORDER BY 能力断言验证（§8#16，结果只影响平铺字段可否简化，不影响交付）。

**技术失败判据（满足任一即判失败，与文件性质无关）**：
1. 文本 div 与 canvas 渲染恒定偏差 >2px，且无法用 wrapper 内相对定位/transform 校正；
2. 跨浏览器（Chromium/Firefox/Webkit）selection 无法从 Range 映射回 pdf.js text item（拿不到 item index/str offset 组合）；
3. 单页 TextLayer 构建 + 首帧 >500ms（低端机阈值，611 页文档当前页级别）。

**文件性质三分支（12 页抽样 getTextContent 非空占比；只决定主路径与沟通口径，不改变页级交互路由——§3.1）**：
- **<20% 文本页（扫描为主，真题册几乎无页可划）**→ 触发换范围：矩形框选 + quads 转正为真题册 MVP 主路径，**TextLayer 整体移 P1 重攻（严格换范围语义，+3-5 人日重排，口径不变）**；
- **20%-80%（混排）**→ 维持划词主路径 + 扫描页提示（文本页正常划词，不被全册性质绑架）；发布说明与 dogfood 记录明示扫描页占比与 P1 框选预期；
- **≥80%** → 正常主路径。

**降级预案（技术判据失败时 MVP 重排，不是 +2 人日而是换范围）**：
- MVP 降级为「**矩形框选划线 + quads 锚 + getTextContent 近似 quote**」——`pdf-utils.ts:120-157` 已有后台文本提取，quads 与 text item bbox 求交可得近似 quote，锚定与持久化 schema 不变（pdf_anchor 本就存 quads）；hover 批注卡、色/线型、懒加载、导出注册全部照常交付；**该分支下的逐任务变更对照（F2-F8/F10 键位、F8 不渲染等）见 [MVP 任务清单](source-annotation-mvp-tasks.md) §6.1 分支对照表；§3.1 扫描页提示条在该分支不渲染**；
- 文字级精确划线与 TextLayer 移至 P1 重攻，MVP 重排期 **+3-5 人日**；
- 若 P1 仍失败，PDF 视图长期停留在框选形态，解析文本视图（DOM 原生选区，无此风险）升为主标注视图——产品承诺相应下调并在发布说明明示。

**补验截止门（PDR-003 裁决 1）**：真实真题册上的 spike 判定与验收①未补跑前，MVP 不得标记完成；文件不可得时技术判据可用任意 ≥100 页文本 PDF 顶替，但截止门不豁免。

---

## 6. 阅读总览设计（P2：「阅读地图」tab）

### 6.1 三视图 + 共享过滤器

tab 内三层：顶部共享过滤器 → 视图切换 → 痕迹详情/跳转。过滤器：类型 chip（划线/带批注/框选）· 颜色 swatch（即状态过滤）+ 语义文字标签 · 遍次下拉 · 关键词搜索（覆盖 quote+body，`/` 聚焦）。

**A. 章节地图（默认）**：左 ~60% 章节列表（复用 PDF outline `PdfOutlineEntry`，`pdf-utils.ts:8-15`；无书签时 `parseTocFromPages` 兜底 `pdf-utils.ts:204`），每行 depth 缩进 + 页码区间 chip（`pdf-utils.ts:98`）+ 分色密度条 + 计数，行可展开；右 ~40% 书脊热力图（每页一格按密度着色，GitHub 贡献图式，复用 `frontend/src/components/usage/UsageHeatmap.tsx:21-24` color-mix 梯度；hover「P113 · 3 划线 1 批注」click 跳页；无目录退化每 25 页分桶）。

**B. 时间线（遍数视图）**：左侧竖轨标「第 N 遍」；**遍次由时间戳启发式前端聚类【已裁决修订·PDR-003 裁决 7：页码回退 >100 页（主信号）OR 距上一条标注 ≥7 天（辅助信号）；原 72h 表述废止——OR 逻辑下 72h 单臂即可分遍，备考一遍中间隔 3 天空档即被误切】**，不建阅读会话表，UI 弱化精确承诺（「约 N 遍」）；「手动开始新一遍」按钮列 P3 候选（触发条件 = dogfood 中遍次误分可感知）。每遍块：日期区间 + 覆盖率条 + 按时排序的痕迹卡。多遍分层：第 N 遍条目左缩进 8+N×12px（同 `PdfSourceViewer.tsx:412` 缩进语言），形成「地层」感。

**C. 全部痕迹（平铺列表）**：**【裁决】手写简易窗口化虚拟化**（固定行高 36px + scroll 数学/IntersectionObserver，数百条量级足够）——**不新增 react-virtual/react-window 依赖**（本会话核实 package.json 无虚拟化依赖；与 §3.2 否决 hover-card 的「少依赖」口径一致），估算已计入 P2。批量多选管理：循环单条请求（§3.6）。

### 6.2 跳转闭环

1. 每条痕迹携带 `{view:'file'|'parsed', locator}`。
2. 点击 → zustand store（仿 `lib/stores/source-view-store` 模式）广播 `{sourceId, locator, nonce}`：切回 content tab 并拨 `fileViewOpen`（`SourceDetailContent.tsx:566`）；PdfSourceViewer 受控 `jumpToPage` prop（翻页机制现成，outline 点击即 setCurrentPage `:418`）。**跳转精度 = 页级 + TextLayer 锚点滚动定位**（TextLayer 已随 MVP 交付；若 MVP 走换范围分支则页级跳转 + 框选区域高亮）；到达后 1.5s 高亮脉冲；解析视图 scrollIntoView + 高亮环。
3. 跳转后「返回阅读地图」浮标一跳回程；tab 栏 sticky（`:550`）常在。
4. 深链 `?tab=reading-map&focus=<id>`（前置：`[id]/page.tsx` 加 tab 参数 + Tabs 受控化）。

### 6.3 导出与导入

**分两档交付【裁决·评审修正，资产兑现前移】**：

- **P1 尾·最简导出**：纯前端 Blob 下载——① Markdown（全部标注按页/章节组织：引文 + body + 页码；quote 为 NULL 的条目按 §5.3 占位格式）；② JSON（源数据原样：source_annotation 字段 + annotation_settings 命名）。依赖已取回列表数据，0.5 人日。
- **P2·完整导出**：导出对话框（scope：全部/当前过滤/某章/某遍）三形态——① Markdown 复习手册（默认，章末自动汇总该章重点/疑问清单）；② **Anki CSV【规格裁决】**：正面 = 引文（可配章节标题前缀），背面 = body（批注+备注合并后即 body），**无 body 的纯划线默认不进 CSV**（导出对话框可勾选包含）；列结构 `Front,Back,Tags`（Tags = source 标题 + 章节），RFC 4180 双引号转义；③ 存为笔记：复用 SaveNoteDialog（`PdfSourceViewer.tsx:597-604`），手册落为 Note（自动 embed）→ 可被 AI 洞察/chat 引用——「痕迹 → 复习材料 → AI 上下文」的用户主动一次性通道。

**导入【评审 missing 补齐；PDR-003 裁决 8 补一致性预检；比对基准口径 2026-10-03 定死】**：P2 尾交付 **JSON 导入（限本系统导出的 JSON 与源删除备份，用于恢复）**——校验 source 存在、锚字段结构、长度上限，复用 data_transfer 的导入基建语义；**一致性预检，主判据 = quote 抽检（抽 3 条在目标源文本检索，命中 ≥2 判同源），page_count 仅作辅助粗筛臂**——比对基准两侧口径：备份侧 page_count = max(page)+1（§1.2，非文档真实页数）；目标侧后端同样无页数字段（`page_count` 全仓 Python 零命中，pageCount 仅前端渲染 PDF 时可知），故目标侧仅当导入发起时前端已加载目标 PDF 才参与比对；触发路径（title 匹配命中多个 / page_count 粗筛不符）一律进入 quote 抽检，并在导入前展示预览（「将恢复 N 条到《title》」+ 一致性结论通过/警告），防同名不同版整体 orphaned。**从第三方工具（微信读书/Weava/Zotero）迁移不做**：各家导出格式不稳定且无真实需求证据；「不私有锁定」以「格式开放（MD/JSON）+ API 可编程」兑现，第三方转换器留给社区。跨源聚合导出走 P3 服务端端点。

**【裁决】带高亮 PDF 注入导出（引 pdf-lib）明确不做。**

### 6.4 窄屏与降级【评审补】

总览 tab 响应式：<1024px 隐藏视图切换器、默认 C 列表视图（A/B 降级为不可达）；书脊热力图 <768px 隐藏（信息密度不可承载）。源详情标注层（浮条/痕迹栏）在 <768px 仅保证不破版（浮条翻转逻辑已有），触屏手势整体后置 P3。

---

## 7. 分期路线

> 各期 i18n 预算已按评审上调为 1-1.5 人日/期：三重门禁 = parity 测试（`index.test.ts:55-66`，本会话核实 missing/extra 断言在 :60-64）+ 非 en-US locale 须 `satisfies TranslationShape`（frontend/AGENTS.md:14，缺键挂 tsc）+ unused key 检测（`index.test.ts:123-160`）；另有按批次固化新键清单的惯例（`new-keys.test.ts` 存在，本会话核实）。**键名一次定稿、同 PR 落全部 14 locale、砍功能同步删键**，否则 unused key 测试会红。
>
> **【已裁决修订·PDR-003 裁决 3】估算标称按分项加总对齐**：MVP 前端 10-11 + 后端 3-4.5；P1 前端 8.5-10 + 后端 1；P2 前端 7.25-9.25 + 后端 1.5-2（后端三期维持原标称，复核确认与分项一致）。超支 >20% 的基线以新标称中值计。**全程减压顺序（任一期超支 >20% 时）**：先顺延工期 → 再压缩非数据完整性类测试深度；数据完整性/资产保留类测试（export→import round-trip、备份结构校验、坐标换算纯函数边界、last-write-wins 语义）任何情况下不压缩；各期验收条目对应测试一律不动。**P1 例外**：P1 超支先适用 P1 段的特例砍序（快捷键顺延 P2），仍不足再适用本条全程规则。TextLayer spike 失败换范围重排 +3-5 人口径不变。

### MVP（第 1 期）：PDF 源文件视图划线 + 批注闭环

**用户价值**：在 PDF 原文划线（波浪/直线 × 5 色）、写批注、hover 看批注，刷新不丢；误删源有备份兜底。

**【裁决】MVP 先 PDF 视图而非解析文本视图**：① 备考主战场是 PDF 原样视图，错题回溯的坐标系是页码；② PDF 锚字节级稳定，「刷新不丢」承诺最硬；③ 解析视图注入是「P1 最大不确定项」需 spike。

**范围**：TextLayer spike（技术判据 + 12 页抽样三分支 + WCAG 对比度/坐标往返复测 + SurrealDB 断言验证，§5.6）；source_annotation + annotation_settings 表、域模型、CRUD+settings 路由；锚点 user space + quote 冗余；选区浮条（5 色点 + 2 线型 + [批注] + [复制]）；SVG 划线 overlay；hover 批注卡（Popover）；按页懒加载；**DATA_TABLES/TABLE_FIELDS/RECORD_FIELDS/CONFIG_TABLES 四处注册**；**源删除确认计数 + 自动备份 JSON（钩子挂 Source.delete()，无标注跳过）**；扫描页 inline 提示（页级路由）；page 超界轻量提示（PDR-003 裁决 16）；色语义命名的 settings 读写（无改名 UI，PDR-003 裁决 18）。**任务拆解见 [MVP 任务清单](source-annotation-mvp-tasks.md)（F1-F11 前端 / B1-B6 后端）。**

**验收（可测）**：
① **【已裁决修订·PDR-003 裁决 1】真题册文本页划词持久化（翻页/刷新仍在）；若走换范围分支则按框选主路径验收**；
② hover 划线显示批注；
③ 缩放 0.6↔2.5 往返 5 次零漂移（vitest mock viewport 换算纯函数；同场景 2.5x 档截图对比为 §4.3 重生成 path 备选的触发判据）；
④ `uv run pytest tests/test_source_annotations_api.py` 与 `npm run test` 全绿；
⑤ **export→import round-trip pytest：导出含 source_annotation，导入后 source 字段为 record 链接类型而非字符串**；
⑥ **【已裁决修订·PDR-003 裁决 8】删除源后 EXPORTS_FOLDER 出现备份 JSON（`annotations-backup_{sourceId}_{YYYYMMDD-HHmmss}.json`），pytest 校验结构完整（含 source 元数据快照 + 全量标注 + 条数一致；零标注源不产生备份文件）；恢复导入闭环随 P2 导入器交付（含一致性预检，§6.3）**。

**补验截止门**（PDR-003 裁决 1）：①与 spike 判定须在真实真题册上补跑，未补跑前 MVP 不得标记完成。

**估算（标称已按 PDR-003 裁决 3 对齐分项加总）**：前端 10-11 人日（TextLayer spike+集成 2、选区→锚点 2、划线渲染+缩放换算 2、浮条/卡片 1.5、settings+删除防护+扫描提示 0.5-1、i18n 1-1.5、测试 1；spike 失败走 §5.6 预案重排 +3-5）；后端 3-4.5 人日（模型+两迁移 1、路由+settings 1、备份导出 0.5-1、pytest 含 round-trip 0.5-1.5）。

### P1（第 2 期）：解析视图 + 呈现位置 + 痕迹栏 + 最简读回

**用户价值**：两种视图都能标注；批注可选呈现位置；PDF 侧痕迹栏；**看得回自己的痕迹（列表+导出）**——北极星在前两期即部分兑现（评审修正）。

**范围**：AnnotatableContent 容器（0.5 天 spike：Range 包裹，三判据见 §5.4，失败降级 Highlight API + 最简列表承载交互）；文本三段锚 + 三级重锚 + orphan 灰显 + 源文件替换检测；display_position 三态语义落地（NULL/显式四档，P1 起创建按视图写默认档，§3.3）；扫描页矩形框选 + orphaned 重新框选操作（PDR-003 裁决 16）；右侧痕迹栏（PDF，与目录条件互斥 + 沟槽豁免 + 收起提示，PDR-003 裁决 2；沟槽聚合规则 §4.5）；**最简「本源标注列表」（按色过滤 + 跳原文 + 键盘可达）**；**MD/JSON 最简导出（Blob）**；「显示我的痕迹」开关 + 色语义改名设置 popover（PDR-003 裁决 18）；快捷键 H/C/1-5/W-S；无障碍键盘路径；hover 延时调参空间（§3.2，两轮不达再开 ADR 议依赖）。

**验收**：① 解析视图选中划线，含 KaTeX 公式页偏移正确（.katex-mathml 排除用例）；② 批注切换 inline（文本视图）/margin（PDF 视图）持久化（overview 档不在 P1 选择器出现）；③ 痕迹栏与最简列表点击跳转对应标注；④ 重跑解析后旧标注走 drifting/orphaned 显式状态，quote 按规则冻结或重写（§5.3）；⑤ **键盘路径：Tab 聚焦划线 → Enter 开 pin 卡 → 改色保存 → Esc 退出，全程无鼠标**；⑥ 最简列表按色过滤后导出 MD，内容与过滤态一致；⑦ 两套 vitest 集成测试绿。

**【已裁决修订·PDR-003 裁决 5】P1 特例砍序（优先于全程减压规则适用）**：P1 超支时砍序 = ① 快捷键 H/C/1-5/W-S 砍掉顺延 P2（0.5 人日）→ ② 仍不足适用全程规则（先顺延工期 → 再压非数据完整性测试）。**无障碍键盘路径（验收⑤）与最简列表/导出任何情况下不可砍。**

**估算（标称已按 PDR-003 裁决 3 对齐分项加总）**：前端 8.5-10 人日（markdown 划线注入 2-3 不确定项、最简列表 1、最简导出 0.5、痕迹栏 1、位置选项+开关+色语义改名 popover 1（R18 的 +0.25 并入本项）、无障碍 0.5、快捷键 0.5、i18n 1-1.5、测试 1）；后端 1 人日（校验补强）。

### P2（第 3 期）：阅读地图总览 + 完整导出 + 角标

**用户价值**：最外层一眼看到全书标注分布与阅读历程；痕迹完整导出与回链。

**范围**：「阅读地图」第 4 tab（三视图 + 共享过滤器 + 手写虚拟化 + overview 档解锁）；跳转闭环（store + jumpToPage + 深链 + 返回浮标）；完整导出（scope/复习手册/Anki CSV/存为笔记）+ JSON 导入（含一致性预检）；源列表角标（annotations_count 子查询）；窄屏降级。

**验收**：① 总览按色/类型/遍次过滤，热力图与列表联动；② 点击痕迹跳到对应视图对应位置并可一跳返回；③ MD 手册章末汇总正确；④ Anki CSV 列结构与转义符合 §6.3 规格，无 body 划线默认不进；⑤ 存为笔记后 note 出现在 notes 列表且可被 chat 引用；⑥ JSON 导入恢复标注（一致性预检通过/警告路径各有用例）；⑦ 源列表角标计数与实际一致；⑧ <1024px 视图降级生效；⑨ dogfood 清单两项（§1.6）人工执行通过。

**估算（标称已按 PDR-003 裁决 3 对齐分项加总；评审逐项重拆）**：前端 7.25-9.25 人日（三视图含虚拟化 2.5-3、过滤器 0.5、跳转闭环 1、完整导出+导入 1.5-2、角标 0.5-1、窄屏 0.25、i18n 1-1.5）；后端 1.5-2 人日（聚合端点 + annotations_count + JSON 导入校验）。复用项：列表数据已取回、Blob 下载无后端、热力图复用 UsageHeatmap 梯度、行渲染复用 P1 最简列表。

### P3（第 4 期）：AI 增值与增强（按条排期，每条 1-3 人日）

标注进 artifact 生成（§9）→ 划线段显式 AI 分析 → 跨源复习册 → 笔记本级聚合页（按 reference 边）→ 理解演变并排对比 → 全册汇总长任务 → 跨页划线 → 触屏 → 标注互链 → 第 6 自定义色 → 乐观锁并发。**候选池（触发条件见各裁决）**：解析快照版本化锚（PDR-003 裁决 4，插队首位条件）、跨视图双写锚（PDR-003 裁决 13，候选池末位）、「手动开始新一遍」按钮（PDR-003 裁决 7）、标注备份轮转（PDR-003 裁决 6）、hover-card 依赖引入（PDR-003 裁决 10，须先开 ADR）、框选区域 canvas 裁剪快照替身（PDR-003 裁决 17，若采纳落 P2/P3）。

**坚决后置/不做**：连续滚动重构 viewer、协同分享、带高亮 PDF 注入导出、SRS 调度、标注自动进 chat 默认上下文、软删除回收站、第三方格式导入。

---

## 8. 风险清单（概率 × 影响）

| # | 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|---|
| 1 | pdfjs v6 TextLayer 集成差异 | 中 | 高 | **MVP 首日 spike + 明确失败判据 + 降级预案（§5.6：框选+quads 换范围，重排 +3-5 人日）**；锁版本；升级验证清单 |
| 2 | PDF 缩放/翻页漂移 | 低 | 高 | user space 持久化 + 渲染重投影；换算纯函数单测（含 dpr 与 7 档缩放）；canvas/标注层同 wrapper；spike 复测坐标往返 |
| 3 | 锚点漂移（重跑解析改 full_text） | 中 | 高 | 三级重锚 + orphan 显式态 + quote 冻结/重写规则；MVP 只承诺 PDF 视图；版本化锚升级触发条件已定（PDR-003 裁决 4） |
| 4 | KaTeX 双份文本污染索引 | 低 | 高 | 排除 .katex-mathml；vitest 公式页用例 |
| 5 | markdown 划线注入失败 | 中 | 高 | 0.5 天 spike 前置 + 三判据（PDR-003 裁决 14）；降级 Highlight API 纯视觉 + **P1 最简列表承载交互（已排期）**；降级时验收①以视觉断言替代 |
| 6 | 611 页性能 | 中 | 中 | 按页懒加载 + page 索引；标注索引 memo；总览手写虚拟化；TextLayer 只构当前页 |
| 7 | i18n ×14（三重门禁 + new-keys 清单） | 高 | 中 | 每期 1-1.5 人日；键名一次定稿；砍功能同步删键 |
| 8 | 扫描版 PDF 无文本层 | 中 | 中 | **页级路由（PDR-003 裁决 1）**：有文本层页正常划词、扫描页 inline 提示；12 页均匀抽样 <20% 文本页触发换范围（框选转正主路径，TextLayer 整体移 P1）；**补验截止门：真实真题册 spike 与验收①未补跑前 MVP 不得标记完成** |
| 9 | 与 notes 概念混淆 | 中 | 中 | 独立表 + 单一「批注」概念（合并后用户面无 comment/remark 之分）+ 文案区分「笔记/标注」 |
| 10 | 双 viewport 换算错位 | 中 | 中 | 换算集中封装纯函数单测（现 `PdfSourceViewer.tsx:221` 混入 dpr） |
| 11 | 嵌套滚动容器浮条偏移 | 低 | 中 | fixed + rect 视口坐标 + 滚动消失 + **150ms 防抖重现** |
| 12 | 导出注册遗漏（含 RECORD_FIELDS） | 高 | 高 | 四处注册同 PR；MVP 验收⑤ round-trip pytest 把关 |
| 13 | 遍次聚类误判 | 中 | 低 | 双信号（页码回退 >100 页 OR ≥7 天，PDR-003 裁决 7）；UI 弱化承诺；手动开关列 P3 候选（触发条件 = dogfood 中误分可感知） |
| 14 | 痕迹栏与目录同开宽度不足 | 中 | 低 | **条件互斥（容器剩余阅读宽度 <900px 才互斥）+ 沟槽豁免 + 收起提示（PDR-003 裁决 2）**；真实屏幕验证 |
| 15 | **源删除→资产毁灭（误删）【评审新增】** | 中 | 高 | 确认对话框显示标注计数二次确认 + Source.delete() 钩子自动备份 JSON 到 EXPORTS_FOLDER（永久保留，无标注跳过，PDR-003 裁决 6/8）；MVP 验收⑥ |
| 16 | **SurrealDB 嵌套字段索引/ORDER BY 能力断言未验证【评审降级】** | 低 | 中 | 标为待验证；平铺决策另由 `base.py:40-70` order_by 白名单支撑，不依赖该断言；MVP spike 顺带验证（F1 第 4 项） |
| 17 | **换范围分支下 quote 几乎必然 NULL（框选近似 quote 命中率未知）【PDR-003 裁决 17 新增】** | 高（仅换范围分支） | 中 | 求交为空或乱码占比 >30% 时 quote 存 NULL 不硬造；占位格式「[色方块][语义字] P.123 框选 · body 首行截断」；分支激活时 P1 dogfood 直接列入替身评估（canvas 快照优先，OCR 走 VISION.md 的 PDR 流程）；发布说明明示「框选标注读回以页码+批注为主，引文暂缺」；>40% 触发条件保留给非换范围情形 |

---

## 9. AI 增值（克制版）

### 9.1 唯一正确挂接点（含实现缝，评审修正）

**【裁决】标注进入 AI 的唯一 P3 路径 = 扩展 `generate_artifact` 的 context_config**（`commands/artifact_commands.py:41-47` 协议 `{}"sources": {id: status}, "notes": {id: status}}` 增可选 `annotations` 键），不新建 command——重试、任务中心、Note 沉淀、自动 embed、导出、用量记录全白拿。

**实现缝（本会话核实，初稿未写明）**：`_render_context_text`（`artifact_commands.py:59-80`）只消费 `build_notebook_context` 的返回，而后者**只迭代 context_config 的 sources/notes 两键**（`context_builder.py:285-326`）——annotations 键会被静默忽略，且 total_content 统计（`:351-359` 一带）不含标注块。**裁决：扩展 `build_notebook_context` 识别 annotations 键**——拉取标注、渲染「引文+批注+页码+遍次」块进 context_data、**计入 total_content**（字符上限与截断披露的计数基础才正确）；`_render_context_text` 增对应消费分支。备选（在 generate_artifact 内单独拉取自行计数）不采用——两处拉取逻辑易漂移。

**硬约束**：开关默认关、后端不读默认值；生成前 UI 明示「将使用你的 N 条标注与批注」；**【已裁决修订·PDR-003 裁决 15】** 条数/字符上限与截断规则定死：上限 `ANNOTATION_CONTEXT_MAX_CHARS=60000`（对齐 MAX_SECTION_CHARS=60000 惯例，`api/source_analysis_service.py:25-28`）；**生成前提供 scope 预选**（默认全部——「AI 使用必须明示」的延伸，用户想只送最新理解层就选「第 N 遍」过滤。选项构成【2026-10-03 独立复核修正】：**全部 / 当前色过滤 / 某遍** 三项复用 P2 总览过滤器现成控件（§6.1 四维：类型 chip、颜色 swatch、遍次下拉、关键词搜索）；**「某章」为 P3 新增入口**——§6.1 无章过滤项，落地时经章节地图行选择或补章过滤，非复用现成控件）；scope=全部且超限时按**章等量配额分层抽样**（章内按页码/offset 升序、单条为原子单位不截断、尾部整条丢弃），废除纯位置升序的前部偏置截断；披露文案：「将使用 N 条标注与批注（已按章节覆盖全书 P.1–P.611，因长度上限省略 M 条）/（范围 P.1–P.N）」。原文「按章节优先」表述废止。

### 9.2 能力分期

| 能力 | 分期 | 做法 | 与 insights 的差异 / 克制理由 |
|---|---|---|---|
| 标注进复习提纲/闪卡 | P3 | context_config.annotations 开关 + §9.1 渲染 + scope 预选 + 上限披露 | 管线全复用；标注资产最直接的乘法 |
| 划线段显式「AI 分析」 | P3 | 复用 analyze_source_section/explain（选区即章节退化情形）+ 显式按钮 | **与 insights 不同粒度：片段级、用户锚定、结果可跳回原文**（insights 是章节级、AI 选段）；满足 §9.3 准入判据 |
| 跨源复习册 | P3 | 同 artifact 扩展多源标注 | 需标注量真实积累；token 成本高 |
| 理解演变对比 | P3 非 AI | 同章节多遍标注并排（纯 UI） | 时间轴+并排已满足感知 |
| 全册汇总长任务 | P3 视需要 | 新 command，套流式进度模式（`source_commands.py:303-343`） | 前四项验证价值后才考虑 |

软考「错题本」不新增 artifact 类型：`instruction` 自由文本（`artifact_commands.py:44`）已可表达；加类型 = 新 jinja 模板 + 14 locale + UI 入口，验证需求后再议。

### 9.3 明确不做 + 统一准入判据

**准入判据（满足才可排期）**：① 用户显式触发（无任何自动弹出）；② 结果可跳转回原文锚点（可验证）。不满足任一即不做。

不做清单：① 标注自动进 chat/artifact 默认上下文；② AI「理解演变叙事」；③ 划线时自动弹 AI 解释；④ SRS 调度；⑤ AI 自动打标签；⑥ 总览页 AI 摘要。

**预期管理**：标注不进向量检索（独立表绕过 embed）——「搜到我的评论」用「转存为笔记」弥补，不自动同步。

---

## 10. 批判性自评：本方案交互与 UI 的真实短板

诚实列出，按严重度排序（含评审与裁决后仍未消解的部分）：

1. **两视图线型只能视觉近似**。浏览器 `text-decoration: wavy` 波长不受控 vs SVG 精确路径（λ=8/A=1.75），跨视图切换时划线观感有可感知差异。浏览器能力边界，v1 接受。
2. **跨视图标注互通 v1 缺位**。用户预期「PDF 里划的线解析视图也看得见」，v1 只在总览以引文+页码统一呈现。双写锚列 P3 候选池末位（PDR-003 裁决 13）。预期管理靠文案，体验上确实割裂。
3. **最大技术风险仍未实机验证**。TextLayer 集成只有静态读源码 + 勘察报告会话的 node 坐标实测；「缩放零漂移」「TextLayer 构建性能」是纸面推演。§5.6 已给失败判据、文件性质三分支与换范围预案，但预案本身（框选交互的选区手感）也未原型化——框选的「重锚靠 getTextContent 近似 quote」在扫描混排文档的命中率未知（降级出口已定：quote NULL + 占位格式 + 换范围分支 dogfood 前置评估，PDR-003 裁决 17）。
4. **工具条 8 键对首用用户仍偏多**。合并 [批注] 后从 9 键减到 8 键，核心动作（点色即划线）一步，但 5 色点的语义需要学习；快捷键 P1 才上。重度用户效率 v1 满足七成。
5. **5 色上限偏紧**。Zotero 8 色、Weava 任意色。第 6 保留色 + 可命名缓解，多主题并行研究会碰壁。
6. **无障碍规格仍是最低限度**。键盘路径进了 P1 验收、色盲冗余编码已补，但读屏的完整体验（划线列表的导航语义、pin 卡的表单标签）只有原则没有逐元素规格；触屏完全后置。
7. **总览信息密度偏高**。三视图 + 四维过滤 + 虚拟化列表挤一个 tab；书脊热力图在标注稀疏的前几遍信息量趋零；窄屏只做了「降级为列表」的兜底而非真适配。
8. **遍次聚类是启发式**。密集多日连读仍可能误分遍次，而「第 N 遍」是产品叙事核心——卖一个可能算错的数字，UI 只能弱化承诺（裁决 7 已把误分源头收紧为「页码回退 >100 页 OR ≥7 天断档」，单臂误切已消解）。
9. **痕迹栏沟槽聚合规则已定死但未原型验证**（>40 条按页聚合：色块 + mono 计数 + 占比最高色；降级出口 = 纯密度指示，PDR-003 裁决 12），密集标注页可读性待 P1 真题册 dogfood 验证。
10. **单一「批注」概念的表达力代价**：合并消解了「评论 vs 备注」的选择负担，但也意味着不再有「同一划线下多条独立短评」的形态（原 comment 挂 parent 模型可表达）；若未来出现该需求需重新引入子实体。v1 判断该场景属于评论线程（已砍），风险可控但应知晓。

---

## 11. 已裁决事项（原「开放问题」）

评审修订终稿遗留的 18 项开放问题已于 2026-10 全部裁决完毕（无遗留待定）。逐条结果如下，完整裁决文本（含理由与落选方案）见 [PDR-003](../decisions/PDR-003-source-annotation-system.md)。

| # | 原开放问题（摘要） | 裁决结果（摘要） | 影响期 | 落点 |
|---|---|---|---|---|
| 1 | 611 页真题册是否文本版 PDF（决定主路径） | **页级路由取代全册二元**：交互按页判定；12 页抽样三分支（<20% 换范围 / 20%-80% 混排维持划词 / ≥80% 正常）；换范围分支 TextLayer 整体移 P1；MVP 验收①改写 + 补验截止门 | MVP | §3.1、§5.6、§7 MVP、§8#8 |
| 2 | 痕迹栏与目录同开的宽度取舍 | **条件互斥 + 沟槽豁免**：沟槽态不参与互斥；面板态仅在容器剩余阅读宽度 <900px 时互斥（动态判定）；自动收起时目录顶部显示「批注栏已收起」 | P1 | §3.3、§4.5、§8#14 |
| 3 | 工期与风险预算是否接受（终稿口径） | **标称对账上调**（MVP 前端 10-11、P1 8.5-10、P2 7.25-9.25；后端不变）+ 减压顺序重排（先顺延工期→再压非数据完整性测试，数据完整性测试不可压缩）+ MVP 任务清单补项（F1 四项） | 全程 | §7 头注与各期估算、[任务清单](source-annotation-mvp-tasks.md) |
| 4 | 解析视图 v1 持久性弱于 PDF 是否接受 | **接受，P1 不加版本化锚**；升级触发条件定死（>10% 失锚且影响使用 → 插队 P3 首位，届时补 ADR） | P1 | §5.3、§7 P3 |
| 5 | P1 范围扩容（最简列表 + 最简导出）是否接受 | **接受并锁定**；P1 特例砍序优先于全程规则（先砍快捷键顺延 P2）；键盘路径与最简列表/导出不可砍 | P1 | §7 P1 |
| 6 | 源删除备份留存策略 | **永久保留不自动轮转**；文件名 `annotations-backup_{sourceId}_{时间戳}.json`；JSON 内嵌 source 元数据快照（含 page_count）；>50MB/总量 >1GB 再议轮转 | MVP | §1.2、§8#15 |
| 7 | 遍次聚类 72h 阈值是否贴合；是否要手动按钮 | **页码回退 >100 页（主）OR ≥7 天（辅）**；72h 废止；手动按钮列 P3 候选 | P2 | §6.1-B、§8#13 |
| 8 | 验收⑥与 P2 导入器的恢复闭环双重断裂 | **备份钩子钉死在 Source.delete() 内（super().delete() 之前）**；无标注跳过；MVP 验收⑥改为备份结构校验；P2 导入器补一致性预检（page_count 粗筛臂 + quote 抽检主判据 + 预览，比对基准双侧口径见 §6.3） | MVP/P2 | §1.2、§5.1、§6.3、§7 MVP 验收⑥ |
| 9 | display_position 默认值三处矛盾 + NULL-with-body 语义 | **三态语义**：MVP 创建写 NULL；P1 起按视图写默认档；NULL 无 body=纯划线、NULL 有 body=跟随视图默认档；「默认 hover」表述全文清除 | MVP/P1 | §2.2、§3.3、§5.1 |
| 10 | hover-card「P1 再评估」悬空 + 200ms/300ms 矛盾 | **封死不引入**；调参空间 = 延时两参数 + 锚定微调，两轮不达再开 ADR；§4.4 的 200ms 表述废止，全文统一 300ms | P1 | §3.2、§4.4 |
| 11 | §4.3 缩放重生成 path 无触发判据 | **判据定死**：验收③ 0.6↔2.5×5 次中 2.5x 档可感知锯齿/断续（与 1x 截图对比）即启用，吸收进既有预算 | MVP | §4.3、§7 MVP 验收③ |
| 12 | 沟槽 >40 条聚合规则未定 | **规则定死**：刻度位对应页区间、同页合并色块 + mono 计数、占比最高语义色；降级出口 = 纯密度指示 | P1 | §4.5、§10#9 |
| 13 | 双写锚无排期无判据 | **移出 v1-P2，列 P3 候选池末位**；触发条件 = 跨视图不可见成为高频抱怨；前提 = 两锚独立状态机 | P3 | §5.3、§2.3、§7 P3 |
| 14 | Range 包裹 spike 无失败判据 | **三判据**：偏移一致（含 KaTeX）/ 不破坏宿主交互（链接点击必测，删「代码块复制」伪用例）/ 50 条 <100ms，均可 vitest 断言 | P1 | §5.4、§8#5 |
| 15 | AI 上下文截断策略悬空 | **scope 预选 + 分层抽样**：60000 上限、按章等量配额、单条原子不截断；披露文案定死；「按章节优先」废止 | P3 | §9.1 |
| 16 | orphaned「重新框选」未标分期 | **重新框选随 P1 矩形框选同 PR**；MVP 期 page 超界 O(1) 轻量提示（完整 quote 失配检测仍 P1） | MVP/P1 | §3.4-C、§2.3 |
| 17 | 框选近似 quote 命中率未知无降级出口 | **quote NULL 不硬造 + 占位格式**；换范围分支激活时 P1 dogfood 前置评估替身（canvas 快照优先，OCR 走 PDR）；>40% 触发保留给非换范围情形 | P1 | §5.3、§8#17 |
| 18 | 「可改名」无 UI 入口 | **改名编辑 UI 落 P1**：开关工具栏区设置 popover（+0.25 并入既有项）；MVP 无入口为已接受状态 | P1 | §4.2、§7 P1 |

---

## 12. 评审处理记录

### 12.1 产品评审（17 issues）

| # | 问题 | 处理 | 落点 |
|---|---|---|---|
| P1 (high) | 源删除级联毁灭资产，无用户侧防护 | **采纳（①+②组合，不做③软删除）**：确认对话框显示标注计数 + 删除前自动备份 JSON 到 EXPORTS_FOLDER；软删除不做（2+ 人日且与现有全级联行为不一致）；风险表新增 #15 | §1.2、§5.1、§8#15、MVP 范围与验收⑥ |
| P2 (high) | TextLayer spike 无 Plan B | **采纳**：新增 §5.6 失败判据（偏差>2px 不可校正/selection 无 item 映射/单页构建>500ms）与降级预案（框选+quads+近似 quote，文字级移 P1，重排 +3-5 人日） | §5.6、§7 MVP、§8#1 |
| P3 (medium) | overview 档 P1 无展示面 | **采纳**：gate 到 P2 随阅读地图交付，P1 选择器只出 inline/margin，验收②同步修改 | §2.3、§3.3、§7 P1 验收② |
| P4 (medium) | 文本视图 margin 档未定义 | **采纳（后一分支）**：margin 档 v1 仅 PDF 视图，文本视图选项灰显并注明；默认档按视图区分（PDF=margin，文本=inline）。不补文本视图右侧栏（布局改造成本与收益不匹配） | §3.3 |
| P5 (medium) | 降级路线依赖无排期的「边缘引文列表」 | **采纳**：降级交互载体改为 P1 已排期的「最简本源标注列表」，并写明降级时 P1 验收①的替代验证方式 | §5.4、§7 P1 |
| P6 (medium) | 滚动后工具条消失无重新唤起 | **采纳**：滚动停止 150ms 防抖后选区仍非折叠则重新浮现；状态机 A 补重现路径 | §3.1、§3.4-A |
| P7 (medium) | §1.4 与 §9.2 自相矛盾（逐条 AI 解释） | **采纳**：§1.4 改写为「自动触发不做；显式点击见 §9.2」，§9.3 补统一准入判据（显式触发+结果可跳转原文），§9.2 写明与 insights 的粒度差异 | §1.4、§9.2、§9.3 |
| P8 (medium) | 评论 vs 备注概念重叠、数据形态不清 | **采纳建议①（合并）**：单一「批注」概念，body 可选 + display_position 四档；工具条两键合一；删除 kind/parent，级联与撤销简化为单记录；「多条短评」形态的牺牲记入自评 #10 | §2.2、§3.1、§3.2、§5.1 |
| P9 (medium) | 读回能力全压 P2，北极星两期不成立 | **采纳**：P1 增补最简标注列表（按色过滤+跳原文）+ MD/JSON 最简导出（Blob，0.5 人日）；完整导出留 P2 | §2.3、§6.3、§7 P1 |
| P10 (medium) | AlertDialog 违反「无模态」原则且与撤销冗余 | **采纳**：单条删除无确认+toast 撤销（合并实体后无子级联，撤销即恢复单条）；仅批量删除保留 AlertDialog；原则 1 措辞修订「无常驻模态，不可逆批量操作例外」 | §1.3、§3.2 |
| P11 (low) | 交互规格混入未标分期的后期功能 | **采纳**：§3.x 各规格点标注交付期；「显示我的痕迹」开关补进矩阵（P1）并定义持久化（全局 localStorage，默认开） | §3.1-3.3、§2.3 |
| P12 (low) | pdf_anchor 无 text item 字段，prose 与 schema 不一致 | **采纳（后一分支）**：明确 v1 只持久化 quads+quote，item index 仅创建时用于计算，不持久化（跨版本不稳定） | §5.1、§5.3 |
| P13 (low) | PDF 文件替换的锚行为未定义 | **采纳**：page 超界或页内 quote 失配 → 整体 orphaned + 提示重传；不做自动重扫；矩阵该行修正为「三级重锚随 P1 交付」 | §3.4-C、§2.3 注 |
| P14 (low) | 颜色即状态对色盲不可辨 | **采纳**：过滤 chip/痕迹栏/总览条目加语义文字标签冗余编码 | §3.7、§4.5 |
| P15 (low) | 色语义命名存 localStorage 静默丢失 | **采纳（改服务端）**：annotation_settings 单例表（CONFIG_TABLES 同构）+ GET/PUT 端点 MVP 交付，localStorage 仅缓存 | §4.2、§5.1、§5.2 |
| P16 (low) | Anki CSV 正面二选一未裁决、结构未定义 | **采纳**：正面=引文（可配章节前缀）、背面=body、无 body 默认不进；列 Front,Back,Tags；RFC 4180 转义 | §6.3 |
| P17 (low) | P2 估算比 MVP 低且无解释 | **采纳**：逐项重拆 P2 前端人日并列复用项（后标称按裁决 3 对齐分项加总） | §7 P2 |

### 12.2 产品评审 missing（14 项）

| 项 | 处理 |
|---|---|
| 导入/迁移路径 | **部分采纳**：P2 尾交付 JSON 导入（仅自备份恢复）；第三方工具迁移不做（格式不稳定、无需求证据；以格式开放+API 兑现不私有锁定）→ §6.3 |
| 北极星度量与验证计划 | **采纳**：§1.6 两级验证（本地埋点代理指标 + dogfood 定性清单进 P2 验收） |
| 源删除资产防护交互 | **采纳** → §1.2、MVP 范围 |
| TextLayer 判据与 Plan B | **采纳** → §5.6 |
| 文本视图 margin 规格 | **采纳（裁决不支持+理由）** → §3.3 |
| 无障碍规格 | **采纳**：§3.7 新增，键盘路径进 P1 验收⑤ |
| 窄屏策略 | **采纳**：§6.4（<1024px 单视图降级、<768px 隐藏热力图） |
| quote/body 长度上限 | **采纳**：选区 ≤5000（quote 不可截断故上限即选区上限）、body ≤4000 → §3.5 |
| source 多 notebook 写哪个 | **消解**：notebook 字段删除，聚合按 reference 边实时求值 → §5.1 |
| 批量操作后端形态 | **采纳**：前端循环单条请求、不建批量端点、批量删除不提供撤销 → §3.6 |
| 撤销时子评论恢复 | **消解**：合并实体后无子评论；已写明 → §3.2 |
| 总览搜索字段 | **采纳**：quote + body → §3.6、§6.1 |
| MVP 期扫描页提示 | **采纳**：inline 常驻提示条（非 toast）→ §3.1 |
| 开关持久化范围 | **采纳**：全局 localStorage、默认开 → §3.3 |

### 12.3 技术评审（9 issues）

| # | 问题 | 处理 | 落点 |
|---|---|---|---|
| T1 (high) | RECORD_FIELDS 未注册致 import 失败 | **采纳（本会话核实 :258-264/:968-974/:990-1011 属实）**：裁决升级为四处注册（DATA_TABLES/TABLE_FIELDS/RECORD_FIELDS/CONFIG_TABLES）；验收⑤追加 round-trip pytest 断言 record 链接类型。合并实体后 record 字段仅剩 source，parent 顺序问题随之不存在 | §1.2、§5.1、MVP 验收⑤ |
| T2 (medium) | notebook 字段无写入时机 + 删除悬挂 | **采纳方案 (a)**：删字段与索引，聚合按 reference 边实时求值（P3 端点）；GET ?notebook_id= 移出 v1 API | §5.1、§5.2、§2.1 |
| T3 (medium) | i18n 面积低估（satisfies + new-keys + unused key 三重门禁） | **采纳（本会话核实 AGENTS.md:14、index.test.ts:55-66、new-keys.test.ts 均属实）**：每期上调至 1-1.5 人日，砍功能同步删键 | §7 头注、§8#7 |
| T4 (low) | 未验证论断当事实用（SurrealDB 嵌套索引断言、对比度、坐标换算） | **部分采纳**：SurrealDB 断言改标「待 spike 验证」并注明平铺决策另由 base.py:40-70 白名单支撑（不依赖该断言）；对比度与坐标换算纳入 spike 验收。澄清：初稿附注已声明这些是报告会话内验证、本会话未复跑，非无据声称，但同意降级措辞并补验证动作 | §4.2、§5.3、§5.6、§8#16 |
| T5 (low) | build_notebook_context 只迭代 sources/notes，annotations 被忽略且 total_content 不含标注 | **采纳（本会话核实 context_builder.py:285-326 属实）**：裁决扩展 build_notebook_context 识别 annotations 键并计入 total_content，弃「generate_artifact 内单独拉取」备选 | §9.1 |
| T6 (low) | 陈旧 quote 外流（总览/导出/转存笔记） | **采纳**：重锚成功/重新框选时重写 quote；orphaned 冻结 + 总览「已失锚」角标 | §5.3 |
| T7 (low) | 无虚拟化依赖，与少依赖口径不一致且未计入估算 | **采纳（本会话核实 package.json 无虚拟化依赖）**：P2 手写简易窗口化不新增依赖，估算已计入 | §6.1-C、§7 P2 |
| T8 (low) | AppSidebar「四项」引用失真 | **采纳（本会话核实为 4 组 12 项）**：已修正 | §2.1 |
| T9 (low) | mauve 有暗色值 #c892ba | **采纳（本会话核实 globals.css:317）**：色表已补 | §4.2 |

### 12.4 技术评审 missing（6 项）

| 项 | 处理 |
|---|---|
| RECORD_FIELDS + round-trip 测试 | **采纳** → §1.2、MVP 验收⑤ |
| notebook 写入语义与悬挂清理 | **消解**（字段删除）→ §5.1 |
| quote 快照更新规则 | **采纳** → §5.3 |
| 键盘/读屏排期 | **采纳**：键盘路径进 P1 验收⑤，读屏细则自评 #6 如实标注不足 | §3.7、§10 |
| 并发编辑与 updated 刷新 | **采纳**：last-write-wins + PUT 刷 updated（base.py:164 核实），乐观锁列 P3 | §5.5、§3.5 |
| P2 聚合 schema 与 annotations_count 计算方式 | **采纳**：annotations_count 同构 insights_count 子查询（sources.py:673 核实）；P3 聚合响应 schema 候选已列 | §2.1、§5.2 |

---

## 附：验证与引用说明

- 本终稿在初稿 10 份报告基础上，按两份评审修订；评审引用的代码事实经本会话逐一核实：`data_transfer_commands.py`（RECORD_FIELDS :258-264、DATETIME_FIELDS :265、_export_row :551-557、_prepare_import_row :946-987 含 record 转换 :968-974、_build_create_sql :990-1011、CONFIG_TABLES 注释 :104-106）、`sources/[id]/page.tsx:48-52`（无 notebookId）、`SourceDetailContent.tsx:89`（notebookId 可选）、`PdfSourceViewer.tsx:572-575`（无 notebookId 隐藏存笔记）、`frontend/AGENTS.md:14`（satisfies 门禁）、`locales/index.test.ts:55-66`（parity）、`new-keys.test.ts`（存在）、`package.json`（无 react-virtual/react-window）、`AppSidebar.tsx:49-82`（4 组 12 项）、`globals.css:317`（--mauve:#c892ba）、`context_builder.py:285-326`（仅迭代 sources/notes）、`artifact_commands.py:59-80`（_render_context_text）、`api/routers/sources.py:673`（insights_count 子查询）、`open_notebook/domain/base.py:164`（updated 显式写）。
- 初稿会话已核实并沿用：`SourceDetailContent.tsx:549-556/:633-635`、`PdfSourceViewer.tsx:205-240/:492-497`、`notebook.py:786-832`、`data_transfer_commands.py:93-101`、迁移目录 `open_notebook/database/migrations/`（当前到 32）。
- 各探索报告会话内的验证（node 坐标换算、KaTeX 双文本、WCAG 对比度脚本、竞品网页抓取）本会话未复跑，其中对比度与坐标换算已列入 MVP spike 验收清单（§5.6）。
- 规划会话未运行任何测试、构建或 lint（纯规划任务，无代码改动，ask 未指定检查）。
- **定稿固化（2026-10，本文档会话）**：18 项裁决来自 [PDR-003](../decisions/PDR-003-source-annotation-system.md)；裁决引用的代码事实在本会话复核：`Source.delete()` 收敛点与级联绕过注释（`open_notebook/domain/notebook.py:738-783`、`:769`）、EXPORTS_FOLDER（`commands/data_transfer_commands.py:87`）、迁移目录当前到 32.surrealql 与 `open_notebook/database/async_migrate.py` 注册到 32、`1.surrealql:13-14`/`29.surrealql:8-9` created/updated 写法先例、DATA_TABLES :93/TABLE_FIELDS :150/RECORD_FIELDS :258/CONFIG_TABLES :106、`api/main.py:404-442` 注册区、`frontend/src/app/(dashboard)/sources/page.tsx:1164-1174` 删除确认 ConfirmDialog、`frontend/src/lib/locales/` 14 locale 目录与 `index.test.ts`/`new-keys.test.ts`、`api/routers/notes.py:17-60` 平铺模式、`api/models.py:269`（NoteCreate，API schema 所在）、`markdown-renderer.tsx:88-103`（代码块由 SyntaxHighlighter 渲染）、`pdf-utils.ts:98/:120/:204`、`source-view-store.ts` 存在、`popover.tsx`/`tooltip.tsx` 存在、`docs/7-DEVELOPMENT/change-playbooks.md:116-125`（迁移手动注册）。MVP 执行拆解见 [MVP 任务清单](source-annotation-mvp-tasks.md)。
- **独立复核修订（2026-10-03）**：6 issues + 2 missing 全部处理，本次复核新验证的代码事实——`page_count` 在 open_notebook/api/commands 全仓 Python 零命中（`grep -rn "page_count" --include="*.py"`）与 `Asset` 仅 file_path/url（`open_notebook/domain/notebook.py:345-347`）⇒ 备份快照 page_count 定为 max(page)+1 口径、预检仅粗筛臂（§1.2/§6.3）；`frontend/src/components/ui/popover.tsx:33` 实值为 `w-72 … p-4` ⇒ §4.4 改为「结构参照、宽距按本规格」；三组件目录前缀补全（`components/usage/UsageHeatmap.tsx:21-24`、`components/layout/AppSidebar.tsx:49-82`、`components/sources/MessageActions.tsx:101-138`）；§3.1 提示条补换范围分支不渲染；§5.2 补 display_position MVP 期归一化语义；§9.1「某章」改 P3 新增口径；任务清单新增 §6.1 换范围分支任务对照表。
