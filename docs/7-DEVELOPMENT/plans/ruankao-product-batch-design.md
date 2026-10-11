# 软考产品批次合并实施设计稿 —— Q 题库 / W 写作台 / I 行业画像 / D 文件夹复制

- 作者：设计整合师（四 PRD 合并裁决）
- 日期：2026-10-11
- 设计稿落点：`docs/7-DEVELOPMENT/plans/ruankao-product-batch-design.md`（2026-10-11 自 gitignore 的 workflow-drafts 定稿迁入，正文未改动；四份分线 PRD 输入仍留在 workflow-drafts，不入库）
- 输入：`.zcode/workflow-drafts/prd/` 下 question-bank.md（Q）、writing-desk.md（W）、industry-profile.md（I）、folder-copy.md（D）
- 状态：设计定稿，可按线拆单实施
- 核实声明：本文所有 `file:line` 均在本会话实读核验；未实跑的检查（如种子生成脚本实跑、三波 LLM 提炼）明确标注为「实施期执行」。

---

## 0. 裁决总表（16 条开放问题，一条不落）

| # | 来源 | 问题 | 裁决 | 一句话理由 |
|---|---|---|---|---|
| 1 | Q-1 | 种子条目 origin 手动改判 | **本批不做**，记入下批（与「考生自查年份」同批） | 覆写表是 practicedOverrides 的复制，批量小；但 origin 改判动「判定权威性」叙事，需与年份自查一起设计 |
| 2 | Q-2 | 动作 D 无范文支深度 | **带值跳向导**（sessionStorage `ruankao.wizardSeed.v1` 一次性种子） | CreateEnvWizard 是 EnvironmentsPanel 内部 useState，Dialog 内嵌要把向导提出组件树，批次膨胀；coach-handoff 同款模式已验证，成本低一个量级 |
| 3 | Q-3 | 真题 md 背景段/解析是否入库 + 「查看原文件」入口 | **不入库**（只取题面三问，种子 ~70KB）；**不加新入口**——动作 D①「阅读对应文章」已覆盖（sourceRefs 含真题 md sourceId，read 深链即达全文，浏览器内搜索定位） | 解析叙事入库违反「产物=考试元数据」边界；合集 72K 人眼可读，复用 ADR-017 例行通道零新增 |
| 4 | Q-4 | en-US「真题」译法 | **Past exam**（badge）/ **Mock** | en-US 既有文案用 "past essay questions"（`en-US/index.ts:2717` questionBank.desc，本会话实读；emptyDesc :2725 亦为 "Past-question texts…" 同族措辞），"Real question" 有「真实 vs 真题」歧义 |
| 5 | W-1 | 容量条轨道容量 | **Σ目标 2700 五泳道单轨**（含摘要泳道） | 单层模块、泳道即「答题卡结构教学」；2500 专属轨+摘要小条是两层认知成本，考场口径靠②的正文合计大字表达已足够 |
| 6 | W-2 | 四段近超线 C 与红线 H（700/700/1200/600） | **采纳提案值**（H=C+100 统一失衡带） | 四段带宽一致可记忆；摘要 >300 即红是考场硬口径不动；与②的 2400 黄线自洽（四段写满目标恰触预警带） |
| 7 | W-3 | 容量模块 sticky 常驻 | **本批不做**（随滚动），sticky 记为后续可选增强 | 模块高约 120px，sticky 占视口；无真实使用反馈前 YAGNI |
| 8 | W-4 | 「占全文百分比」分母 | **五段合计（含摘要）** | 摘要也是五分之一篇，有占比语义；「占正文合计」要给摘要段做特例反而更乱 |
| 9 | W-5 | bodyState 红锁边界 | **收紧为 ≥2500**（覆盖旧 `>2500`） | 需求原话「≥2500 红锁」；恰好 2500 显示「已达硬上限」是预警不是报错，与考场「2500 截断」一致；训练器只 import 并使用 guardArguments/guardQ2（TrainingPanel.tsx:31-32 import、:125/:131 使用，实读确认；training-store.ts:26-31 仅 ARG_SECTION_TARGET/Q2_TARGET 目标常量与 isTargetMet，无任何 guard import——全仓 grep 确认），guardBody 边界改动无波及 |
| 10 | I-1 | profile 注入块用途护栏 | **本批不加**，留观察点：mock 实测出现照抄画像为论点 → 下批加一行 | hint 无护栏先例；三行措辞已是「参考」口径；红线由模板既有「严禁三类信息」行兜底 |
| 11 | I-2 | 仅 1 篇覆盖行业是否产 profile | **可产，人工评审逐条查泛化**（PRD 方案） | 收严为 ≥2 篇则 19 行业仅智慧医院存活，用户批评「没提取到什么」无法回应；过拟合由红线校验+人工把关 |
| 12 | I-3 | 池外候选行业（如视频会议云直播） | **只记候选清单**（脚本输出附件），本批不扩池 | 扩池动 77 条定稿+parity，超范围；候选清单是下批扩池的现成输入 |
| 13 | I-4 | TS/Python profile 键名 | **TS camelCase + Python snake_case + parity 映射比对** | 前端可读性优先；映射仅 3 键（projectForms↔project_forms 等），parity 测试写死映射表 |
| 14 | D-1 | classic sources 页是否同步铺开 | **不铺**（本批维持 PRD 范围），props 已就绪，Gemini 列反馈后紧随小批 | 纯接线活不值得混入本批回归面 |
| 15 | D-2 | 「复制文件名」文件夹变体键 | **复用 `sources.copyFileName`**，不加变体 | 语义可接受；省 14 locale × 1 键；反馈别扭再加 `sources.grouping.copyFolderName`（机制已验证） |
| 16 | D-3 | 置灰项悬停看不到 title | **维持「置灰 + title/aria-label」**，不改「可点击+警示 toast」 | 置灰=「此对象不存在该属性」的正确表达；toast 方案破坏 disabled 语义且要改验收 4；title 零成本留给屏幕阅读器，已知限制如实记录 |

---

## ① 四个需求的最终方案

### Q 线：论文题库 · 真题入库 + 详情针对性生成 + 改名

**方案**：纯前端（零新后端、零新表）。四层：

1. **种子**：构建期脚本 `frontend/scripts/build-question-seeds.mjs`（dev-time，非 CI）从本机 API 拉语料（library 端点 + 真题 md 全文 + 9 份 PDF 全文），提取→判定→去重→产出 `frontend/src/lib/ruankao/question-bank-seeds.gen.ts`（导出 `SEED_VERSION` 与 `SEED_QUESTIONS`）。生成物提交进库，**人工 review diff 后才提交**；构建不依赖本地 DB。
2. **schema v2 + 合并**：`question-bank.ts` 内扩展（详见 ②）；`loadQuestions()` 改为 `[...SEED_QUESTIONS(覆写 practicedOverrides 后的副本), ...userQuestions]`，沿用 ADR-018「preset 常量永不落盘」先例（`question-bank.ts:80-83` 实读确认）。
3. **列表**：真题/模拟双 badge + origin 筛选 + 种子可标练过 + 新排序（user 在前 → 种子 year 倒序 → 同年 real 在前 → 无年份排尾）。
4. **详情三动作 + 阅读通道**（混合通道，全零新后端）：

| 动作 | 通道 | handoff/跳转载荷 |
|---|---|---|
| A 拆题·论点矩阵 | `writeCoachHandoff`（coach-handoff.ts:32 现桥） | 题面（标题+年份+三问）+ 固定中文引导行（拆点流程） |
| B 问题2·技术方法要点 | 同上 | 题面 + 要点清单/提纲/示范段引导行 |
| C 论点区·两段提纲+示范 | 同上 | 题面 + 提纲先行/示范段引导行（不违「不代写」） |
| D 对应完整文章 | **优先级链**：sourceRefs 含 essay_library sourceId → 「阅读对应文章」跳 `/ruankao?tab=essay&read=<sourceId>`（ADR-017 例行通道）；否则含 zhenti_md/lunwen_pdf sourceId → 同样跳 read 视图读权威文件/合集；两者皆无 → 「生成整篇练习文」写 `ruankao.wizardSeed.v1` 一次性种子并切 environments tab，向导打开且 keywords 预填（**改动面两个文件**：`EnvironmentsPanel.tsx:16-19` 的 `EnvironmentsWizardSeed` 从 `{industry}` 扩为 `{industry?, keywords?, name?}`（实读确认现仅 industry）；`CreateEnvWizard.tsx` 的 preset 类型（:45 `preset?: { industry: string } \| null`）同步扩展为同形可选字段，且 preset effect（:219-224）内**条件式**落值——`preset.industry` 存在才 `setIndustry`，`preset.keywords` 存在才 `setKeywords`，`preset.name` 存在才 `setMockName`。**必须改向导**：:223 现为无条件 `setIndustry(preset.industry)` 而 keywords 是独立 state（:150 `useState<string[]>([])`，实读确认）——只扩种子不改向导，keywords-only 种子会 `setIndustry(undefined)` 打破受控输入，D② 验收必失败） | — |

**否决记录**：「三个动作全走教练」被 PRD1 §5.3 正确否决并维持——「生成整篇文章」与教练人设「正文段必须考生自己写，你不代写」（agent-templates.ts 教练模板工作流步骤 4，本会话实读原文）正面冲突；合规通道（红线阅读 + mock-generate 向导）更对口且零新后端。

**深链同步（跨线依赖，见 ④）**：`page.tsx` 现只在 useState 初值取 `?tab=`（page.tsx:12-19 实读），同页 `router.push` 不重挂载。Q 线给 `RuankaoPage` 加 useEffect 监听 `searchParams.tab` 同步 `activeTab`（~3 行+测试）；`EssayPanel` 的 `?read=` 同步 effect 归 **W 线**交付（EssayPanel 本批仅 W 线可动）。Q 先合、W 未合时的降级：同页跳转落在 essay tab 的 home 视图，刷新/直开 URL 正常——合入顺序（④）消除该窗口。

**改名**：`ruankao.tabs.questionBank`（zh「论文第二问-题库」→「论文题库」）、`questionBank.title`、`questionBank.desc` 三键 ×14 locale 改文案；tab 键 `questionBank`、testid `ruankao-tab-questionBank`、深链 `?tab=questionBank`、`tabs.ts` **全部不动**（tabs.ts:32-38 实读确认注册表零改动）。

**ChatPanel 说明（ask 点名）**：**Q 线零改动 ChatPanel**。动作 A/B/C 复用现有 coach-handoff 桥——载荷只有 `text + projectEnvId` 两字段（coach-handoff.ts:13-16 实读确认），题面与引导行全部装进 text；消费端预填不代发、教练智能体与项目环境自动预选均为 ChatPanel.tsx:259-277 现行为，无需任何修改。

**TrainingPanel**：只做 schema 兼容（loadQuestions 返回多出 origin/sourceRefs 字段，训练器只消费 title/year/q1-q3，类型兼容零改动），跑既有测试确认。

### W 线：写作台产品化——「论文容量」可视化

**方案**：纯前端呈现层重组，不动后端、不动 `ruankao.essayDrafts.v1` schema、不拆论点区桶、不阻断输入（护栏只提示不拦截红线延续）。

1. **顶部容量条模块** `frontend/src/components/ruankao/EssayCapacityBar.tsx`（新组件，①+② 合体）：草稿选择条之下、项目环境关联行之上，独立 Card。五条固定泳道（宽 = `target_i/2700`，flexBasis 先例 `ContextBreakdownBar.tsx:86-95` 实读确认），泳道内填充 = `min(chars/target,1)`，色=段色/`bg-warn`/`bg-destructive`；图例 chip 行（`ContextBreakdownBar.tsx:96-108` 先例）每段=色点+段名+当前/目标+四态图标与文字（**状态不许只靠颜色区分**——warn=clay 与 danger 色相几乎同，globals.css:208-210 实读确认）。每泳道 `role="progressbar"` + aria 三件套。
2. **总量区**：头部右侧「正文合计 **X** / 2500」大字（`font-mono text-2xl md:text-3xl tabular-nums`）+ 四态梯度（thin/ok/near/over，见 ② 基准表）；原编辑区底部小字行移除，testid `ruankao-write-body-total` 迁至新位置。
3. **段卡头部结构化**：纯段名 + 目标区间徽标（`F~T 字`）+ 四态字数 Badge（`font-mono tabular-nums`，状态色挂 className，testid `ruankao-write-count-{key}` 保留）+ 占全文百分比（分母=五段合计，Σ=0 显示 0%）。**旧键 `sectionAbstract`~`sectionClosing` 原样保留**（TrainingPanel 复用 sectionArguments/sectionQ2，改文案会波及训练器——PRD2 §5③ 正确指认，维持）。
4. **交卷完整度**：底部动作条内、发教练按钮左侧，「论文完整度 k/5 段达标」+ 未达标段 chips；全空诚实显示 0/5；**不阻断发送**（发教练按钮行为原样保留）。

**基准值单一数字源**：全部落在 `essay-guardrails.ts` 扩展（SECTION_BASELINES + sectionState/bodyState/capacityPercent/essayCompleteness，见 ②）。

**对 PRD2 §6 的一处修正（设计裁决）**：PRD 建议旧五守卫「改由基准表派生」。**否决该派生路径，改为新旧并存**：`guardQ2`/`guardArguments` 等旧三态守卫签名与行为逐字节不变（现行为：超近超线仍返回 'ok'；若经 sectionState 派生，near 会折叠进 'warn'，**改变训练器可见行为**，属隐性回归）。仅 `guardBody` 做一处有意变更：`>2500` → `>=2500`（裁决 #9）。新四态函数独立实现，与基准表同源。

### I 线：行业池语料画像 profile

**方案**：数据生产（离线一次性）+ 注入（ADR-019 方案 B 原样生长）+ 展示（hover）三位一体。

1. **数据**：`INDUSTRY_PROFILES` 独立稀疏映射（**不内联进 77 条条目**——内联打破 parity 正则 `tests/test_industry_pool_parity.py:19` 的 `\{ name: '(.+?)', hint: '(.+?)' \}`，实读确认）。TS 侧 `industry-pool.ts` 追加 `IndustryProfile` 接口与映射；Python 侧 `open_notebook/ai/industry_pool.py` 追加镜像与 `industry_profile_for()`（池外/空白/默认/无覆盖返回 `None`，与 hint 空串同义）。
2. **注入**：五主链函数（`open_notebook/ai/project_env_pipeline.py:614/673/704/739/768` 实读确认五处 `"industry_hint": industry_hint_for(...)`）各追加一行 `"industry_profile": industry_profile_for(resolved_industry)`；5 个模板 COMPANY CONTEXT 在 hint 条件行**之后**追加独立 profile 条件块（3 行，`{%- if %}` 空白控制形态）。**旁路不注入**：generic_paragraph / fixed_parts 维持（ADR-019 理由不变）。
3. **退化矩阵**（逐字节一致的定义，锁定手法复刻 `tests/test_project_env_prompts.py:691-721` 剥离模板比对）：池内无覆盖行业 = 现状 1 行逐字节；池外/默认/空白 = 无 hint 行无 profile 块逐字节；有覆盖 = 现状 1 行 + 新 3 行。
4. **前端 hover**：`industryTitleLines(entry, t): string[]` 公共 helper（消除 IndustryPoolPanel.tsx:44-45 与 IndustryCombobox.tsx:58-59 两处重复表达式，实读确认同式）；有 profile 显 5 行、无 profile 与今天逐字节相同；点击/过滤/testid 全部不变。
5. **提炼管线**：`scripts/build_industry_profiles.py`（仓库根 scripts/，与 add_templates_i18n.py 同层先例），三波推进，详见 ③。

### D 线：文件夹右键复制三项

**方案**：纯前端。

1. `SourceContextMenu.tsx` 的 `GroupContextMenuContent` 增四个可选 props：`onCopyName` / `onCopyRelativePath` / `onCopyAbsolutePath` / `disableCopyAbsolutePath`（实读确认现接口仅 canHaveChildren/onNewSubgroup/onRename/onMove/onDelete 五项，`SourceContextMenu.tsx:144-167`）；「未传即不渲染」契约与来源侧一致 → 既有调用方 `GroupTree.tsx:436`、`FolderGrid.tsx:133` 零改动零回归。
2. `GeminiSourcesColumn.renderFolderNode` 接线：名称=`group.name`；相对路径=`getAncestorChain(treeData.groups, group.id).map(g=>g.name)` 根在前 + 自身名 `join('/')`（根级=自身名，group-tree.ts:54-69 实读确认未知 id 返回 `[]`）；**绝对路径恒置灰**（裁决 #16 + PRD4 §4 裁决 A：文件夹只是 SurrealDB 分组记录、磁盘无对应目录，编造即误导——候选 B「层级链当绝对路径」与相对路径逐字符同、候选 C「取成员目录前缀」几乎全是 `/data/uploads` 平铺串，均否决）。菜单结构、图标、分段节奏镜像来源行（FileText/FolderTree/HardDrive，复制三项独立成段插在「移动」与「删除」之间）。
3. i18n：复用 `sources.copy*` 四键（14 locale 已全覆盖，PRD4 §2.5 逐 locale 验证过）；仅新增 1 键 `sources.grouping.folderNoDiskPath`（置灰项 title+aria-label）。
4. 边界维持：未分组伪节点无右键菜单；第 5 层文件夹「新建子文件夹」隐藏但复制三项照常；空文件夹/折叠态照常可复制。

---

## ② 数据 schema 定稿

### 2.1 题库种子（Q 线）

**文件**：`frontend/src/lib/ruankao/question-bank-seeds.gen.ts`（生成物提交进库）

```ts
export const SEED_VERSION: number            // 每次重跑 +1
export const SEED_QUESTIONS: readonly RuankaoQuestion[]
```

**条目类型**（`question-bank.ts` 内扩展，覆盖现 `RuankaoQuestion`）：

```ts
export type QuestionOrigin = 'real' | 'mock'

export interface RuankaoQuestionSourceRef {
  kind: string            // 'zhenti_md' | 'essay_library' | 'lunwen_pdf' | 'exam_note'
  sourceId: string | null // 'source:<id>'；纯文本出处为 null
  folder: string          // 展示夹名：真题md / 希赛论文范文 / 芝士架构论文范文 / 论文（PDF）
}

export interface RuankaoQuestion {
  id: string              // 种子: 'ruankao-question-seed-' + 规范化标题稳定 hash（sha256 前 10 hex，重跑不漂移）；user 不变
  year: string            // 允许 ''；真题 marker 原样（'2024'、'2025 下'）
  title: string
  domain: string          // 脚本按 ③ 关键词表赋初值；自由文本
  q1: string; q2: string; q3: string   // v2 起允许 ''（标题-only 条目）
  practiced: boolean
  origin: QuestionOrigin
  originNote?: string     // 「真题md·真题段」「题库权威未收录→默认模拟」「考生回忆版·年份未标注」等判定依据
  sourceRefs: RuankaoQuestionSourceRef[]
  source: 'seed' | 'user' // v2: 'preset' 退役（demo 条目随 PRESET_QUESTIONS 删除）
  createdAt: string
  updatedAt: string
}
```

**localStorage v2 合并策略**（key `ruankao.questions.v2`）：

```ts
interface QuestionsStorageV2 {
  version: 2
  questions: RuankaoQuestion[]                  // 仍只存 user 条目
  practicedOverrides: Record<string, boolean>   // 种子条目 id → 练过覆写（种子是常量不可变）
}
```

- `readStorage()`：先读 v2；无 v2 读 v1 迁移——v1 user 条目补 `origin:'mock'` + `originNote:'v1 自录迁移'` + `sourceRefs:[]`（v1 表单无 origin 概念，自录未验证 → 诚实默认模拟）；v1 preset 演示条目弃（本就未落盘）。**不删除 v1 key**（回滚无损）；`saveQuestions` 恒写 v2。
- 宽容读延续：坏条目剔除、整体解析失败回退（question-bank.ts:56-78 先例）。
- `loadQuestions()`：返回 `[...种子副本(应用 practicedOverrides), ...user]`；排序职责在面板（user 在前 → 种子 year 倒序 → 同年 real 在前 → 无年份排尾，扩展现 `compareQuestionsDesc`，QuestionBankPanel.tsx:82 实读确认）。

**数量级门禁**：`SEED_QUESTIONS.length ∈ [100,150]`（量级 ≈120），其中 origin real ∈ [35,60]；脚本重跑两次 diff 为空（id 稳定）。

### 2.2 行业 profile（I 线）

**TS 侧**（`industry-pool.ts` 追加）：

```ts
export interface IndustryProfile {
  projectForms: string[]    // 2~4 条
  techStack: string[]       // 3~6 条
  businessFlows: string[]   // 3~5 条
}                           // 每条 1~25 code points，行业级事实模式
export const INDUSTRY_PROFILES: Readonly<Record<string, IndustryProfile>> = { ... }  // 键=池 name 逐字同源，稀疏
export function industryTitleLines(entry: IndustryPoolEntry, t: TFunction): string[]
```

**Python 侧**（`open_notebook/ai/industry_pool.py` 追加）：

```python
IndustryProfile = Dict[str, List[str]]   # keys: project_forms / tech_stack / business_flows（snake_case，裁决 #13）
INDUSTRY_PROFILES: Dict[str, IndustryProfile] = { ... }
def industry_profile_for(industry: Optional[str]) -> Optional[IndustryProfile]:
    return INDUSTRY_PROFILES.get((industry or "").strip())
```

**parity 测试扩展**（`tests/test_industry_pool_parity.py`）：既有 77 条 hint 对账（实读确认现 46 行、3 个用例函数 + 参数化）保持零退化（基线 79 passed，PRD3 §3.2 实跑）；新增——TS 与 Python `INDUSTRY_PROFILES` 键集合相等；逐键三数组经映射表（`projectForms↔project_forms`、`techStack↔tech_stack`、`businessFlows↔business_flows`）逐字相等；profile 键 ⊆ 77 name 集合。**parity 用正则从 TS 源抽 `INDUSTRY_PROFILES` 字面量**（抽法：匹配 `'name': {` 起止的块或直接 import 不可行（TS 文件），沿用源码正则先例，块正则须容忍多行数组）。

**不变量**：77 条池 name 与 hint 一字不动（name 是落库值 `env.industry` 与查表键，industry-pool.ts:4-6 注释实读确认）；`INDUSTRY_MAX_CHARS=20` / `INDUSTRY_HINT_MAX_CHARS=40` 不动；既有 `industry-pool.test.ts` 守护（77 条、唯一、≤20/≤40）零退化。

### 2.3 写作台基准表（W 线，单一数字源）

`essay-guardrails.ts` 追加（现文件 39 行实读确认，口径注释 ：1-5）：

| 段 key | F 下限 | T 目标 | C 近超 | H 红线 | 段色（ADR-011 token） | 泳道宽（T/2700） |
|---|---|---|---|---|---|---|
| abstract 摘要 | 200 | 300 | —（300 即硬口径） | 300（>300 即红） | `bg-teal` | 11.1% |
| background 背景 | 400 | 500 | 600 | 700 | `bg-slate-hue` | 18.5% |
| question2 问题2 | 400 | 500 | 600 | 700 | `bg-plum` | 18.5% |
| arguments 论点区 | 900 | 1000 | 1100 | 1200 | `bg-fern` | 37.0% |
| closing 结尾 | 300 | 400 | 500 | 600 | `bg-sage` | 14.8% |

（泳道宽列为展示用四舍五入值。**实现按 `target_i / 2700` 现算 flexBasis**——如 `300/2700≈11.111%`——五段 basis 之和由构造恒等于 100%；W 线验收「五泳道 flexBasis 和=100%」以现算值为准，不取表中舍入值。）

```ts
export interface SectionBaseline { key: keyof RuankaoEssaySections; floor: number; target: number; ceiling: number; hard: number; labelKey: string }
export const SECTION_BASELINES: readonly SectionBaseline[]
export type SectionState = 'ok' | 'under' | 'near' | 'over'
export function sectionState(key, n): SectionState      // n<F under / F≤n≤C ok / C<n≤H near / n>H over
export function bodyState(total): 'thin'|'ok'|'near'|'over'  // <2000 | 2000–2399 | 2400–2499 | >=2500（红锁边界，裁决 #9）
export function capacityPercent(n, target): number      // min(100, n/target*100)
export function essayCompleteness(sections): { met: number; total: 5; issues: {key; state}[] }
```

旧守卫处置（本稿修正）：`guardAbstract/guardQ2/guardArguments/guardClosing` **原样保留**（训练器行为逐字节不变）；`guardBody` 仅改边界 `>2500`→`>=2500`；正文合计口径不变（摘要不计入，EssayPanel.tsx:555-559 现口径）。四段目标之和 2400 与 bodyState 的 2400 黄线自洽；五段目标之和 2700 = 轨道容量（裁决 #5）。

### 2.4 真题/模拟判定规则（origin 权威链，Q 线）

按优先级合并到同一条目（去重 key = 标题规范化串，规则见 ③）：

1. **真题 md「## 真题」「## 2025下半年真题」小节 → `real`**。year 取小节年份 marker；无年份小节 `year:''` + `originNote:'考生回忆版·年份未标注'`。2025 下半年简记条（软件测试·秒杀场景）单独成条：origin real、year '2025 下'、title 保留原貌、三问用简记原文。
2. **真题 md「## 模拟题」小节 → `mock`**。与真题段重名的 2 条（论大数据Lambda架构、论模型驱动架构设计方法及其应用）**真题胜出**：合并为一条 real（year 取真题段），不重复建条。
3. **论文夹 PDF 按题提取：行首独立 `论…` 标题行 + 前置/同行 `20XX年…真题` marker → `real`**，year 从 marker 提取；PDF 文件名不直接成条（是主题不是题目），记入所出条目 `sourceRefs[].folder='论文（PDF）'`。无 marker 且无「请围绕…论述」三问块的 `论…` 行**不入库**（宁缺勿滥）。
4. **范文标题（希赛/芝士两夹）**：规范化命中规则 1/3 的真题集合 → 向该真题条目追加范文 sourceRef，origin 不变；**未命中 → 默认 `mock`** + `originNote:'题库权威未收录→默认模拟'`。badge 语义=「是否验证为历年真题」，未验证标真题是欺骗，标模拟是保守（改判=裁决 #1，本批不做）。
5. **块名单**：`论文常用知识.md`、`论文组件.md`（知识文章非题目）硬编码剔除，PRD 层已向用户显式声明防验收争议。

---

## ③ 提取管线设计

### 3.1 题库提取（Q 线，`frontend/scripts/build-question-seeds.mjs`）

**输入**（dev-time 直打本机 API，命令先例见 PRD1 §1.2 实跑记录）：
- `GET /api/ruankao/essay-marks/library?view_id=<view>`（清单，端点 api/routers/ruankao_essay_marks.py:32-41）
- `GET /api/sources/source:1r4qun27b2y21z68casr`（真题 md 全文 72,473 字符；**id 必须带 `source:` 前缀**，裸 id 400——I 线实测先例）
- 9 份 PDF 逐个 `GET /api/sources/source:<id>` 拉 full_text

**真题 md 解析规则**：
- 二级标题分节：`## 真题` / `## 模拟题` / `## 2025下半年真题`，各节内按 `#### ` 四级标题切题。
- 题目标题：`#### 第N题 论XXX`；**容错**：`#### 第\d+题` 独占一行而标题落次行的形态（DSSA 条实测先例）——正则命中「孤立序号行」时向下一非空行取标题。
- 三问块：跟随「请围绕…三个方面论述」的段落整体截取为 q1/q2/q3（分段符按原文序号/换行启发式，人审兜底）。
- 简记条（2025 下半年）：无标准三问，原文整段入 q1，q2/q3 置 ''。

**PDF 解析规则**（水印噪声容忍）：
- 标题行 = 「行首 `论…` 独立成行」（散落单字水印行天然不匹配）。
- 年份 marker = `20XX年…真题`，与标题同行或其前 3 行内；命中 → real + year。
- 三问块跟随「请围绕…论述」；**无 marker 且无三问块 → 丢弃**。
- 噪声过滤：非标题候选中长度 <8 的单字/散字行全部忽略。

**标题匹配规则**（规范化函数，脚本内实现、纯函数可单测）：
```
normalize(t) = t
  → 去 .md 后缀
  → 去全部空白字符
  → 全角括号（）→ 半角()
  → 去尾部变体后缀：尾随数字、尾随 (1)/(2)/(一)(二) 等重名变体
```
去重 key = `normalize(title)`；规范化口径与 PRD1 §1.2-D 实测一致（61 规范化范文标题 / 102 全来源并集）。

**技术域分类**（domain 初值，关键词表硬编码于脚本，命中即停按表序优先；全部未命中 → 「其他」）：

| domain | 关键词样例 |
|---|---|
| 微服务与分布式 | 微服务, SOA, 分布式, 服务治理, Lambda, 事件驱动, 远程调用 |
| 缓存与存储 | 缓存, Redis, NoSQL, 分库分表, 对象存储, 数据库设计 |
| 消息与集成 | 消息队列, Kafka, RabbitMQ, RocketMQ, 企业集成, ESB, 数据交换 |
| 安全与风控 | 安全, 保密, 加密, 认证, 反诈, 风控, 等保 |
| 可靠性与容错 | 可靠性, 容错, 高可用, 灾备, 冗余, 负载均衡 |
| 大数据与实时计算 | 大数据, 数据仓库, 数据湖, 实时计算, 遥感, 数据挖掘 |
| 架构风格与设计模式 | 架构风格, 设计模式, 面向对象, 模型驱动, DSSA, 微内核 |
| 云原生与运维 | 云计算, 容器, Kubernetes, DevOps, 持续交付, 可观测, 监控 |
| Web 与前后端架构 | REST, 微前端, 前后端分离, 单页应用 |
| 物联网与嵌入式 | 物联网, 嵌入式, 边缘计算, 传感器, 实时系统 |
| AI 与智能应用 | 机器学习, 深度学习, 知识图谱, 大模型, 智能客服, 计算机视觉 |
| 中间件与事务 | 中间件, 应用服务器, 事务处理 |
| 网络与通信 | 网络设计, SDN, 5G, 视频会议, 流媒体 |

**产出与门禁**：输出 `.gen.ts`（SEED_VERSION+1）；控制台打印统计（总条数/real 数/各来源分布/被剔除条目清单）；**人审 diff 后提交**。`论文常用知识/论文组件` 剔除进控制台报告。脚本不在 CI 运行。

### 3.2 行业画像提炼（I 线，`scripts/build_industry_profiles.py`）

**语料范围**：67 篇单篇范文（`论` 前缀 .md、排除真题md/论文常用知识/论文组件 3 合集）；教材/宝典 PDF 与合集不进本批（需切分，PRD3 §2.2 非目标 5）。

**批次划分**（每次 LLM 调用 = 1 篇，单篇 3~4K 字输入；每人工评审批 8~10 篇）：

| 波次 | 篇数 | 内容 | 目的 |
|---|---|---|---|
| W1 | 20 | 标题已标注行业（映射表写死脚本，20 篇→19 行业） | 行业锚点确定，校准提取质量与红线敏感度 |
| W2 | 25 | 未标注前 25 篇 | 正文分类路径验证（含 in_pool:false 丢弃率） |
| W3 | 22 | 未标注余 22 篇 | 收尾，全量聚合评审一次过目 |

校准调整只允许发生在 W1 结束（W2/W3 不改 prompt，防口径漂移）。**实施期执行**（本设计稿未跑 LLM）。

**每篇产出形状**（LLM 输出契约）：
```json
{ "source_id": "source:<id>", "industry": "<77 name 之一>", "in_pool": true,
  "projectForms": ["…≤25字"], "techStack": ["…"], "businessFlows": ["…"] }
```
单篇只给「该篇事实」，不给行业概括（概括由聚合做，避免每篇编一遍行业口径）；归不进任何池 name → `in_pool:false` 整篇丢弃并记「池外候选」附件（裁决 #12）。

**行业归联**：标题直标注（20 篇快路径，映射表如 银行核心系统→银行核心系统改造、警情平台→智慧警务（警情联动）… 全表见 PRD3 §5.4）→ 其余 47 篇把 77 条 name 清单随全文喂 LLM 归类。

**聚合规则**（确定性 Python，可复算）：按行业分组 → `projectForms` 同义合并去重按频次截 2~4；`techStack` 并集按频次截 3~6（频次 1 且非行业主流丢弃）；`businessFlows` 同义合并截 3~5。≤25 字改写是**人工评审的活**（脚本只机械截断报错，不悄悄改写）。

**无覆盖行业降级**：≥1 篇有效语料即可产 profile（裁决 #11），仅 1 篇覆盖的行业人工逐条查泛化（剔除仅该范文特有的表述，宁可空缺不编造）；预期 25~32 行业有 profile，其余 45+ 保持 hint-only——诚实口径。

**红线约束写进提取任务模板**（两线提取 prompt 均须包含，原文）：

> **（I 线）产物只能是行业级事实模式，严禁范文句子/论点表述进数据文件。** 禁入：范文原句、范文项目专名（某行专属方案名用行业泛称替代）、效果数据与数字规模、人物角色叙事、交付方叙事（甲方/乙方/中标/承接/验收）。逐条 ≤25 字，条数按形状表。

> **（Q 线）产物只允许考试元数据**：题目标题、年份 marker、三问原文（逐字引用，不改写不概括）、来源引用（folder/sourceId/kind）。**禁入**：背景段叙事、参考解析、范文正文、任何创作性文本。三问原文是事实数据的逐字引用，不属于创作。

机械校验（I 线脚本内置，不过不出粘贴块）：
1. **n-gram 重叠**：任一 profile 条目与任一范文 full_text 存在 ≥12 连续字符重叠 → fail（12 字以上连续同文基本排除巧合行话，命中即在抄句子）。
2. **字符守卫**：条目含数字（效果数据）或出现「我司/本项目/该项目/中标/承接/验收」叙事标记词 → fail。
3. **形状守卫**：条数与字长出界 → fail。

人工评审 gate：`industry-profiles.aggregated.json` 过目件维护者逐行业确认（重点：仅 1 篇覆盖行业、同义合并条目），确认后合入双镜像。Q 线对应 gate = 种子 diff 人审。

---

## ④ 四条实施线的文件落点与冲突检测

### 4.1 文件归属矩阵（⚪零改动 / 本线独占 / 共享）

| 文件 | Q | W | I | D | 说明 |
|---|---|---|---|---|---|
| `frontend/src/lib/ruankao/question-bank.ts` | **独占** | ⚪ | ⚪ | ⚪ | schema v2 + v2 存储 + 合并 |
| `frontend/src/lib/ruankao/question-bank-seeds.gen.ts` | 新建 | ⚪ | ⚪ | ⚪ | 生成物提交 |
| `frontend/scripts/build-question-seeds.mjs` | 新建 | ⚪ | ⚪ | ⚪ | dev-time 工具（frontend/scripts/ 已有 copy-pdf-worker.js 先例） |
| `frontend/src/components/ruankao/QuestionBankPanel.tsx`(+`.test.tsx`) | **独占** | ⚪ | ⚪ | ⚪ | badge/筛选/详情/动作/排序 |
| `frontend/src/app/(dashboard)/ruankao/page.tsx`(+`page.test.tsx`) | **独占** | ⚪ | ⚪ | ⚪ | tab 深链同步 effect；改名断言 |
| `frontend/src/components/ruankao/EssayPanel.tsx`(+`.test.tsx`) | ⚪ | **独占** | ⚪ | ⚪ | **ask 约定：EssayPanel 仅 W 线**；`?read=` 同步 effect 由 W 交付 |
| `frontend/src/components/ruankao/EssayCapacityBar.tsx` | ⚪ | 新建 | ⚪ | ⚪ | 容量条模块 |
| `frontend/src/lib/ruankao/essay-guardrails.ts`(+test) | ⚪ | **独占** | ⚪ | ⚪ | 基准表 + 四态机（旧守卫除 guardBody 边界外不动） |
| `frontend/src/lib/ruankao/industry-pool.ts`(+`.test.ts`) | ⚪ | ⚪ | **独占** | ⚪ | profile 类型 + INDUSTRY_PROFILES + industryTitleLines |
| `frontend/src/components/ruankao/IndustryPoolPanel.tsx`(+test)、`IndustryCombobox.tsx` | ⚪ | ⚪ | **独占** | ⚪ | title 多行化（helper 接线） |
| `frontend/src/components/sources/SourceContextMenu.tsx`(+test) | ⚪ | ⚪ | ⚪ | **独占** | GroupContextMenuContent 四 props |
| `frontend/src/app/(dashboard)/notebooks/components/GeminiSourcesColumn.tsx`(+test) | ⚪ | ⚪ | ⚪ | **独占** | 文件夹菜单接线（**ask 约定：仅 D 线**） |
| `frontend/src/components/sources/ChatPanel.tsx`(+test) | ⚪ | ⚪ | ⚪ | ⚪ | **Q 线生成桥零改动**（见 ① ChatPanel 说明）：载荷 text+projectEnvId 足够，预填/预选均现行为 |
| `frontend/src/components/ruankao/EnvironmentsPanel.tsx`(+test) | **独占** | ⚪ | ⚪ | ⚪ | wizardSeed 类型扩展 + 传递（:101 `preset={wizardSeed}` 实读确认）；关闭清空种子逻辑不动 |
| `frontend/src/components/project-envs/CreateEnvWizard.tsx`(+`.test.tsx`) | **独占** | ⚪ | ⚪ | ⚪ | preset 类型扩展（:45 `{industry: string}` → `{industry?, keywords?, name?}`）+ preset effect 条件式落值（:219-224，keywords 独立 state :150）；不改为受控输入断裂点，见 ① D② |
| `frontend/src/components/ruankao/TrainingPanel.tsx` | ⚪（仅跑测试） | ⚪ | ⚪ | ⚪ | schema 兼容验证，零代码改动 |
| `open_notebook/ai/industry_pool.py` | ⚪ | ⚪ | **独占** | ⚪ | profile 镜像 + 查表函数 |
| `open_notebook/ai/project_env_pipeline.py` | ⚪ | ⚪ | **独占** | ⚪ | 五处 data 组装 +import |
| `prompts/project_env/*.jinja`（5 个） | ⚪ | ⚪ | **独占** | ⚪ | hint 行后独立 profile 条件块 |
| `tests/test_industry_pool_parity.py` | ⚪ | ⚪ | **独占** | ⚪ | profile 对账扩展 |
| `tests/test_project_env_prompts.py` | ⚪ | ⚪ | **独占** | ⚪ | 注入/退化/旁路扩展 |
| `scripts/build_industry_profiles.py` | ⚪ | ⚪ | 新建 | ⚪ | 仓库根 scripts/ |
| `frontend/src/lib/ruankao/tabs.ts`、`frontend/src/lib/agent-templates.ts`、`frontend/src/lib/ruankao/coach-handoff.ts` | ⚪ | ⚪ | ⚪ | ⚪ | **全四线零改动**（只读引用；改名只动 locale 文案；coach-handoff 载荷 ：13-16 与 writeCoachHandoff :32 均复用现行为） |
| `frontend/src/lib/locales/<locale>/index.ts` ×14 | **共享** | **共享** | **共享** | **共享** | 见 4.2 写入约定 |
| `frontend/src/lib/locales/new-keys.test.ts` | **共享** | **共享** | **共享** | **共享** | 见 4.2 写入约定 |
| `CHANGELOG.md` | 共享 | 共享 | 共享 | 共享 | 各自小节追加 bullet，不建重复节 |

### 4.2 共享文件写入顺序约定

**并行开发、串行合入，顺序：D → I → W → Q。** 每线合入前 rebase 最新分支并跑全量门禁。排序依据：
- Q 对 W 有单向依赖（动作 D① 同页深链需要 W 交付的 EssayPanel `?read=` 同步 effect）；Q 最后合入使验收一次全绿。
- D 最小最独立（1 键 + 2 组件），先合先减 locale 分叉；I 含后端+模板（唯一动 Python 的线），尽早合入让 parity/prompts 门禁早暴露问题。

**冲突点与解法**：

1. **`locales/<locale>/index.ts`（四线共享）**：各线只在**自己 section** 内追加——Q：`ruankao.questionBank.*` + `ruankao.tabs.*`；W：`ruankao.essay.write.*`；I：`ruankao.industry.*`；D：`sources.grouping.*`。section 互不重叠，git 按不同 hunk 自动合并；rebase 冲突时保留双方、按 section 归属裁决。新增键放各自 section 尾部。**任何线不得改他人 section 的键**（含退役键：Q 退役 `sampleBadge` 只删 questionBank section 内自己负责的键）。
2. **`new-keys.test.ts`（四线共享）**：每线新增**独立常量数组** + 独立 `describe.each` 条目（现模式：`INDUSTRY_HINT_KEYS` 于 :1532 + describe.each :1534/:1549，实读确认），如 `QUESTION_BANK_V2_KEYS` / `ESSAY_CAPACITY_KEYS` / `INDUSTRY_PROFILE_KEYS` / `FOLDER_COPY_KEYS`；追加在既有钉扎区尾部，冲突时按合入顺序依次保留全部条目。
3. **`CHANGELOG.md`（四线共享）**：各线在 `## [Unreleased]` 既有 `### Added` / `### Changed` 列表**尾部**追加自己的 bullet；不建重复小节（硬规则）。Q 线产生两条：Added（真题入库/详情生成）+ Changed（改名/badge）；W/I/D 各一条 Added。
4. **`EssayPanel.tsx` 所有权**：Q 线如发现需要 EssayPanel 改动（read-sync effect），**不直接改**——该 effect 已划入 W 线交付清单（~3 行 + 测试）；若 W 先合入则 Q 验收完整，否则按降级口径验收（① Q 线节）。

---

## ⑤ i18n 键全清单与 14 locale 写入约定

14 locale 清单（实读 `frontend/src/lib/locales/` 目录确认）：zh-CN、zh-TW、en-US、ja-JP、bn-IN、ca-ES、de-DE、es-ES、fr-FR、it-IT、pl-PL、pt-BR、ru-RU、tr-TR。ruankao 先例是**全语言落地翻译，非 en fallback**。

### 5.1 Q 线（新增 19 + 修改 3 + 退役 1）

| 键 | zh-CN | en-US | 状态 |
|---|---|---|---|
| `ruankao.questionBank.originReal` | 真题 | Past exam | 新增（裁决 #4） |
| `ruankao.questionBank.originMock` | 模拟 | Mock | 新增 |
| `ruankao.questionBank.originRealDesc` | 收录于真题权威文件或带年份真题 marker | Verified against the authoritative past-paper file | 新增 |
| `ruankao.questionBank.originMockDesc` | 未验证为真题的练习题（含范文标题与模拟题） | Practice questions not verified as past exams | 新增 |
| `ruankao.questionBank.filterAllOrigins` | 全部来源 | All origins | 新增 |
| `ruankao.questionBank.filterReal` | 仅真题 | Past exams only | 新增 |
| `ruankao.questionBank.filterMock` | 仅模拟 | Mock only | 新增 |
| `ruankao.questionBank.detailAction` | 详情 | Details | 新增 |
| `ruankao.questionBank.detailTitle` | 题目详情 | Question details | 新增 |
| `ruankao.questionBank.detailSourceLabel` | 来源 | Sources | 新增 |
| `ruankao.questionBank.detailNoPromptText` | 种子未含该问原文，可按题目标题直接开练 | No prompt text in the seed; train from the title directly | 新增 |
| `ruankao.questionBank.actionDecode` | 拆题·论点矩阵 | Decode · argument matrix | 新增 |
| `ruankao.questionBank.actionQ2` | 问题2·技术方法要点 | Q2 · method points | 新增 |
| `ruankao.questionBank.actionArguments` | 论点区·两段提纲 | Arguments · two outlines | 新增 |
| `ruankao.questionBank.actionFullEssayRead` | **阅读对应文章** | Read the source article | 新增（文案较 PRD 泛化：目标可能是范文或真题 md 合集，裁决 #3） |
| `ruankao.questionBank.actionFullEssayGenerate` | 生成整篇练习文 | Generate a full practice essay | 新增 |
| `ruankao.questionBank.handoffReady` | 已打开教练对话并预填——确认发送即开始（项目环境与教练已自动选好） | Coach chat opened and prefilled — hit send to start (agent and project env preselected) | 新增 |
| `ruankao.questionBank.handoffNoNotebook` | 还没有笔记本，请先创建一个再使用教练动作 | No notebook yet — create one first | 新增 |
| `ruankao.questionBank.wizardSeedReady` | 已打开 AI 模拟向导并带入题目关键词（完整生成约 10 分钟） | Mock wizard opened with this question's keywords (full generation takes ~10 min) | 新增 |
| `ruankao.tabs.questionBank` | 论文题库 | Question Bank | **修改** |
| `ruankao.questionBank.title` | 论文题库 | Question Bank | **修改** |
| `ruankao.questionBank.desc` | 历年真题与精选模拟题：筛选练过、点开题目即可拆题、生成问题2要点与论点区提纲 | Past exams and curated mocks: filter, mark practiced, decode any question, draft Q2 points and argument outlines | **修改** |
| `ruankao.questionBank.sampleBadge` | — | — | **退役**（连同 PRESET_QUESTIONS；退役后全仓 grep 零命中） |

不进 i18n：A/B/C 的 handoff 预填文本（消费方是中文教练智能体，`COACH_GUIDE_LINE` 先例固定中文）、`originNote`（中文数据字段）。

### 5.2 W 线（新增 17，全挂 `ruankao.essay.write.*`）

| 键 | zh-CN |
|---|---|
| `sectionAbstractName` / `sectionBackgroundName` / `sectionQ2Name` / `sectionArgumentsName` / `sectionClosingName` | 摘要 / 项目背景 / 问题2·技术方法说明 / 论点区 / 结尾（纯段名；**旧五键 `sectionAbstract`~`sectionClosing` 原样保留**） |
| `targetRange` | {{min}}~{{max}} 字（数字来自代码常量，不写死 i18n） |
| `legendCount` | {{name}} {{count}}/{{target}} |
| `legendUnder` / `legendNear` / `legendOver` | 未达 / 偏多 / 超 {{count}} 字 |
| `bodyThin` / `bodyNear` / `bodyAtCap` | 正文偏薄（建议 2000~2500）/ 接近硬上限 / 已达硬上限 |
| `completeness` | 论文完整度：{{met}}/{{total}} 段达标 |
| `percentOfTotal` | 占全文 {{percent}}% |
| `capacityTitle` / `capacityAria` | 论文容量 / 论文容量：各段字数与达标状态 |

复用不改：`bodyTotal`、`overLimit`、`underFloor`、`countLabel`。

### 5.3 I 线（新增 3，挂 `ruankao.industry.*`）

`profileFormsLine`（常见项目形态：{{items}}）、`profileTechLine`（典型技术栈：{{items}}）、`profileFlowsLine`（核心业务流程：{{items}}）。**profile 本体不进 14 语种**（R2：中文语料喂中文论文管线，hint 同先例）；`{{items}}` 为前端 join 后的串，分隔符随 join 传入。

### 5.4 D 线（新增 1 + 复用 4）

新增 `sources.grouping.folderNoDiskPath`：zh「文件夹只存在于应用内，没有磁盘绝对路径，可复制相对路径」（置灰项 title + aria-label）。复用：`sources.copyFileName` / `copyRelativePath` / `copyAbsolutePath` / `copiedToClipboard`（14 locale 已有，裁决 #15 不加文件夹变体键）。

### 5.5 汇总与写入约定

**合计：新增 40 键 ×14 locale = 560 条；修改 3 键 ×14；退役 1 键 ×14。**

1. zh-CN 与 en-US 必须人工翻译（NEW_KEYS 机制要求两 locale 必有，new-keys.test.ts:9-15 实读确认）；zh-TW 从 zh-CN 繁化校对；ja-JP 人工；其余 9 locale 给出落地译文（非 fallback 占位）。
2. 每线只写自己 section（4.2 约定 1）；新增键放 section 尾部。
3. `new-keys.test.ts`：四线各自 `const <X>_KEYS` + describe.each 条目（4.2 约定 2）；I 线沿用 `INDUSTRY_HINT_KEYS` 钉扎 + describe.each 契约模式（new-keys.test.ts:1532-1550 先例）。
4. handoff 文本、profile/hint 本体、originNote、COACH_GUIDE_LINE 一律不进 i18n。
5. 门禁：`npm run test -- new-keys` 全绿；退役键全仓 grep 零命中。

---

## ⑥ 每线验收标准与测试清单

### Q 线

测试文件：`frontend/src/lib/ruankao/question-bank.test.ts`（新增：v2 读/迁移/合并/practicedOverrides 覆写/坏数据宽容/排序比较器）、`QuestionBankPanel.test.tsx`（扩展：互斥 badge testid `ruankao-qbank-origin-real|mock`、origin 筛选三态、种子练过翻转、详情弹窗三 handoff 载荷断言、D①/D② 分支按钮、wizardSeed 写入与一次性消费）、`CreateEnvWizard.test.tsx`（扩展既有 preset seed describe（:317 起）：keywords-only preset 不触碰 industry 受控输入、keywords/name 预填生效、industry 优先级 preset > localStorage 维持——现有 :324/:336 用例零改动通过）、`page.test.tsx`（改名后 tab 文案 + `?tab=questionBank` 深链 + tab 同步 effect）。

验收（节选，全量以 PRD1 §7 为准并叠加本稿裁决）：
- [ ] tab 栏与面板 h2 显示「论文题库」；`page.test.tsx` 既有断言零改动通过。
- [ ] `SEED_QUESTIONS.length ∈ [100,150]`，real ∈ [35,60]；脚本重跑两次 diff 为空；真题 md 52 结构化+2025 简记全在；`论文常用知识/论文组件` 不在；论微服务架构及其应用仅一条且 mock 且 sourceRefs 含希赛 sourceId。
- [ ] 旧 v1 数据升级可见（预置 v1 → origin=mock + originNote='v1 自录迁移'）。
- [ ] A/B/C 各写 `ruankao.coachHandoff.v1`（text 含题面+对应引导行）且**不自动发送**；D① 落 `/ruankao?tab=essay&read=<sourceId>` 且红线徽标显示（同页跳转依赖 W 的 read effect）；D② 切 tab 开向导 keywords 预填、种子即焚。
- [ ] `npm run lint / test / build` 全绿；13 non-zh locale + zh-CN 键完整。

### W 线

测试文件：`essay-guardrails.test.ts`（新增：基准表形状、sectionState 四态边界（399/400/600/700 等）、bodyState 梯度（1999/2000/2399/2400/2499/2500/2600）、capacityPercent、essayCompleteness）、`EssayPanel.test.tsx`（扩展：恰好态不误报（摘要 300 → 无 destructive/warn、填充 `bg-teal`）、未达/超限、总量梯度四态、占比数学（五泳道 flexBasis 和=100%、aria-valuenow/max）、完整度 3/5 与 chips、`?read=` 同步 effect；零回归：autosave debounce、发教练预填、固定件生成确认、草稿 CRUD、`ruankao.essayDrafts.v1` JSON 逐字节不变）。

验收：PRD2 §9 全部 9 条沿用；叠加——旧守卫行为逐字节不变（guardQ2(600)='ok' 回归断言）、guardBody(2500)='over'（裁决 #9）、`/dev/design` 页面输出字节不变、无裸调色板类（仅 §2.3 段色 token）。

### I 线

测试文件：`industry-pool.test.ts`（A1 键⊆池 names、A2 形状 2~4/3~6/3~5、单条 1~25 code points、无空白条目）、`tests/test_industry_pool_parity.py`（A3 双镜像键集相等+三数组映射逐字相等+既有 79 用例零退化）、`tests/test_project_env_prompts.py`（A4 5 模板×有 profile 渲染 3 行且条目逐字在位；A5 profile=None 与剥离模板逐字节一致（含池内 hint-only 行业）；A6 五主链 captured 断言 + generic_paragraph/fixed_parts captured 无 industry_profile 键）、`IndustryPoolPanel.test.tsx`/IndustryCombobox（A7 有 profile 5 行 title / 无 profile 与现断言一致；t() 局部覆盖 stub 白名单加 3 新键）、A8 红线校验器对最终落盘数据全绿（**运行输出随 PR 附贴，证据=已运行**）。

全量门禁：`uv run ruff check .` / `uv run ruff format --check .` / `uv run python -m mypy .` / `uv run pytest tests/`；frontend 三连。

### D 线

测试文件：`SourceContextMenu.test.tsx`（未传回调三项不渲染 / 传入渲染且各触发一次 / disableCopyAbsolutePath 仅该项 data-disabled）、`GeminiSourcesColumn.test.tsx`（文件夹行右键三项出现 / 名称=夹名+success toast / 三层嵌套相对路径 `一级/二级/三级`、根级=自身名 / 绝对路径置灰点击后 mockClipboardWrite 未调用 / 既有来源侧复制用例 ：496-713 零改动通过）。

验收：PRD4 §7 全部 12 条沿用；叠加裁决 #14/#15/#16 的落点（不铺 classic 页、复用 copyFileName、置灰态维持）。

### 跨线总门禁（每线合入前必跑）

- frontend/：`npm run lint`、`npm run test`、`npm run build`
- 仓库根：`uv run pytest tests/`（Q/W/D 纯前端预期零波及，跑一次确认；I 线为硬门禁）
- CHANGELOG：各线条目进 `## [Unreleased]` 对应既有小节，不建重复节
- new-keys 全绿；退役键 grep 零命中（Q 线）

---

## ⑦ 红线小节与 ADR 建议

### 7.1 三条红线（原文照抄，四线全部受约束）

**红线一：范文红线隔离（ADR-017，Accepted）**——范文正文绝不进任何 AI 生成语境：

> "The only sanctioned exception channels are single-source chat (`build_source_context`, the user explicitly opens that essay) and reading a source by id (`get_essay_full_text` / `GET /api/sources/{id}`) for the essay reading mode and the future similarity check."（ADR-017-model-essay-mark-red-line-isolation.md，本会话实读）

→ 本批落点：Q 动作 D① 是「人眼阅读」走例行通道；A/B/C handoff 文本只含题面；范文正文零进入 AI 语境，三读点过滤不受影响。

**红线二：教练人设（agent-templates.ts `ruankao-essay-coach` systemPrompt，本会话实读原文）**：

> 「绝不用范文/押题论文/教材原文来训练或作答：曝光度高的文字在阅卷时会被判雷同、扣"不真实"帽子，这是不及格红线。」
> 「论点主旨句必须是考生自己的话，不抄任何现成句式模板原文；AI 生成的表述一律要经考生改写消化后才能进考场。」
> 「**正文段必须考生自己写**，你不代写。」（提纲先行步骤原文）

→ 本批落点：Q 动作 A/B/C 只预填不代发（发送键永远在考生手里）；「生成整篇文章」被否决出教练通道（裁决记录见 ①）。

**红线三：离线语料产物准入（PRD3 §5.6 定稿，扩展为两线提取任务模板的公共边界）**：

> 「**产物只能是行业级事实模式，严禁范文句子/论点表述进数据文件。**」（I 线；配套机械校验：≥12 字 n-gram 重叠 / 数字与叙事标记词 / 形状守卫，三查不过不出产物）

> 「（Q 线）产物只允许考试元数据：标题、年份 marker、三问逐字原文、来源引用；背景段叙事与参考解析禁入。」（本稿 ③3.2 定稿）

→ 落点：两份提取脚本内置校验 + 人工评审 gate；校验器运行证据随 PR 附贴。

### 7.2 ADR-020 建议：离线语料提炼的边界（值得立档，给草案要点）

本批两条线同时引入「从用户自有语料经 LLM 离线提炼静态数据集进代码库」的模式，且未来复用面大（扩池、真题年份自查、考点热度榜都可能走同型管线）——提炼什么能进库、什么不能，值得一条 ADR 锁边界。建议文件：`docs/7-DEVELOPMENT/decisions/ADR-020-offline-corpus-distillation.md`（编号未占用，实读 decisions/ 目录确认至 ADR-019）。

**草案要点**：
- **Context**：软考模块两类离线数据生产（题库种子 `question-bank-seeds.gen.ts`、行业画像 `INDUSTRY_PROFILES` 双镜像）都从用户自有语料（范文/真题文件）经 LLM 提炼后提交进库。核心张力：提炼物既是「语料的衍生物」（有抄句子/论点进代码库的红线风险），又是「代码常量」（会随版本发布给所有用户）。
- **Decision**（五条）：
  1. **产物白名单**：只允许「行业级事实模式」与「考试元数据（标题/年份/三问逐字原文/来源引用）」两类；范文原句、论点表述、背景/解析叙事、交付方叙事、效果数据禁入。
  2. **机械红线校验内置**于生成脚本（≥12 字 n-gram 重叠、数字/叙事标记词、形状守卫），校验不过不出产物；运行证据随 PR 附贴。
  3. **人工评审 gate**：生成 diff/聚合评审件逐条过目后才提交；改写与泛化是人的活，脚本不悄悄改。
  4. **生成物提交进库、脚本随仓库保留但不在运行链路**：构建不依赖本地 DB；提炼语料文本本身永不进运行时 AI 语境（ADR-017 过滤不受影响——静态常量不是检索路径）。
  5. **重跑确定性**：种子 id = 规范化输入稳定 hash、SEED_VERSION 单调递增；重跑可修正提取错误而不漂移用户覆写（practicedOverrides 按 id 挂）。
- **Consequences**：数据可审查、可修正、可回滚（.gen.ts 重跑即再生）；每批数据生产付出人审成本（必要）；若未来语料换源（如新增 PDF 集），沿同型管线扩脚本而非开新旁路。
- **Alternatives recorded**：运行时抓取语料（否决：API 可用性耦合首屏 + 违反「考生自持事实数据」定位）；语料入库为数据文件而非代码常量（否决：绕过 code review 的审查面）；LLM 直接产出最终文案（否决：聚合/改写必须确定性可复算，创作环节归人）。

---

## 附：实施期执行清单（本设计稿未跑、实施时必须跑）

1. Q：种子生成脚本实跑两次 + diff 为空验证；真实条数落 [100,150] 区间核验。
2. I：三波 LLM 提炼实跑（W1 20 / W2 25 / W3 22）；红线校验器对最终数据全绿（输出随 PR 附贴）。
3. 每线合入前全量门禁（⑥ 跨线总门禁）。
4. Q×W 交叠验证：W 合入后，Q 动作 D① 同页深链端到端手测（题库详情 → essay read 视图）。
