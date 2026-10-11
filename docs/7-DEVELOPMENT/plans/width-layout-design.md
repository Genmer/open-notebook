# L 线设计定稿：宽屏行布局治理 —— 内容列宽约定 + 题库/模型库紧凑行

- 作者：PM（宽屏行布局）· 设计整合自两份 PRD/终稿
- 日期：2026-10-11（定稿）；2026-10-11（实施，见 §3）
- 状态：已实施（P1 全部落点 + P2 九处容器已上线；P2 backlog 单独立项）
- 来源：2026-10-11 自 gitignore 的 workflow-drafts 定稿迁入（`.zcode/workflow-drafts/prd/width-layout.md` PRD 与 `.zcode/workflow-drafts/ruankao-ux-batch-design.md` §2 L 线终稿合并；草稿本体不入库）。规范落点为 [frontend.md「内容列宽约定」](../frontend.md#content-column-width-convention)；本文是设计依据与落点台账。
- 核实声明：§1 的 `file:line` 为设计会话**改前**实读证据；§3 的实施证据于 2026-10-11 迁入当日对现工作区**实读复核**。

---

## 1. 背景与改前现状

用户诉求（2026-10-11）：论文题库行「左边名称右边操作，屏幕稍微大点每次找对应按钮就很累」，并要求「整个项目也看看怎么优化，很多这种宽度100%的」。

改前核实（设计会话实读，均为**改动前**状态）：

| 事实 | 改前证据 |
|---|---|
| 题库行根两端布局，左簇 `flex-1` 把操作组推到行最右 | `QuestionBankPanel.tsx:518-552` |
| 1920px 视口：主内容 1664px − `p-6` 48px = 1616px 行宽，标题到「详情」水平距离 ≈ 1100~1400px | 距离推导 |
| ruankao/tasks 页容器 `p-6 space-y-6` 无宽度约束；sources 显式 `w-full max-w-none` | `ruankao/page.tsx:34`、`tasks/page.tsx:168`、`sources/page.tsx:855` |
| 同类问题遍及 notebooks 列表、token 用量、settings 子页、podcasts、search | §2.1 P2 清单 |
| 全项目无共享容器组件（grep `PageContainer|ContentContainer|PageColumn|MaxWidthContainer` 零结果）；先例零散（advanced `max-w-4xl mx-auto` 为唯一完整先例） | §2.3 盘点 |
| 测试栈纯 jsdom，无布局断言能力 → 验收只能断言 className 约束，真实像素为手动项 | `frontend/package.json` |

## 2. L 线终稿

### 2.1 内容列宽约定（className 约定，不做共享容器组件）

**裁决：className 约定 + 文档规范，不抽 `PageContainer` 组件**——全项目无共享容器先例，抽组件要求每页改 import + JSX 结构，收益只有拼写一致性，过度抽象。

| 页面类型 | 容器 class | 适用页面清单 |
|---|---|---|
| **列表/表格型（本批治理对象）** | `mx-auto max-w-6xl`（1152px 内容列） | P1：ruankao 页（一处覆盖全部 tab，加 `data-testid="ruankao-page-content"`）、tasks、sources（改后不再含 `max-w-none`）；P2：notebooks 列表、token 用量、settings 子页 models/storage/data、podcasts、search |
| 表单型 | `max-w-4xl`（现状保留，本批不强改） | settings 主页、advanced（`mx-auto` 取自此先例） |
| 工作台/多栏详情 | **不约束** | notebook 三栏工作台、source 详情双栏（依赖宽视口，加约束有害） |

**值为什么是 `max-w-6xl`（1152px）+ `mx-auto` 居中**：下限——sources 表格 8 列（多列带响应式隐藏）在 4xl（896px）会挤压换行、5xl（1024px）对表格仍紧；上限效果——1920px 视口内容列 1152px、两侧各留 ~232px，行内左右距离被容器硬封顶 1152px（改前 1616px）。settings 主页不居中的 `max-w-4xl` 属历史不一致，本批不纠正。

### 2.2 题库/模型库紧凑行结构

**根因**：行左簇 `flex-1` 把操作组推到行最右，1920px 下标题到操作距离 ≈1100-1400px。**裁决：去 `flex-1` 改单流，操作组紧跟内容簇（距离恒定 ≈8px），行根加 `group` 支撑 hover 显隐。**

行结构定稿（全部 `data-testid`/`aria-label` 原名保留）：

```tsx
<div key={q.id} data-testid={`ruankao-qbank-item-${q.id}`}
     className="group flex items-center gap-2 py-2 pl-3 pr-3">
  {/* 内容簇（原左簇去 flex-1 拍平进行根）：origin 徽标 → 年份徽标 → 标题 → 域 chip */}
  {/* 高频三动作常驻：练过 checkbox + 详情 + 复制给教练（ml-2 flex shrink-0 items-center gap-2） */}
  {/* 低频破坏性操作：编辑/删除三通道显隐（见 §2.3 触屏兜底） */}
</div>
```

设计要点：

1. 行根 `group` + 单流三层（内容 → 高频操作 → hover 操作），行右侧留白；
2. 标题 `min-w-0 max-w-md truncate text-sm font-medium lg:max-w-lg`：截断封顶 + 给「标题到详情按钮距离」结构上限 ≈ **≤720px**（512px 标题 + ~180px 徽标簇 + gap/ml），与视口宽度无关；
3. 高频三动作**常驻不藏**（考生每行都可能点，hover 收起与「复制给教练」高频定位矛盾）；编辑/删除 hover 显示降噪；
4. 行高密度对齐 agents 先例（`AgentsList.tsx` `px-3 py-2`）：只动水平结构，行高 `py-2`、`text-sm`、`size="sm"` 全部不变；
5. **同款机械套用 `ModelLibraryPanel.tsx`**（改前 grep 实证与题库完全同款行结构；模型库行单流后阅读/标记按钮紧跟内容）。

### 2.3 P1/P2 分级落地范围与触屏兜底裁决

**P1（本批必做）：**

| # | 改动 | 文件 |
|---|---|---|
| P1-1 | ruankao 页容器 +`mx-auto max-w-6xl`，加 `data-testid="ruankao-page-content"` | `ruankao/page.tsx` |
| P1-2 | 题库行重设计（§2.2 全结构） | `QuestionBankPanel.tsx` |
| P1-3 | 模型库同款行机械套用 | `ModelLibraryPanel.tsx` |
| P1-4 | tasks 页容器 | `tasks/page.tsx` |
| P1-5 | sources 容器 `w-full max-w-none` → `mx-auto w-full max-w-6xl`（保留 `flex flex-col h-full`） | `sources/page.tsx` |
| P1-6 | 约定写入 `docs/7-DEVELOPMENT/frontend.md` 新小节 + CHANGELOG `### Changed` | 文档 |

**P2（同批顺手，各一行 className，不逐一细设计）**：notebooks 列表、token 用量、settings 子页 ×3、podcasts、search（清单见 §2.1 表）。

**P2 backlog（本批禁改，单独立项）**：agents 多列网格与 max-w 叠加（网格策略与列宽约定需一起重设计）、transformations 双层容器（页级全宽 + 内层 5xl 语义待理清）、TaskRow 行内结构（容器收敛后观察再推广）、notebooks 列表卡片本体。

**触屏兜底裁决**：编辑/删除 hover 组追加 **`pointer-coarse:opacity-100`**（无 hover 设备常驻显示），`focus-within:opacity-100` 兜键盘可达性。不在详情弹窗补编辑/删除入口（弹窗由 G 线改造为工作台，不混入扩大 diff）。

**回滚**：无共享组件 → 可逐页回退（sources 挤压不可接受时单回 P1-5）。

## 3. 实施记录（2026-10-11，迁入当日对现工作区实读复核）

- **P1-1/P1-4/P1-5**：`ruankao/page.tsx:35`、`tasks/page.tsx:169` 为 `mx-auto max-w-6xl p-6 space-y-6`（前者带 `ruankao-page-content`，后者带 `tasks-page-content`）；`sources/page.tsx:856` 为 `flex flex-col h-full mx-auto w-full max-w-6xl px-6 py-6`（带 `sources-page-content`，无 `max-w-none`）。
- **P1-2/P1-3**：`QuestionBankPanel.tsx:921` 行根 `group flex items-center gap-2 py-2 pl-3 pr-3`，`:996` hover 组 `opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100`；`ModelLibraryPanel.tsx:109` 同款单流行 + `:117` 标题 `min-w-0 max-w-md truncate text-sm font-medium lg:max-w-lg`。
- **P2 九处**：`notebooks/page.tsx:57`、`settings/usage/page.tsx:158`、`settings/models/page.tsx:91`、`settings/storage/page.tsx:101`、`settings/data/page.tsx:16`、`podcasts/page.tsx:30`、`search/page.tsx:166` 均已带 `mx-auto max-w-6xl`。
- **P1-6**：frontend.md「Content column width convention」小节已落（覆盖全部 **10 个页面**——P1 三页 + P2 七页合并且超额：设计清单 P1 仅点名 ruankao/tasks/sources 三页，实施将 P2 七页一并落地并写入规范）；CHANGELOG `### Changed` 条目同批补齐。
- **P2 backlog 未动**（agents / transformations / TaskRow 行内 / notebooks 卡片本体），维持 §2.3 禁改裁决。

## 4. 验收标准

测试栈为 jsdom，测不了真实像素布局 → 布局类断言全部落在 className 约束上；真实距离为手动验证项，不阻塞 CI。

**A. 自动断言（vitest + testing-library）**

- **A1 容器约束**：ruankao/tasks/sources 页容器 className 同时含 `max-w-6xl` 与 `mx-auto`（sources 断言不再含 `max-w-none`）→ `ruankao/page.test.tsx`、`tasks/page.test.tsx`、`sources/page.test.tsx`。
- **A2 行结构去两端化**：`ruankao-qbank-item-*` 行根含 `group`、不含 `justify-between`、无 `flex-1` 内容簇 → `QuestionBankPanel.test.tsx`。
- **A3 标题截断约束**：行内标题 class 含 `truncate` 与 `max-w-md`/`lg:max-w-lg`。
- **A4 hover 操作组**：user 条目行编辑/删除容器含 `opacity-0`/`group-hover:opacity-100`/`focus-within:opacity-100`；种子条目行不渲染该组。
- **A5 交互回归**：既有 `QuestionBankPanel.test.tsx`、`ModelLibraryPanel.test.tsx` 全部用例不改一行通过（testid/aria 均不变）→ 模型库同款断言在 `ModelLibraryPanel.test.tsx`（宽屏治理 P1-3 用例）。

**B. className 推导上限（jsdom 不可测）**：标题到「详情」水平距离 ≤ `max-w-lg`(512px) + 徽标簇(~180px) + gap/ml ≈ **≤720px**（改前 ≈1100~1400px），由 A2+A3 的 className 约束在结构上强制。

**C. 手动验证项（不阻塞 CI）**：C1 1920px 下题库行标题到「详情」≤720px、容器两侧各 ~232px；C2 sources 表格 1152px 内可见列不挤压；C3 hover/键盘 `focus-within`/触屏 `pointer-coarse` 三通道显隐目检。

**D. 门禁**：`cd frontend && npm run lint && npm run test && npm run build`；无新增 i18n 键（hover 组复用既有 aria-label）；CHANGELOG `### Changed` 一条。

## 5. 非目标

- 不做共享 `PageContainer` 组件（§2.1 已裁决）；
- 不改 agents 多列网格、transformations 双层容器、notebook 三栏工作台（backlog/排除）;
- 不改 TaskRow 行内结构（P1 只动容器）；
- 不动表单页与弹窗内布局；
- 不引入响应式断点调整或 `3xl` 断点变更；
- 无任何后端/API/存储改动（localStorage `ruankao.questions.v2`、排序、过滤、教练载荷零改动）。

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| sources 表格在 1152px 内挤压（C2 不达标） | 回滚 P1-5 单条（各页独立 class，无共享组件 → 可逐页回退） |
| 编辑/删除 hover 在触屏不可达 | `pointer-coarse:opacity-100` 常驻 + `focus-within` 兜键盘；实机反馈仍不可用再立项 |
| 现有测试断言依赖行内 DOM 层级 | 全部 testid/aria 原样保留（§4-A5 作为回归门禁） |
