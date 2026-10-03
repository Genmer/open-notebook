# 来源标注系统 MVP 任务清单

> 上游文档：[来源标注系统产品规划（已裁决定稿）](source-annotation-plan.md)（下称「规划」，§7 MVP 为范围基线）；裁决依据：[PDR-003](../decisions/PDR-003-source-annotation-system.md)（下称「裁决 N」指其第 N 项裁决）。任务粒度到可指派：每任务含范围 / 涉及文件（精确路径，新文件标注【新增】）/ 可测试验收标准 / 预估（人日）。
>
> **标称对账（裁决 3）**：前端 F1-F11 合计 **10-11 人日**，后端 B1-B6 合计 **3-4.5 人日**；分项与任务对应见 §4。spike 走换范围分支时按规划 §5.6 重排 +3-5 人日。

## 0. 全局门禁（每任务的完成定义）

- **后端任务**：`ruff check . --fix` 与 `uv run python -m mypy .` 通过；涉及命令注册的需重启 worker（`make worker-start`）验证。
- **前端任务**：`frontend/` 内 `npm run lint` 与 `npm run test` 通过。
- **i18n**：新 UI 文案键同 PR 落全部 **14 locale**（清单见 §5），否则 parity/unused-key 测试与 `tsc` 双红。
- **迁移**：一 PR 一迁移（ADR-006）；迁移文件手动注册进 `open_notebook/database/async_migrate.py`，启动日志确认自动执行。
- **补验截止门（裁决 1）**：真实真题册（文件不可得时 ≥100 页文本 PDF 顶替判据，但截止门不豁免）上的 spike 判定与验收①未补跑前，**MVP 不得标记完成**。
- **数据完整性测试不可压缩（裁决 3）**：export→import round-trip、备份结构校验、坐标换算纯函数边界、last-write-wins 语义四类测试任何排期压缩下都不动。

## 1. 前端任务（F1-F11，合计 10-11 人日）

### F1 · TextLayer spike：路径裁定 + 文件性质抽样 + 两项复测 + SurrealDB 断言（1 人日）

- **范围**：在真实 611 页真题册（或 ≥100 页文本 PDF 替代）上完成规划 §5.6 的四组验证并**出路径裁定**（划词主路径 vs 换范围分支）。这是 F2-F7 的闸门任务。
- **涉及文件**：`frontend/src/components/sources/PdfSourceViewer.tsx`（临时实验分支，产出可丢弃）；`frontend/src/lib/pdf/pdf-utils.ts`（复用 `extractPagesText` :120-157、只读参考）；裁定记录 = 实现 PR 的描述 + 本文件 §6 的裁定结论回填；SurrealDB 断言用临时脚本（连本地 SurrealDB 执行后丢弃，不入库）。
- **验收标准**：
  1. §5.6 三条技术判据逐项记录通过/失败与实测数据（文本层偏差 px 数、三浏览器 Range→item 映射结果、单页构建+首帧 ms）；
  2. 12 页均匀抽样 `getTextContent` 非空占比数字 + 三分支判定结论（<20% / 20%-80% / ≥80%，裁决 1）；
  3. WCAG PDF 白页对比度复测数值（亮色 token 对白页 ≥3:1 与否，规划 §4.2）；
  4. 坐标往返换算复测（viewport→user space→viewport 误差记录，规划 §5.3）；
  5. SurrealDB 嵌套字段索引/ORDER BY 断言结论（只影响平铺字段可否简化，不影响交付，规划 §8#16）；
  6. 裁定结论写入 PR 描述：主路径 or 换范围（换范围则 F2 变更为框选集成、重排 +3-5 人日、TextLayer 整体移 P1）。
- **预估**：1。

### F2 · 裸 canvas 改 relative wrapper + TextLayer 集成（1 人日）

- **范围**：`PdfSourceViewer.tsx:492-497` 裸 canvas 外包 relative wrapper；叠加 pdf.js TextLayer（pdfjs-dist 内置）；页级路由表（有文本层页 → 划词浮条挂载点；无文本层页 → F8 提示条挂载点，裁决 1）。
- **涉及文件**：`frontend/src/components/sources/PdfSourceViewer.tsx`（改）；`frontend/src/app/globals.css`（改：摘约百行官方 `.textLayer` CSS，仓库现无）；`frontend/src/components/sources/annotations/TextLayer.tsx`【新增】。
- **验收标准**（= §5.6 判据 1-3 通过的工程化确认）：①文本 div 与 canvas 恒定偏差 ≤2px；②缩放走 `update({viewport})` 原地重排且容器设 `--total-scale-factor`；③单页 TextLayer 构建+首帧 <500ms；④`npm run test`/`npm run lint` 绿。
- **预估**：1。

### F3 · 选区→锚点换算纯函数 + vitest（2 人日）

- **范围**：视口坐标 ↔ PDF user space ↔ text item 三向换算；双 viewport 陷阱封装（渲染 viewport 含 dpr、DOM 换算用不含 dpr 的第二 viewport，规划 §5.3）；选区 Range → quads + quote 提取。
- **涉及文件**：`frontend/src/lib/pdf/annotation-anchor.ts`【新增】（纯函数，无 React 依赖）；`frontend/src/lib/pdf/annotation-anchor.test.ts`【新增】。
- **验收标准**：vitest 断言：①7 档缩放（0.6-2.5）往返换算误差 ≤1px（整数像素场景为 0）；②dpr=2 下 DOM 层换算走不含 dpr 的 viewport；③mock text item 的选区 → quads 计算与 quote 拼接正确；④该测试即 MVP 验收③「缩放往返零漂移」的判定载体。
- **预估**：2。

### F4 · SVG 标注 overlay（1.5 人日）

- **范围**：wrapper 内 `<svg absolute inset-0 pointer-events-none>`，viewBox 直接采用 user space（仅一次 y 翻转）；波浪/直线 path 生成（λ=8/A=1.75，`vector-effect="non-scaling-stroke"` 1.5px）；荧光洗底；选中态。§4.3 备选「缩放时重生成 path」仅在裁决 11 判据触发时实现（不加预算）。
- **涉及文件**：`frontend/src/components/sources/annotations/AnnotationSvgOverlay.tsx`【新增】；`frontend/src/app/globals.css`（改：`--anno-*-ink/-paper/-wash` token）。
- **验收标准**：①vitest 快照：给定 quads+viewport 输出 path d 与 fill；②缩放往返后渲染位置由 F3 纯函数保证零漂移；③裁决 11 判据执行记录（2.5x 档 vs 1x 档截图对比，触发与否留档）。
- **预估**：1.5。

### F5 · 选区浮条（1 人日）

- **范围**：8 键浮条 `[●●●●● 色点] │ [〰/— 线型] │ [批注] │ [复制]`，h-9；`position: fixed` + `Range.getBoundingClientRect()`；150ms 淡入；上方不足翻转下方；状态机 A（含滚动停止 150ms 防抖重现，规划 §3.1/§3.4-A）；点色点一步落标（乐观本地落标、队列串行提交）。
- **涉及文件**：`frontend/src/components/sources/annotations/SelectionToolbar.tsx`【新增】；`frontend/src/components/sources/PdfSourceViewer.tsx`（改：挂载）。
- **验收标准**（vitest + RTL）：①mouseup 非折叠选区 → 150ms 后 visible；②Esc / 空白点击 / 新选区 → hidden；③滚动停止 150ms 且选区存续 → 新包围盒位置重现；④选区在视口下缘时翻转到下方；⑤点色点后工具条立即消失、不阻塞下一次划选。
- **预估**：1。

### F6 · hover 批注卡 + pin 编辑态（0.5 人日）

- **范围**：Radix Popover 受控模式；自研延时（开 150ms/容留 300ms，调参区间 100-400ms，裁决 10）；无 body 纯划线只显色点放大；pin 编辑态（body 文本域 + 色点行 + 线型 toggle；MVP 固定 hover 卡无位置选择）；单条删除无确认 + toast 撤销 8s（规划 §3.2）。批注卡读色语义名（annotation_settings 端点，localStorage 缓存）。
- **涉及文件**：`frontend/src/components/sources/annotations/AnnotationHoverCard.tsx`【新增】；`frontend/src/lib/api/source-annotations.ts`【新增】（API client：CRUD + settings，模式参照 `frontend/src/lib/api/source-analysis.ts`）。
- **验收标准**：①指针移入卡片不消失（300ms 容留）；②pin 态改色即时生效、Esc 无改动收起/有改动先保存；③删除后 toast 内撤销恢复单条；④卡片结构符合 §4.4 规格（z-50 w-80 shadow-pop、色脊线、mono 元信息）。
- **预估**：0.5。

### F7 · 按页懒加载 + memo（0.5-0.75 人日）

- **范围**：`GET /api/source-annotations?source_id=&page=` 按页拉取（当前页 ± 缓冲页）；标注索引 memo 化（611 页 full_text 百万字符级不逐 render 重扫）；page > pageCount 的 O(1) 轻量提示（裁决 16：「源文件已变更，重新框选将于下期可用」）。
- **涉及文件**：`frontend/src/lib/hooks/use-annotations.ts`【新增】（模式参照 `frontend/src/lib/hooks/use-section-analysis.ts`）；`frontend/src/lib/api/source-annotations.ts`（F6 已建，此处补分页参数）；`frontend/src/components/sources/PdfSourceViewer.tsx`（改：接线）。
- **验收标准**：①vitest：翻页只触发当前页±缓冲的请求；②同一 render 周期标注索引计算次数为 1（memo 生效）；③构造 page 超界数据渲染出提示文案。
- **预估**：0.5-0.75。

### F8 · 扫描页 inline 提示条（页级路由入口，0.25 人日）

- **范围**：当前页 `getTextContent` 为空 → 工具栏下方 inline 常驻提示条「此页无文本层（扫描页）：文字划线不可用，框选批注将在下一期支持」（`role="status"`，非 toast）；有文本层页不出。**分支条件（2026-10-03 独立复核补）：仅在划词主路径分支渲染——F1 裁定为换范围（12 页抽样 <20% 文本页）时本组件不渲染**：该分支下矩形框选就是当期 MVP 主路径（规划 §5.6），提示文案「下一期支持」对当期可用功能说假话（规划 §3.1 分支条件）。
- **涉及文件**：`frontend/src/components/sources/annotations/ScanPageNotice.tsx`【新增】；`frontend/src/components/sources/PdfSourceViewer.tsx`（改：按页路由挂载）。
- **验收标准**：①vitest：mock 空文本层页显示提示、非空页不显示；②提示条不随划词动作反复出现（常驻）；③文案键进 14 locale；④F1 裁定 = 换范围分支时，本组件零渲染（与 §6 裁定结论联动的分支断言）。
- **预估**：0.25。

### F9 · 删除源确认对话框标注计数（0.25-0.5 人日）

- **范围**：删除源确认对话框显示「将连带删除 N 条标注…」并要求二次确认（规划 §1.2 资产防护①；N 在对话框打开时按源取计数——MVP 口径走按源查询计数，列表级 annotations_count 子查询是 P2 角标任务）。
- **涉及文件**：`frontend/src/app/(dashboard)/sources/page.tsx`（改：`:1164-1174` ConfirmDialog 增加标注计数行与确认文案）；`frontend/src/lib/api/source-annotations.ts`（改：计数获取）。
- **验收标准**：①打开删除确认即显示该源标注数（mock 计数断言文案）；②零标注源不显示标注行；③文案键进 14 locale。
- **预估**：0.25-0.5。

### F10 · i18n：键名一次定稿 + 14 locale 同 PR（1-1.5 人日）

- **范围**：本 MVP 全部新键（浮条 aria、扫描页提示、删除确认、批注卡、错误 toast 等）**一次定稿命名**（建议 `sources.annotations.*` 命名空间），同一 PR 落全部 14 locale；en-US 为参照，其余 `satisfies TranslationShape`；`new-keys.test.ts` 按批次固化新键清单。**分支联动（2026-10-03 独立复核补）：扫描页提示键仅划词主路径分支使用（F8 分支条件），键名仍单版本定稿；若 F1 裁定换范围分支，未用键（提示条、[复制] 等，见 §6.1 对照表）不进 locale——砍功能同步删键惯例（§5），不留两分支双版本键。**
- **涉及文件**：`frontend/src/lib/locales/en-US/index.ts`（改）与其余 13 个（全改）：`bn-IN`、`ca-ES`、`de-DE`、`es-ES`、`fr-FR`、`it-IT`、`ja-JP`、`pl-PL`、`pt-BR`、`ru-RU`、`tr-TR`、`zh-CN`、`zh-TW`（路径均为 `frontend/src/lib/locales/<locale>/index.ts`）；`frontend/src/lib/locales/new-keys.test.ts`（改：本批键清单）。
- **验收标准**：①`npm run test` 含 parity（`frontend/src/lib/locales/index.test.ts:55-66`）与 unused key（`:123-160`）全绿；②`npm run build`（tsc）绿（缺键/多键挂编译）；③MVP 期内无后续键名改名 PR。
- **预估**：1-1.5。

### F11 · vitest 集成测试（1 人日）

- **范围**：MVP 端到端集成测试（mock API）：划词 → 落标 → 重新渲染仍显示（持久化）；hover → 卡片 → pin 编辑；懒加载翻页；F3 纯函数边界用例（含 5000 字符上限拒绝落标）。
- **涉及文件**：`frontend/src/components/sources/annotations/__tests__/annotations-flow.test.tsx`【新增】；`frontend/src/lib/pdf/annotation-anchor.test.ts`（F3 已建，此处补边界）。
- **验收标准**：`npm run test` 全绿且既有测试零回归（MVP 验收④ 的前端半边）。
- **预估**：1。

## 2. 后端任务（B1-B6，合计 3-4.5 人日）

### B1 · 迁移 33 + 双列表注册（0.5 人日）

- **范围**：建 `source_annotation`（SCHEMAFULL，字段/索引/清理 EVENT 见规划 §5.1 SQL）与 `annotation_settings`（SCHEMALESS 单例）；up/down 两个迁移文件；注册进 async_migrate 的 up/down 列表（当前到 32，已核实）。
- **涉及文件**：`open_notebook/database/migrations/33.surrealql`【新增】；`open_notebook/database/migrations/33_down.surrealql`【新增】；`open_notebook/database/async_migrate.py`（改：两处列表）。
- **验收标准**：①`make api` 启动日志显示迁移执行且无错误；②created/updated 不写 TYPE，写法照抄 `1.surrealql:13-14` / `29.surrealql:8-9`（已核实先例）；③down 文件按 REMOVE EVENT → REMOVE 两张表顺序（同 29_down）；④一 PR 一迁移（ADR-006）。
- **预估**：0.5。

### B2 · 域模型（0.5-0.75 人日）

- **范围**：SourceAnnotation 域模型 + `TextAnchor`/`PdfAnchor`/`PdfQuad` 嵌套 pydantic；record 字段 field_validator；`get_for_source(source_id, page=None)`；校验：至少一种锚、display_position 非 NULL 时需 body（裁决 9 口径）、body ≤4000、quote ≤5000。备份快照构造（id/title/url/created/page_count + 全量标注，供 P2 导入预检，裁决 6/8）。**page_count 取值口径（2026-10-03 独立复核定死）：Source 资产无页数字段（`Asset` 仅 file_path/url，`open_notebook/domain/notebook.py:345-347`；`page_count` 在 open_notebook/api/commands 全仓 Python 零命中，本会话 grep 复核），故 page_count = 全量标注 max(page)+1（「标注覆盖页数下界」，611 页册只标到 P100 记 101），JSON 以 `page_count_basis: "max_annotated_page_plus_one"` 注明口径，仅作预检粗筛臂（主判据 = quote 抽检，见 B5/规划 §6.3）——不存在「源资产页数」可优先，不得按原表述寻找该数据源。**
- **涉及文件**：`open_notebook/domain/source_annotation.py`【新增】（模式参照 `open_notebook/domain/source_grouping.py`、`open_notebook/domain/notebook.py:374-401`）。
- **验收标准**：①`uv run python -m mypy .` 与 `ruff check .` 绿；②校验规则以 pytest 直测（并入 B6 用例）；③`page > pageCount` 平铺字段可供前端 O(1) 判定；④备份快照的 page_count 按 max(page)+1 口径产出并带 `page_count_basis` 字段。
- **预估**：0.5-0.75。

### B3 · CRUD + settings 路由 + 注册（1 人日）

- **范围**：五个端点（规划 §5.2 表）；异常映射 InvalidInputError→400 / NotFoundError→404；创建校验 source 存在与长度上限；**MVP 期 POST/PUT 对 display_position 一律服务端归一化为 NULL 持久化（裁决 9；请求携带非 NULL 值时置 NULL 而非报错，归一化先于「非 NULL 需 body」校验——2026-10-03 独立复核补：MVP 前端无位置选择器不会发该字段，此为公开 API 端点的确定语义，消除「接受/强制/拒绝」三态留白；P1 位置选项交付后归一化撤销）**；PUT 刷 updated（last-write-wins）；不走 surreal-commands 队列。
- **涉及文件**：`api/routers/source_annotations.py`【新增】（模式参照 `api/routers/notes.py:17-60`）；`api/models.py`（改：SourceAnnotationCreate/Update/Response + AnnotationSettings 模型，NoteCreate 先例 :269）；`api/main.py`（改：`:404-442` 注册区）。
- **验收标准**：①pytest：CRUD 五端点 + settings GET/PUT 全通过；②POST/PUT 携带非 NULL display_position（无论有无 body）→ 持久化记录该字段为 NULL，响应不 400（归一化生效断言）；③body >4000 / quote >5000 → 400；④PUT 后 updated 变化；⑤`/api` OpenAPI 文档出现新端点。
- **预估**：1。

### B4 · 四处导出注册（0.25 人日）

- **范围**：同 PR 完成四处注册（缺一即击穿导入恢复，规划 §1.2 裁决）：DATA_TABLES、TABLE_FIELDS 字段清单、RECORD_FIELDS `"source_annotation": {"source"}`、CONFIG_TABLES 加 annotation_settings。
- **涉及文件**：`commands/data_transfer_commands.py`（改：`:93` DATA_TABLES、`:150` TABLE_FIELDS、`:258` RECORD_FIELDS、`:106` CONFIG_TABLES，行号为本会话核实值）。
- **验收标准**：①导出包 manifest 计数含 source_annotation 与 annotation_settings；②round-trip pytest（B6）通过——导入后 source 字段为 record 链接类型而非字符串（MVP 验收⑤）。
- **预估**：0.25。

### B5 · 源删除备份 JSON（0.25-0.5 人日）

- **范围**：备份钩子挂 `Source.delete()` 内、`super().delete()` 之前（`open_notebook/domain/notebook.py:738-783`，`:769` 注释明示 group cascade / notebook exclusive delete 绕过 API 端点清扫——**不得实现在 API 路由层**，裁决 8）；无标注跳过；文件名 `annotations-backup_{sourceId}_{YYYYMMDD-HHmmss}.json` 落 EXPORTS_FOLDER（`commands/data_transfer_commands.py:87`）；JSON = source 元数据快照 + 全量标注，格式与 P2 JSON 导入器兼容（裁决 6；page_count = max(page)+1 口径见 B2）。
- **涉及文件**：`open_notebook/domain/notebook.py`（改：delete() 内挂钩子）；`open_notebook/domain/source_annotation.py`（改：备份快照序列化类方法）。
- **验收标准**：①pytest：API DELETE 删除源后备份 JSON 出现且结构完整（快照 + 全量标注 + 条数一致）——MVP 验收⑥；②经 notebook 独占删除路径删除同样产出备份（覆盖级联绕过面）；③零标注源不产生备份文件。
- **预估**：0.25-0.5。

### B6 · pytest（0.5-1.5 人日）

- **范围**：新 API 测试文件（CRUD、settings、校验上限、last-write-wins）；数据完整性测试扩展（round-trip + 备份结构校验——**任何排期压缩下不可动**，裁决 3）。
- **涉及文件**：`tests/test_source_annotations_api.py`【新增】（命名参照 `tests/test_source_analysis_api.py`）；`tests/test_data_transfer_commands.py`（改：round-trip 断言 source_annotation/annotation_settings 与 record 类型）。
- **验收标准**：①`uv run pytest tests/test_source_annotations_api.py tests/test_data_transfer_commands.py` 全绿（MVP 验收④后端半边 + ⑤ + ⑥）；②`uv run pytest tests/` 全量零回归。
- **预估**：0.5-1.5。

## 3. MVP 验收清单 → 任务映射（规划 §7 MVP）

| # | 验收（定稿口径） | 承载任务 | 判定命令/方式 |
|---|---|---|---|
| ① | 真题册**文本页**划词持久化（翻页/刷新仍在）；换范围分支则按框选主路径验收（裁决 1） | F1-F7、B3 | 真实真题册手工 + F11 集成测试；**补验截止门：未在真实材料补跑前不得标记完成** |
| ② | hover 划线显示批注 | F6 | F11 |
| ③ | 缩放 0.6↔2.5 往返 5 次零漂移 | F3（+F4，裁决 11 判据同步留档） | `npm run test`（纯函数） |
| ④ | 后端与前端测试全绿 | F11、B6 | `uv run pytest tests/test_source_annotations_api.py` + `npm run test` |
| ⑤ | export→import round-trip：导入后 source 字段为 record 链接类型 | B4、B6 | `uv run pytest tests/test_data_transfer_commands.py` |
| ⑥ | 删除源后备份 JSON 结构完整（快照+全量+条数一致；零标注源无备份）；恢复闭环随 P2 | B5、B6 | `uv run pytest tests/test_source_annotations_api.py` |

## 4. 标称对账表（裁决 3：标称 = 分项/任务加总）

**前端（10-11）**

| 规划 §7 分项 | 任务 | 任务预估 | 分项小计 |
|---|---|---|---|
| TextLayer 集成 2 | F1 + F2 | 1 + 1 | 2 |
| 选区→锚点 2 | F3 | 2 | 2 |
| 划线渲染+缩放换算 2 | F4 + F7 | 1.5 + 0.5~0.75 | 2~2.25 |
| 浮条/卡片 1.5 | F5 + F6 | 1 + 0.5 | 1.5 |
| settings+删除防护+扫描提示 0.5-1 | F8 + F9（settings 前端消费并入 F6） | 0.25 + 0.25~0.5 | 0.5~0.75 |
| i18n 1-1.5 | F10 | 1~1.5 | 1~1.5 |
| 测试 1 | F11 | 1 | 1 |
| **合计** | | | **10~11** |

**后端（3-4.5）**

| 规划 §7 分项 | 任务 | 任务预估 | 分项小计 |
|---|---|---|---|
| 模型+两迁移 1 | B1 + B2 | 0.5 + 0.5~0.75 | 1~1.25 |
| 路由+settings 1 | B3 | 1 | 1 |
| 备份导出 0.5-1 | B4 + B5 | 0.25 + 0.25~0.5 | 0.5~0.75 |
| pytest 含 round-trip 0.5-1.5 | B6 | 0.5~1.5 | 0.5~1.5 |
| **合计** | | | **3~4.5** |

> 说明：「分项小计」列是任务级细化后的区间（如 F4+F7 = 2~2.25 对应规划 §7 的「划线渲染+缩放换算 2」），与规划分项为近似映射；两端合计口径一致（前端 10~11、后端 3~4.5），标称以合计为准（裁决 3）。

> spike 走换范围分支（F1 裁定）：矩形框选转正主路径、TextLayer 整体移 P1，重排 +3-5 人日（裁决 1/3，口径不变）；逐任务变更明细见 §6.1 分支对照表。

## 5. i18n 14 locale 与测试门禁事项

**14 locale（全改，一个不能少）**：`frontend/src/lib/locales/` 下 `en-US`（参照）`bn-IN` `ca-ES` `de-DE` `es-ES` `fr-FR` `it-IT` `ja-JP` `pl-PL` `pt-BR` `ru-RU` `tr-TR` `zh-CN` `zh-TW`，每目录 `index.ts`。

**三重门禁（frontend/AGENTS.md:14 + 测试文件，均已核实存在）**：
1. **类型门**：非 en-US locale 结尾 `satisfies TranslationShape`——缺键/多键挂 `tsc`（`npm run build` 红）；
2. **parity 门**：`frontend/src/lib/locales/index.test.ts:55-66` 运行时比对各 locale 键集合；
3. **unused key 门**：`frontend/src/lib/locales/index.test.ts:123-160`——砍功能必须同步删键，否则红。

**批次清单惯例**：`frontend/src/lib/locales/new-keys.test.ts` 按批次固化新键清单，F10 须把 MVP 批次键写入。

**测试命令（AGENTS.md 口径）**：后端 `uv run pytest tests/` · `ruff check . --fix` · `uv run python -m mypy .`；前端（`frontend/` 内）`npm run lint` · `npm run test` · `npm run build`。

**不可压缩清单（裁决 3）**：export→import round-trip（B6/B4）、备份结构校验（B5/B6）、坐标换算纯函数边界（F3）、last-write-wins 语义（B3 用例）——任何超支减压下不动；各期验收条目对应测试同样不动。

## 6. F1 裁定结论回填（spike 完成后填写）

> 2026-10-03 实测（真实真题册 source:5ml0qs9qqh7g1qamovih，611 页，经 `/api/sources/{id}/download` 直读，node + pdfjs-dist legacy build）：

- 技术判据 1-3：**通过**——①12/12 抽样页全部有文本层且每 item 带 6 元 transform（quads 可算，实测 w/h/transform[4,5] 齐备）；②viewport→user space→viewport 往返误差 **0.00e+0**（scale 1.75，3 页 ×3 点）；③TextLayer 定位数学按官方 `viewport.transform` 矩阵成立（naive 基线公式符号误，弃用；DOM 级偏差 ≤2px 留 F2 验收与浏览器 E2E 复核）
- 12 页抽样占比：**100 %**（321–1520 字符/页，items 28–76）→ 分支：**③正常（划词主路径）**
- WCAG 对比度复测：亮色 ink vs 白纸 gold 3.80 / fern 6.30 / plum 7.43 / slate 5.58 / clay 5.65，全部 ≥3:1 达标；暗色 hue 2.30–2.81 全部不达标 → **固定 ink token 裁决以实测数字坐实**
- 坐标往返复测：误差 0（见上）
- SurrealDB 嵌套索引断言：**支持**（DEFINE INDEX FIELDS anchor.page 与 ORDER BY anchor.page 均正常，实测排序正确）→ 平铺 page/start_offset 字段保留（懒加载/超界 O(1) 判定仍走顶层索引更直接，非必须但零成本）
- **路径裁定**：**划词主路径**（不触发换范围分支；F8 按 §3.1 渲染，F10 全键进 locale）

### 6.1 换范围分支任务变更对照表（missing 回补：F1 裁定 = 换范围时启用）

> 触发即按此表重排（重排 +3-5 人日含 F2/F3/F5 变更差量）；F8/F10 为负变更（删减）。标注「裁定 PR 确认」的默认口径在 F1 裁定 PR 中最终确认，不在开工前二次会议。

| 任务 | 划词主路径（默认） | 换范围分支变更 |
|---|---|---|
| F2 | TextLayer 集成 + relative wrapper | **矩形框选选区层**（wrapper + 矩形选区 DOM 层）；TextLayer 整体移 P1（严格换范围语义，裁决 1） |
| F3 | 选区 Range → text item → quads + quote 纯函数 | **矩形选区视口坐标 → user space quads**（同一纯函数骨架收敛，缩放/dpr 用例不变）；quote 走 getTextContent 与 quads 求交近似（`pdf-utils.ts:120-157`；求交失败 = quote NULL 口径见裁决 17 / 规划 §5.3） |
| F4 | 波浪/直线 path 渲染 | **虚线框 1.5px ink + 同色 12% 填充**（§4.3 扫描页框选规格已定，overlay 骨架复用） |
| F5 | 八键浮条（5 色点/2 线型/[批注]/[复制]） | **键位精简为 7 键：[●●●●● 色点] + [〰/— 线型] + [批注]；[复制] 移除**——无文本选区，近似 quote 复制质量不可控（裁决 17 的乱码 >30% 判 NULL 同源风险）；色点/线型保留（框选仍需选色定型）。裁定 PR 确认 |
| F6 | hover 批注卡 + pin（不变） | 不变（quote 为 NULL 时引文块按占位格式，P1 dogfood 评审形态，裁决 17） |
| F7 | 按页懒加载 + memo（不变） | 不变 |
| F8 | 扫描页提示条渲染 | **不渲染**（框选即当期主路径，§3.1/规划 §3.1 分支条件） |
| F10 | 全部键落 14 locale | **未用键不进 locale**（提示条键、[复制] 键删除——砍功能同步删键，§5 unused key 门禁） |
| F11 | 划词流集成测试 | 用例改为框选流（选区→quads→落标→持久化）；F3 纯函数边界用例不变 |
| B1-B6 | —（不变） | 不变（pdf_anchor 本就存 quads，schema 与备份/导出/路由零变更） |

**该分支发布说明明示**（裁决 1/17）：「框选标注读回以页码+批注为主，引文暂缺」+ 扫描页占比与 P1 TextLayer 重攻预期；P1 dogfood 议程直接列入 quote 替身评估（canvas 快照优先）。

## 7. P1 概要（不拆任务粒度；预算：前端 8.5-10 + 后端 1 人日）

- **范围**（规划 §7 P1）：AnnotatableContent 容器包裹 `frontend/src/components/sources/SourceDetailContent.tsx:633` MarkdownRenderer（0.5 天 Range 包裹 spike，**三判据任一失败即降级** Highlight API 纯视觉 + 最简列表承载交互，裁决 14：①偏移一致含 KaTeX 排除用例；②不破坏宿主交互以**链接点击**为必测项（`frontend/src/components/ui/markdown-renderer.tsx:88-103` 代码块由 SyntaxHighlighter 渲染、无复制按钮，「代码块复制」是不存在的交互不测）；③50 条 <100ms，三项 vitest 可断言）；文本三段锚 + 三级重锚 + orphan 灰显 + 源文件替换检测（page 超界/quote 失配）；display_position 三态语义落地（NULL/显式四档；P1 起创建按视图写默认档 PDF→margin/文本→inline，裁决 9）；扫描页矩形框选 + orphaned 重新框选同 PR（裁决 16）；右侧痕迹栏（条件互斥 <900px 容器剩余宽度 + 沟槽豁免 + 「批注栏已收起」提示，裁决 2；沟槽聚合规则与降级出口已定死，裁决 12）；最简「本源标注列表」+ MD/JSON 最简导出（Blob）；「显示我的痕迹」开关 + 色语义改名设置 popover（裁决 18，+0.25 并入既有项）；快捷键 H/C/1-5/W-S；无障碍键盘路径（§3.7 规格）。
- **验收**：规划 §7 P1 ①-⑦（解析视图划线含 KaTeX 用例 / inline·margin 持久化 / 跳转 / drifting-orphaned 显式态 / 全键盘路径 / 过滤导出一致 / 两套 vitest 绿）。
- **砍序特例（裁决 5，优先于全程减压规则）**：P1 超支 → ①快捷键砍掉顺延 P2（0.5 人日）→ ②仍不足走全程规则（先顺延工期→再压非数据完整性测试）。无障碍键盘路径与最简列表/导出任何情况下不可砍。
- **涉及文件（概要）**：`frontend/src/components/sources/SourceDetailContent.tsx`（改）、`frontend/src/components/sources/annotations/`【新增容器与痕迹栏组件】、`frontend/src/lib/stores/`【新增标注 store，仿 `source-view-store.ts`】、`frontend/src/lib/locales/`（14 locale 延续 F10 键名）、后端校验补强（`api/routers/source_annotations.py`、`open_notebook/domain/source_annotation.py`）。
