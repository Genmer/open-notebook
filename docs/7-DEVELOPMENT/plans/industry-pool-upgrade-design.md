# 行业池升级设计稿：77 条池条目挂业务特征提示（name + hint）

- 设计稿落点：`docs/7-DEVELOPMENT/plans/industry-pool-upgrade-design.md`（2026-10-11 自 gitignore 的 workflow-drafts 定稿迁入，正文未改动）
- 输入：代码链路探索 + 语料特征素材（两路探索结论），关键事实全部经本稿亲自读码复核（见附录 B）
- 取代：`frontend/src/lib/ruankao/industry-pool.ts:2` 引用的失效来源 `.zcode/workflow-drafts/ruankao-design/f0-industry-pool.md`（该文件已不存在；**O3 标记「终版清单待用户过目」的本体 = 本文 ② 的 77 条表**，落地时同步把 industry-pool.ts:2 注释改指本稿路径）
- 范围：单批次可完成——前端 1 个数据文件 + 2 个组件 + 14 个 locale + 2 个新测试文件；后端 1 个新常量模块 + pipeline 五处 data 组装 + 5 个模板各一行 + 2 个测试文件

---

## 0. 结论速览

| 决策点 | 定稿 |
|---|---|
| hint 传输方式 | **方案 B：前端不传 hint，后端按行业名查表**（⑤） |
| 后端 context key | `industry_hint`（③） |
| 注入面 | 仅 mock 主链五函数 + 五模板 COMPANY CONTEXT 各一行条件句；`generic_paragraph` / `fixed_parts` 不注入（③） |
| API / schema / migration | **零变更、无迁移**——hint 不落库，由 `env.industry` 现场推导（⑦） |
| hover 形态 | 原生 `title` 属性，抄 `TechStackCards.tsx:63` 的 tech-glossary 先例（④） |
| i18n | hint 走 R2 中文常量不进 14 语种；hover 标签键 `ruankao.industry.hintLine` 进 14 语种（⑥） |

---

## ① 目标与非目标

### 目标

1. **数据**：`INDUSTRY_POOL` 从 `readonly string[]` 升级为 `readonly IndustryPoolEntry[]`（`{ name, hint }`），77 条逐条挂一句 ≤40 字的中文业务特征提示（②）。
2. **hover**：行业池面板与向导行业 Combobox 两处池内条目，悬停即可看到「业务特征参考：…」（④）。
3. **生成注入**：mock 主链五个模板渲染时，COMPANY CONTEXT 段在行业名行后注入一行「该行业业务特征参考：{{ industry_hint }}」，让 mock 项目背景贴合行业真实业务面；池外自定义行业 / 无提示场景退化为现状，渲染不含该行（③）。

### 非目标（红线，任一触碰即超范围）

1. **不改向导交互流程**：点击池条目 → `wizardSeed` 一次性种子 → mock 模式落到第 2 步并预填行业名的既有流一字不动。`EnvironmentsPanel.tsx:38-42`（pickIndustry）、`CreateEnvWizard.tsx:219-224`（preset 分支）、`:193-215`（关闭 reset）、`:345-383`（提交 payload）全部零改动。
2. **不改行业字段 max_length**：`industry` 的 20 字符双层约束原样保留——`api/models.py:1716` `Field(None, max_length=20)` + `open_notebook/domain/project_env.py:129-130` validator。hint 上限 40 字只由数据完整性测试守护（⑧），不设 API 字段故无 Pydantic 约束。
3. **不做后端行业表**：延续 ADR-016 对「行业池做成 SurrealDB 表」的拒绝（`docs/7-DEVELOPMENT/decisions/ADR-016-ruankao-module-tab-registry.md:21`「entries are read-only vocabulary…R2 pinned the pool inside the project-environments tab」）。hint 与 name 同为只读语料常量，无表、无端点、无读写 UI。

---

## ② 数据结构

### 2.1 类型定义（TS）

```ts
// frontend/src/lib/ruankao/industry-pool.ts
export interface IndustryPoolEntry {
  /** 行业名：逐字不变（是落库值 env.industry 与后端查表键，改名即断链） */
  name: string
  /** 业务特征提示：≤40 字中文语料常量，喂给后端生成链路与 hover 展示 */
  hint: string
}

export const INDUSTRY_POOL: readonly IndustryPoolEntry[] = [
  { name: '政务服务（一网通办/一窗通）', hint: '一窗受理、部门联办、全程网办，办件流转与好差评考核' },
  // …共 77 条，见 2.2
]

export const INDUSTRY_MAX_CHARS = 20  // 只约束 name，原样保留

export function filterIndustryPool(query: string): readonly IndustryPoolEntry[] {
  const q = query.trim()
  if (!q) return INDUSTRY_POOL
  return INDUSTRY_POOL.filter((item) => item.name.includes(q))  // 唯一改动：对 name 过滤
}
```

`INDUSTRY_POOL` 的 name 列与现有 77 条（`industry-pool.ts:6-94`）**逐字一致、顺序不变**；本次只新增 hint。顺序不变的额外意义：`IndustryCombobox.tsx:44` 回车取 `filtered[0]`（第一条命中），顺序即默认选中。

### 2.2 77 条逐条数据（O3 待过目件）

依据标注：**语料** = 范文语料库标题点名该行业（19 条，依据 `GET /api/ruankao/essay-marks/library?view_id=` 返回 118 篇来源标题核对）；**通识** = 通识推断（58 条），一律采用行业通用业务流程词、写宽泛业务面，未编造任何专有系统名与数字。全部 hint ≤40 字。

**政务与城市治理（12）**

| name | hint | 依据 |
|---|---|---|
| 政务服务（一网通办/一窗通） | 一窗受理、部门联办、全程网办，办件流转与好差评考核 | 语料 |
| 城市运行管理服务平台 | 城市体征监测、事件上报派遣、多部门协同处置与联动指挥 | 语料 |
| 基层治理平台（党建引领网格化） | 网格划分、事件采集上报、党员报到联动，逐级派单闭环处置 | 语料 |
| 退役军人服务（老兵码） | 退役军人建档、码上办事亮证、就业创业扶持与走访慰问管理 | 语料 |
| 政务大数据共享开放 | 部门数据归集、目录管理、共享交换与开放门户发布 | 通识 |
| 智慧城管 | 市容事件巡查上报、案件派遣处置、执法取证与考核评价 | 通识 |
| 税务征管信息化 | 申报征收、发票管理、风险推送应对与征纳互动服务 | 通识 |
| 社保医保信息系统 | 参保登记缴费、待遇审核拨付、就医结算与基金台账管理 | 通识 |
| 海关跨境通关 | 申报审单、查验放行、税费征管与跨境贸易便利化监管 | 通识 |
| 司法信息化（法院/监狱） | 立案审判流程管理、电子卷宗、庭审直播与狱务安全管理 | 通识 |
| 应急管理指挥平台 | 风险隐患监测、预警发布、应急预案演练与救援力量调度 | 通识 |
| 气象预报服务系统 | 观测数据汇聚、预报产品加工、预警发布与行业专项服务 | 通识 |

**金融（10）**

| name | hint | 依据 |
|---|---|---|
| 银行核心系统改造 | 存贷汇账务处理、日终批切、渠道接入与分布式迁移改造 | 语料 |
| 银行反诈止付（金融风控） | 交易实时监测、可疑名单研判、账户分级管控与紧急止付 | 语料 |
| 银行统一收单平台 | 商户入网、多渠道交易接入、清分对账与差错处理 | 通识 |
| 银行统一用户体系 | 客户身份认证、单点登录、用户画像与渠道信息互通 | 通识 |
| 保险营销展业平台 | 产品配置、代理人展业、在线投保核保与佣金结算 | 通识 |
| 保险移动信息平台 | 移动查勘定损、保单查询、外勤作业管理与消息协同 | 通识 |
| 证券交易与清算 | 委托报盘、成交回报、日终清算交收与交易监察风控 | 通识 |
| 第三方支付 | 收单扫码支付、资金清结算、商户分账与交易风控 | 通识 |
| 消费金融与信贷 | 在线进件审批、授信额度管理、放款还款与贷后催收 | 通识 |
| 征信服务 | 信用信息采集加工、信用报告查询、异议处理与授权管理 | 通识 |

**医疗健康（5）**

| name | hint | 依据 |
|---|---|---|
| 智慧医院（院内信息化） | 挂号收费、医嘱与电子病历、检查检验互认及院区安防 | 语料 |
| 互联网+医疗健康平台 | 在线问诊开方、预约转诊、处方流转与药品配送到家 | 通识 |
| 医保基金监管 | 医保结算审核、智能规则筛查、疑点核查与基金追偿 | 通识 |
| 医药流通与药店 | 采购入库、多仓调拨、门店零售与会员营销管理 | 通识 |
| 医疗器械 | 产品研发注册、生产质量管理、渠道销售与售后追溯 | 通识 |

**教育（5）**

| name | hint | 依据 |
|---|---|---|
| 智慧教育云平台（区域教育） | 区域资源共建共享、学籍教务管理、在线教学与质量监测 | 语料 |
| 中小学数字教材（教育出版） | 教材编审出版、数字资源封装、课堂互动与学习数据记录 | 语料 |
| 高校在线教考（程序评测） | 在线编程作业、自动评测判分、题库组卷与防作弊监考 | 通识 |
| 职业教育在线培训 | 课程学习打卡、实训模拟、技能认证与学员就业服务 | 通识 |
| 高校科研管理 | 项目申报评审、经费预算执行、成果登记与绩效统计 | 通识 |

**制造与工业（7）**

| name | hint | 依据 |
|---|---|---|
| 注塑工厂设备智能运维 | 设备联网采集、工况异常检测、维保工单与工艺参数优化 | 语料 |
| 制造业智能客服与知识库 | 售后咨询应答、工艺知识沉淀、工单流转与话术辅助 | 语料 |
| 工业互联网平台 | 设备上云、数据采集汇聚、模型分析赋能与工业应用开发 | 通识 |
| 钢铁冶金 | 炼钢轧制排产、能源介质调度、质量检验与产销一体协同 | 通识 |
| 化工安全生产 | 工艺过程监控、双重预防机制、危化品管理与应急联动 | 通识 |
| 半导体制造 | 晶圆投料排程、洁净室设备管控、良率分析与工艺追溯 | 通识 |
| 消费电子 | 产品研发迭代、供应链备料、整机装配测试与全球销售 | 通识 |

**汽车与交通出行（8）**

| name | hint | 依据 |
|---|---|---|
| 车联网（智能网联汽车） | 车端数据回传、远程诊断升级、行车服务与车队管理 | 通识 |
| 车企一站式购车平台 | 选配下单、金融信贷、交付排产与车主服务全流程贯通 | 语料 |
| 智慧停车（园区/城市） | 车位感知诱导、无感支付、错峰共享与经营报表分析 | 语料 |
| 网约车出行 | 乘客下单派单、司机接单服务、行程计费与安全监护 | 通识 |
| 轨道交通（地铁） | 行车调度指挥、售检票清算、设备运维与客流监测 | 通识 |
| 民航机场 | 航班保障调度、旅客值机安检、行李跟踪与机位资源管理 | 通识 |
| 港口航运 | 泊位靠离安排、闸口集疏运、堆场理货与单证通关协同 | 通识 |
| 高速公路收费与稽核 | 门架计费扣费、通行证据识别、逃费稽查与清分结算 | 通识 |

**电商零售与企业服务（6）**

| name | hint | 依据 |
|---|---|---|
| 跨境电商（代发货） | 海外选品上架、订单分发出海、尾程履约与多币种结算 | 语料 |
| 电商券核销与大促营销 | 大促活动承载、优惠券发放核销、库存抢购与营销风控 | 语料 |
| 企业 AI 办公与知识管理 | 文档协同沉淀、智能检索问答、流程审批与办公门户集成 | 语料 |
| 新零售与生鲜电商 | 门店线上同售、即时配送履约、生鲜损耗管控与会员运营 | 通识 |
| 连锁便利店 | 门店订货补货、总部统一配送、商品价签与会员促销管理 | 通识 |
| 供应链管理 | 需求预测补货、供应商协同、仓储网络与物流履约计划 | 通识 |

**物流快递（2）**

| name | hint | 依据 |
|---|---|---|
| 快递网点管理平台 | 多网点揽派、路由分拨调度、时效考核与末端驿站管理 | 通识 |
| 冷链物流 | 温控仓储运输、全程温度监测、冷链订舱与品控追溯 | 通识 |

**文旅传媒体育（4）**

| name | hint | 依据 |
|---|---|---|
| 全域智慧旅游 | 景区预约购票、导览讲解、客流监测与文旅营销推广 | 通识 |
| 广电融媒体 | 内容策采编发、多渠道分发、媒资管理与舆情互动 | 通识 |
| 出版传媒 | 选题组稿编校、印刷发行渠道、版权管理与数字阅读 | 通识 |
| 体育场馆信息化 | 场地预订核销、赛事运营保障、票务闸机与会员健身服务 | 通识 |

**电信与互联网（4）**

| name | hint | 依据 |
|---|---|---|
| 移动计费系统（BOSS） | 用户开户销户、套餐计费出账、渠道代办与欠费管控 | 通识 |
| 运营商客服系统 | 热线话务接入、工单派单处理、知识库支撑与满意度回访 | 通识 |
| 云服务与 IDC | 算力资源售卖、机房设备托管、监控告警与容灾运维 | 通识 |
| 在线视频与直播 | 内容上传审核、转码分发加速、直播互动与会员付费 | 通识 |

**能源资源与生态环境（6）**

| name | hint | 依据 |
|---|---|---|
| 遥感大数据（自然资源） | 卫星影像接收处理、地物识别解译、变化监测与成果分发 | 语料 |
| 生态环境（环评/监测） | 空气水质监测、排污企业监管、环评审批与预警处置 | 通识 |
| 智能电网 | 输变配电监测、调度抄表计费、故障抢修与新能源并网 | 通识 |
| 油气田生产 | 井口采输监控、集输管网调度、设备巡检与产量管理 | 通识 |
| 新能源充电桩运营 | 充电桩选址建站、扫码充电结算、桩群运维与负荷调控 | 通识 |
| 水利水务 | 雨情水情监测、供水调度、管网漏损管控与防汛指挥 | 通识 |

**公共安全与国防（3）**

| name | hint | 依据 |
|---|---|---|
| 智慧警务（警情联动） | 警情接报流转、视频图像侦查、力量联动指挥与勤务管理 | 语料 |
| 国防特种保障（野外勤务） | 野外勤务保障、装备物资管理、通信联络与任务计划协同 | 语料 |
| 消防救援指挥 | 警情受理调派、水源预案管理、救援力量跟踪与战评复盘 | 通识 |

**建筑地产与农业（5）**

| name | hint | 依据 |
|---|---|---|
| 智慧建筑与楼宇自控 | 机电设备监控、能耗调节、门禁访客与空间资产管理 | 通识 |
| 智慧工地 | 人员实名制考勤、视频安全监测、扬尘噪声与升降机监控 | 通识 |
| 房地产营销平台 | 楼盘案场管理、在线选房认购、渠道分销与客户跟进 | 通识 |
| 智慧农业（种植/养殖） | 环境墒情监测、精准灌溉饲喂、农事作业与产量溯源 | 通识 |
| 农村电商 | 农产品上行带货、村级服务站点代收代购、助农直播产销对接 | 通识 |

（分组条数合计 12+10+5+5+7+8+6+2+4+4+6+3+5 = 77，与本稿实测 `grep -c "^  '" frontend/src/lib/ruankao/industry-pool.ts` → `77` 一致。）

### 2.3 兼容性说明（数据形状依赖逐处点名）

`INDUSTRY_POOL` / `filterIndustryPool` / `INDUSTRY_MAX_CHARS` 的全仓消费点（本稿 grep 核实，仅以下四处代码 + 一处测试）：

| 消费点 | 现状依赖 | 升级动作 |
|---|---|---|
| `IndustryPoolPanel.tsx:6,17` | `filterIndustryPool(query)` 返回字符串数组迭代渲染 | 改为解构 `{name, hint}`：name 作 key/testid 后缀/回调值，hint 作 title |
| `IndustryCombobox.tsx:14,26,36,44,53-61` | 过滤迭代 + `filtered[0]` 回车首条命中 + `INDUSTRY_MAX_CHARS` | `filtered[0]?.name`、`entry.name/value/onSelect`，hint 作 CommandItem title；`maxLength` 不动 |
| `IndustryPoolPanel.test.tsx:4,10,12` | 直接 import `INDUSTRY_POOL`，用 `.length` | `.length` 语义不变，无需改；另补 title 断言（⑧） |
| `EnvironmentsPanel.tsx:17-19,38-42,91` | `onPickIndustry(name)` 单字符串种子 | **零改动**（pickIndustry 收到的仍是 name 字符串） |
| `CreateEnvWizard.tsx:45,145-148,223,351,371,654` | `preset {industry}` / localStorage / payload 均为行业名字符串 | **零改动** |

其余不变项：

- testid `ruankao-industry-item-${name}`（IndustryPoolPanel.tsx:43）继续用 name；既有测试 `ruankao-industry-item-银行核心系统改造` 等选择器不受影响（IndustryPoolPanel.test.tsx:25,28,47）。
- localStorage 键 `project-env-industry`（CreateEnvWizard.tsx:145-148,339）存行业名字符串，兼容存量。
- `INDUSTRY_MAX_CHARS=20` 继续只约束 name（input `maxLength`，IndustryCombobox.tsx:36）；hint 的 ≤40 字是数据测试约束（⑧-1），与 20 互不相干。
- **name 逐字不变是硬约束**：name 同时是 `env.industry` 落库值（api/routers/project_envs.py:395）与后端查表键，任何改名都会让存量环境与后端 dict 同时脱钩。本升级只加 hint，不动 name。

---

## ③ 生成链路注入方案

### 3.1 context key 与查表模块（定稿：后端按名查表）

- **context key：`industry_hint`**（与既有 `industry` 键并排；全仓 grep 核实该名字当前无任何代码痕迹，无冲突）。
- 新增后端常量模块 `open_notebook/ai/industry_pool.py`：

```python
"""行业业务特征提示（中文语料常量）：与前端 lib/ruankao/industry-pool.ts 的
77 条逐字同源——改池必须两处同改，tests/test_industry_pool_parity.py 对账。"""

INDUSTRY_HINTS: dict[str, str] = {
    "政务服务（一网通办/一窗通）": "一窗受理、部门联办、全程网办，办件流转与好差评考核",
    # …与 ② 的 77 条表逐字一致
}

def industry_hint_for(industry: str | None) -> str:
    return INDUSTRY_HINTS.get((industry or "").strip(), "")
```

### 3.2 注入点：五个 mock 主链函数的 data 组装处

`open_notebook/ai/project_env_pipeline.py`（行号本稿逐处核实）：每个函数把现有内联表达式提成局部变量，再并排加一个键：

```python
resolved_industry = (industry or "").strip() or DEFAULT_INDUSTRY
data: Dict[str, Any] = {
    …,
    "industry": resolved_industry,
    "industry_hint": industry_hint_for(resolved_industry),   # 新增
    …,
}
```

| 函数 | 签名行 | industry 现行 | 改动点 |
|---|---|---|---|
| `render_mock` | :596 | :611 | data 组装处加键 |
| `generate_materials` | :654 | :668 | 同上 |
| `generate_routes` | :683 | :697 | 同上 |
| `render_materials_draft` | :706 | :730 | 同上 |
| `render_route_draft` | :740 | :757 | 同上 |

**不注入**：`render_generic_paragraph`（:496-527，data :512 空串直传）、`render_fixed_parts`（:539-587，data :566）、`render_polish`（:476-493，本无 industry 参数）。理由见 3.4。

**commands 层零改动**：`commands/project_env_commands.py` 已把 `industry=env.industry` 传给主链——mock common kwargs :293（分派 :298/:302/:303）、素材 :932、路线 :943。提示由 pipeline 内部从入参推导，命令层无感知；旁路自动段 :717/:722 传参不变，`render_generic_paragraph` 不消费 hint。

### 3.3 模板：COMPANY CONTEXT 段加一行条件句

五个模板的行业名行后各加一行（独立行 `{% if %}`，与 `mock_generate.jinja:9-15` 既有风格及 `generic_paragraph.jinja:23`、`fixed_parts.jinja:30` 的条件行先例同构）：

```jinja
- 本人所在公司属于「{{ industry }}」，项目是公司为自身业务建设——…（原行不动）
{% if industry_hint %}- 该行业业务特征参考：{{ industry_hint }}{% endif %}
```

| 模板 | 行业名行 | 第二处 {{ industry }} 引用 |
|---|---|---|
| `prompts/project_env/mock_generate.jinja` | :26 | :34（「贴合「{{ industry }}」行业场景」句，**不动**） |
| `prompts/project_env/materials_generate.jinja` | :23 | 无 |
| `prompts/project_env/routes_generate.jinja` | :26 | 无 |
| `prompts/project_env/draft_from_materials.jinja` | :26 | 无 |
| `prompts/project_env/draft_from_route.jinja` | :26 | 无 |

退化语义：池外自定义行业 → `industry_hint_for` miss → 空串 → `{% if %}` 为假 → 该行不渲染，输出与现状一致（提示行级别的「不含」由 ⑧-5 断言；条件行会引入一个空行差异，对 LLM 无语义影响，如需连空行都消除可改 `{%- if -%}` 变体，不作为验收要求）。

### 3.4 generic_paragraph / fixed_parts 不注入，理由四点

1. **生成源头权威**：素材/草稿在主链生成时行业肌理已烙进 candidate 字段；两个旁路以「verified material 是唯一事实来源」派生（`generic_paragraph.jinja:8`、`fixed_parts.jinja:8`），提示随之自然下沉，无需二次注入。
2. **ADR-017 红线精神**：`render_fixed_parts` 的 prompt 上下文被刻意收窄到仅 ProjectEnv 素材字段（`project_env_pipeline.py:551-553` docstring；router docstring 旁证），在被刻意最小化的 prompt 面上扩写违背收窄意图（提示虽非范文内容、不违字面）。
3. **双模式风险**：两个旁路同时服务 mock 与 real 环境（模板均有 `source_type` 分支，generic_paragraph.jinja:18-22、fixed_parts.jinja:25-29），而提示池是为「建 mock 项目对齐行业写法」写的——real 项目同名行业注入 mock 向提示，可能把文本拽离用户真实素材。
4. **波及面**：generic_paragraph 另有验证落库后自动跑的 fenced 写入路径（`commands/project_env_commands.py:717-722` → `_save_generic_paragraph_fenced`），旁路不动它最稳。

若未来确需旁路注入，加 `{% if source_type == "mock" %}` 门控只是两行模板改动，本期预留不做。

### 3.5 四条「从存量行重发」路径天然一致（方案 B 的核心收益）

这些端点请求体不带行业、全部由命令层从 DB 重读 `env.industry` 再调主链（`_submit_verification` :131 / `_submit_materials_job` :147 只发 `{env_id, mode, token}`）：reverify（router :552）、regenerate（:597）、素材重跑（:714）、素材/路线选定提交（:794）。hint 既不落库也不随任务走，而是每次渲染时由 `env.industry` 现场推导——四条路径无需任何改动即与首次生成一致。且行业名创建后不可改（PUT 不回写，见 ⑦ 勘误），推导结果终身稳定。

---

## ④ hover 解释（两组件）

形态对齐 tech-glossary 先例：原生 `title` 属性 + 未命中静默退化，**不引 Tooltip 组件**（先例：`frontend/src/components/project-envs/TechStackCards.tsx:41-44` 计算、`:63` `title={hint ? \`${tech.name}\n${hint}\` : tech.name}`）。

### IndustryPoolPanel.tsx（:38-48 chip 按钮）

```tsx
{filtered.map(({ name, hint }) => (
  <button
    key={name}
    type="button"
    onClick={() => onPickIndustry(name)}
    data-testid={`ruankao-industry-item-${name}`}
    title={hint ? `${name}\n${t('ruankao.industry.hintLine', { hint })}` : name}
    …
  >
    {name}
  </button>
))}
```

数据完整性保证池内条目 hint 恒非空（⑧-1），退化分支仅作类型安全兜底，写法与先例保持同构。

### IndustryCombobox.tsx（:53-61 CommandItem）

```tsx
{filtered.map(({ name, hint }) => (
  <CommandItem
    key={name}
    value={name}
    onSelect={() => onChange(name)}
    title={hint ? `${name}\n${t('ruankao.industry.hintLine', { hint })}` : name}
  >
    {name}
  </CommandItem>
))}
```

触发 `Input` 本体不加 title：输入框里可能是池外自由文本，查表无意义（保持现状）。回车选首条命中后，用户重新展开下拉仍可 hover 各条目看 hint。

### 不需要的东西

- **不需要 `GLOSSARY_I18N_KEYS` 式守护数组**：glossary 需要它只因 key 是模板字符串动态拼的（`projectEnvs.glossary.${key}`），扫描器看不见；本键是静态字面量 `t('ruankao.industry.hintLine', …)`，`locales/index.test.ts:123-158` 的 Unused Key Detection 直接扫得见。
- **不需要新依赖**：原生 title 即可；overflow 空态、搜索框均不涉及。

---

## ⑤ 前端点击流定稿

### 定稿：方案 B——前端不传 hint，后端按行业名查表

点击流全程与现状逐行相同，**向导与种子通道零改动**：

1. 池面板点击条目 → `onPickIndustry(name)`（IndustryPoolPanel.tsx:42）→ `pickIndustry` 清 `wizardEnvId`、`setWizardSeed({ industry })`、开向导（EnvironmentsPanel.tsx:38-42）。
2. `EnvironmentsWizardSeed` 保持 `{ industry: string }`（:17-19）**不扩 hint 字段**。
3. `CreateEnvWizard` preset 分支（:219-224）`setMode('mock'); setStep(2); setIndustry(preset.industry)`——第 2 步预填行业名，照旧。
4. 提交时 `MockGenerateRequest` 仍只带 `industry: industry.trim() || undefined`（:351/:371）；**hint 不进请求**。
5. 后端 mock-generate（router :388-398）落库 `industry` 照旧；worker 命令重读 `env.industry`（commands :293 等）调主链，pipeline 内 `industry_hint_for` 推导并注入模板。

向导内 hover 的 hint 由 Combobox 直接读客户端池（④），无需暂存——**「hint 暂存 state」在方案 B 下不存在消费点，故不设**（这也正好满足非目标 1「不改向导交互流程」的字面与实质）。

### 定稿理由（采纳代码探索员建议④）

- **最小 diff**：前端仅池文件 + 2 组件 + locale；后端 1 模块 + 5 处 data 组装 + 5 行模板。API/schema/迁移零触碰，三条非目标零接触。
- **一致性免费**：四条重发路径（③ 3.5）由落库行业名推导，天然与首次生成一致，无需穿线。
- **退化安全**：池外自定义 miss → 空串 → 条件行不渲染 = 现状。

### 方案 A（`industry_hint` 独立字段随请求走 + 落库）为何放弃（留作升级位）

A 需要动 ~10 个文件并新建迁移：池文件、两组件、种子接口、向导 state+关闭 reset、`MockGenerateRequest`（api + `frontend/src/lib/types/api.ts:367-376`）、`ProjectEnv` domain + `nullable_fields` + Response + Update + PUT 回写、migration 41（照抄 migration 40 一行式）、commands 两处、pipeline 五函数签名加参、模板五行。且 A 必须补「PUT 回写 industry」——见 ⑦ 勘误，现模型 `ProjectEnvUpdate` 连 industry 字段都没有，补齐属于另一个缺陷修复，超出本期。**若未来要「提示跟随用户意图、可编辑」，按 A 升级：`industry_hint: Optional[str] = Field(None, max_length=40)` + `DEFINE FIELD IF NOT EXISTS industry_hint ON TABLE project_env TYPE option<string>;`，后端查表降级为回退。**

---

## ⑥ i18n 策略与键清单

### hint 本体：不进 14 语种（R2 先例）

行业名与提示都是喂中文论文管线的**中文语料本体**，按 ADR-016 R2 以中文常量与数据同文件共存（`industry-pool.ts:1` 头注释、ADR-016:14「entries stay Chinese and out of the 14 locales」）。这与 tech-glossary 走 i18n 路线刻意互为镜像：glossary 解释是 UI 多语言散文，行业语料不是。

### UI 标签：1 个新键，14 语种

hover 框里的标签文案是 UI 散文，进 14 语种。**键清单（唯一新增键）**：

```
ruankao.industry.hintLine
```

落位：各 locale 的 `ruankao.industry` 块内（en-US/index.ts:2674-2680、zh-CN/index.ts:2674 起已有该块；fr-FR/ja-JP/bn-IN 等其余 12 语种均已有，本稿抽查核实）。值为含 `{{hint}}` 插值的完整标签句：

| locale | 建议文案 |
|---|---|
| zh-CN（基准） | `业务特征参考：{{hint}}` |
| en-US（基准） | `Business traits: {{hint}}` |
| zh-TW | `業務特徵參考：{{hint}}` |
| ja-JP | `業務特徴: {{hint}}` |
| fr-FR | `Traits du secteur : {{hint}}` |
| de-DE | `Branchenmerkmale: {{hint}}` |
| es-ES | `Rasgos del sector: {{hint}}` |
| ca-ES | `Rasgos del sector: {{hint}}` |
| it-IT | `Caratteristiche del settore: {{hint}}` |
| pt-BR | `Características do setor: {{hint}}` |
| ru-RU | `Особенности отрасли: {{hint}}` |
| tr-TR | `Sektör özellikleri: {{hint}}` |
| pl-PL | `Charakterystyka branży: {{hint}}` |
| bn-IN | `সেক্টরের বৈশিষ্ট্য: {{hint}}` |

### 守护机制（既有测试，无需新设施）

- `new-keys.test.ts`：钉死清单守护 zh-CN + en-US 键存在、其余 locale 可解析（自有译文或 en-US 回退）——新键加入后把 `ruankao.industry.hintLine` 追加进 `NEW_KEYS` 数组。
- `index.test.ts` Unused Key Detection（:123-158）：静态字面量引用即视为已用，无需 glossary 式守护数组。

---

## ⑦ 后端 schema 变更清单（定稿方案 B）

| 对象 | 变更 | 依据 |
|---|---|---|
| `MockGenerateRequest`（api/models.py:1713-1719） | **零新字段**；`industry` 的 `max_length=20`（:1716）原样 | hint 不随请求走 |
| `ProjectEnv`（domain/project_env.py:91；nullable_fields :58；validator :129-130） | **零变更** | hint 不落库 |
| `ProjectEnvUpdate` / `ProjectEnvResponse`（api/models.py:1667-1679 / :1682-1710） | **零变更** | 同上 |
| `ProjectEnvUpdate.industry` 字段 | **不新增**（勘误见下） | 维持「行业创建后不可改」现状 |
| migration | **无新迁移**；migration 40（`open_notebook/database/migrations/40.surrealql` 的 `DEFINE FIELD … industry TYPE option<string>`）语义不变 | hint 只影响生成上下文，不落库 |
| 新增后端面 | `open_notebook/ai/industry_pool.py`（纯常量 + 纯函数）+ pipeline 五处 data 组装 + 5 个模板各一行 | ③ |

> **事实勘误（相对探索报告）**：探索报告称 `ProjectEnvUpdate` 在 models.py:1690 声明了 `industry` 字段。本稿亲读核实：`ProjectEnvUpdate`（:1667-1679）**没有** industry 字段，:1690 属于 `ProjectEnvResponse`（:1682 起）的 `industry: Optional[str] = None`。即行业在 API 层连「可更新」的声明都不存在——「PUT 不回写 industry」比探索报告描述的更彻底，行业名创建后终身不变。这反而加固方案 B 的一致性根基（③ 3.5）。

**为什么无 migration 仍全链一致**：hint 不落库 ⇒ 不存在「存量行缺列」问题；每次生成（首跑 + 四条重发路径，③ 3.5）都由 `env.industry` 现场推导；行业名不可改 ⇒ 推导结果与创建时意图永远一致。存量 mock 环境（migration 40 之前 `industry=None` 的行）走 `DEFAULT_INDUSTRY` 兜底（pipeline `TestPipelineIndustryFallback` 钉死的契约，tests/test_project_env_prompts.py:564-614），「物流行业」不在池中 → 无提示，行为同现状。

---

## ⑧ 测试与验收标准（每项可测）

### 前端（vitest，`frontend/` 下 `npm run test`）

1. **数据完整性**（新建 `frontend/src/lib/ruankao/industry-pool.test.ts`）：
   - `INDUSTRY_POOL.length === 77`；
   - 每条 `name`：非空、trim 后长度 ≤ `INDUSTRY_MAX_CHARS`(20)、全池唯一；
   - 每条 `hint`：非空、长度 ≤ 40；
   - `filterIndustryPool('')` 返回全池；`filterIndustryPool('银行')` 恰返回 4 条银行条目（对齐既有 IndustryPoolPanel.test.tsx:22-23 的预期）；**只按 name 匹配**——搜提示词（如「清分」，出现在多条 hint 但不在任何 name 中）返回 0 条。
2. **池面板 hover 与点击**（扩展 `IndustryPoolPanel.test.tsx`）：chip 的 `title` 属性含行业名与 `t('ruankao.industry.hintLine')` 渲染文本；点击仍回调 `onPickIndustry(name)`（既有用例 ：43-50 保持原样通过即回归）。
3. **Combobox**（新建 `frontend/src/components/ruankao/IndustryCombobox.test.tsx`，该组件当前无测试）：CommandItem `title` 含 hint；回车对「银行」选中首条「银行核心系统改造」（顺序契约）；无命中回车保留自由文本；`maxLength=20`。
4. **向导种子流零回归**：`CreateEnvWizard.test.tsx` 既有用例（默认「物流行业」:211、localStorage 回填 :213-217、payload 带 industry 并持久化 :220-235、清空则省略 :238-247）**不改一行断言**全部通过——证明非目标 1 成立。

### 后端（pytest，`uv run pytest tests/`）

5. **注入后模板渲染含提示行**（扩展 `tests/test_project_env_prompts.py`，复用其 `_render` + `_industry_cases()` 五模板参数化框架 :78-83/:388-478）：data 带 `industry="银行核心系统改造"` + `industry_hint=INDUSTRY_HINTS[同键]` 渲染五个模板 → 断言输出含 `该行业业务特征参考：` 及该 hint 内容。
6. **无提示时渲染不含**：同框架，`industry_hint=""`（或键缺省）→ 断言 `该行业业务特征参考` not in text；池外行业（如「医疗行业」）经 pipeline 真实 data 组装后同样不含。
7. **pipeline 层推导正确**（仿 `TestPipelineIndustryFallback` 的 `_invoke_json` 捕获法 :568-641）：五函数传 `industry="银行核心系统改造"` → 捕获的 `data["industry_hint"]` 非空且等于 `industry_hint_for` 结果；传 `None/""/"  "` → `data["industry"] == DEFAULT_INDUSTRY` 且 `data["industry_hint"] == ""`；传池外行业 → 空串。旁路负断言：`render_generic_paragraph` / `render_fixed_parts` 捕获的 data **无 `industry_hint` 键**。
8. **TS↔Python 逐字对账**（新建 `tests/test_industry_pool_parity.py`）：正则解析 `frontend/src/lib/ruankao/industry-pool.ts` 的全部 `{ name, hint }` → 断言条数 77、`set(name)` 与 `INDUSTRY_HINTS` 键集合完全相等、且逐名 hint 字符串相等、后端 hint 全部非空 ≤40。（防双份语料漂移的核心守护。）

### 验收口径

- `cd frontend && npm run lint && npm run test && npm run build` 全绿；仓库根 `uv run ruff check .`、`uv run ruff format --check .`、`uv run python -m mypy .`、`uv run pytest tests/` 全绿（CI 同款）。
- 手工验收：行业池面板 hover 任意条目见「业务特征参考」原生提示；点击进向导第 2 步已预填；向导 Combobox 下拉 hover 见提示；选池内行业提交后，worker 日志/渲染单测可见提示行；输入池外自定义行业提交，提示行不出现。

（本稿为设计稿，以上测试均**未运行**——尚未实现；⑧ 即实现后的验收命令与断言标准。）

---

## ⑨ 文件落点清单与风险

### 落点清单

**前端（`frontend/`）**

| # | 文件 | 动作 |
|---|---|---|
| 1 | `src/lib/ruankao/industry-pool.ts` | 改：类型 `{name,hint}[]` + 77 条 hint + filter 按 name；顺手把 :2 失效来源注释改指本稿 |
| 2 | `src/lib/ruankao/industry-pool.test.ts` | **新建**（⑧-1） |
| 3 | `src/components/ruankao/IndustryPoolPanel.tsx` | 改：chip 加 title、解构 `{name,hint}`（④） |
| 4 | `src/components/ruankao/IndustryPoolPanel.test.tsx` | 改：补 title 断言（既有断言不动） |
| 5 | `src/components/ruankao/IndustryCombobox.tsx` | 改：`filtered[0]?.name`、CommandItem `{name,hint}` + title（④） |
| 6 | `src/components/ruankao/IndustryCombobox.test.tsx` | **新建**（⑧-3） |
| 7 | `src/lib/locales/{zh-CN,en-US,zh-TW,ja-JP,fr-FR,de-DE,es-ES,ca-ES,it-IT,pt-BR,ru-RU,tr-TR,pl-PL,bn-IN}/index.ts` ×14 | 改：各加 1 键 `ruankao.industry.hintLine`（⑥） |

前端**不动**：`EnvironmentsPanel.tsx`、`CreateEnvWizard.tsx`（含 .test）、`src/lib/types/api.ts`、`use-project-envs.ts`。

**后端**

| # | 文件 | 动作 |
|---|---|---|
| 8 | `open_notebook/ai/industry_pool.py` | **新建**：77 条 dict + `industry_hint_for`（③ 3.1） |
| 9 | `open_notebook/ai/project_env_pipeline.py` | 改：五处 data 组装（:611/:668/:697/:730/:757）+ import |
| 10-14 | `prompts/project_env/{mock_generate,materials_generate,routes_generate,draft_from_materials,draft_from_route}.jinja` | 改：各加 1 行条件句（③ 3.3） |
| 15 | `tests/test_project_env_prompts.py` | 改：扩展 ⑧-5/6/7 |
| 16 | `tests/test_industry_pool_parity.py` | **新建**（⑧-8） |

后端**不动**：`api/models.py`、`api/routers/project_envs.py`、`commands/project_env_commands.py`、`open_notebook/domain/project_env.py`、`open_notebook/database/migrations/`（无新迁移）。

**文档**

| # | 文件 | 动作 |
|---|---|---|
| 17 | `CHANGELOG.md` | `[Unreleased]` → `### Added` 加一条（池条目 hover 业务特征提示 + mock 生成按行业注入），不建重复小节 |

### 风险与对策

1. **双份语料漂移**（TS 与 Python 各持 77 条）：改池必须两处同改——在 industry-pool.ts 头注释与 industry_pool.py 模块 docstring 互指对方；`tests/test_industry_pool_parity.py` 逐字对账（键 + 值）兜底（⑧-8）。
2. **提示质量**：58/77 为通识级。对策已内建：宽泛业务面写法、只用公开通用流程词、无专有系统名、无数字承诺；② 表格即 O3 待过目件，用户可逐条修订后落码。错误的 hint 会把 mock 叙事带偏——用户始终可用池外自定义行业绕开注入。
3. **hover 为原生 title**：无移动端长按、无样式——接受（tech-glossary 先例同款取舍，TechStackCards.tsx:63）。
4. **默认行业无提示**：`DEFAULT_INDUSTRY="物流行业"`（domain/project_env.py:21）不在池中 → 默认/留空行业无提示行。记为预期行为，非回归；如未来想覆盖，往池里加「物流行业」条目即可，机制无需改。
5. **Combobox 首条命中依赖数组顺序**（IndustryCombobox.tsx:44）：本稿要求 name 顺序不变（② 2.1）；parity 测试锁集合相等，顺序由前端数据完整性测试隐式守护（filter『银行』恰 4 条的断言对首条敏感）。
6. **条件行空行差异**：`{% if %}` 独立行风格在无提示时会渲染一个空行——对 LLM 无语义影响；验收以「含/不含提示行」断言为准（⑧-6），不要求全 prompt 逐字节一致。
7. **token 成本**：每 prompt 最多 +~40 字 × 5 类模板，可忽略。
8. **行业不可改的既有缺陷不扩面**：PUT 不回写 industry 且 `ProjectEnvUpdate` 无该字段（⑦ 勘误）——本期不动它（避免与方案 A 绑定）；若未来修「行业可改」，需连带评估 hint 查表一致性（改名后存量 hint 断供），在决策记录里挂钩。

---

## 附录 A：O3 遗留处理

`industry-pool.ts:2` 的「清单来源 .zcode/workflow-drafts/ruankao-design/f0-industry-pool.md」已失效（该目录不存在，本稿 `ls` 核实）。本稿 ② 的 77 条表即 O3「终版清单待用户过目」的本体；实现时把该注释改为指向本稿路径，O3 即闭环。

## 附录 B：本稿核实记录（亲自读码与运行命令）

**运行过的检查**（本会话内实际执行）：

- `grep -c "^  '" frontend/src/lib/ruankao/industry-pool.ts` → `77`；
- `grep -rn "INDUSTRY_POOL\|filterIndustryPool\|INDUSTRY_MAX_CHARS" frontend/src …` → 消费点仅 IndustryCombobox.tsx:14/26/36、IndustryPoolPanel.tsx:6/17、IndustryPoolPanel.test.tsx:4/10/12；
- `grep -rn "industry_hint" --include=*.py --include=*.jinja --include=*.ts --include=*.tsx .`（排除 .zcode）→ 零命中（无半成品）；
- `grep -n "_submit_verification(env\|_submit_materials_job(env" api/routers/project_envs.py` → :236/:401/:403/:552/:597/:714/:794；
- `grep -n "env.industry\|pipeline.generate_…" commands/project_env_commands.py` → :293/:298/:302/:303/:717/:722/:927/:932/:938/:943；
- `grep -n "industry" …`（7 个 jinja 模板）→ 行业名行 mock:26、materials:23、routes:26、dfm:26、dfr:26；旁路条件行 generic_paragraph:23、fixed_parts:30；
- `grep -c ruankao` fr-FR/ja-JP/bn-IN locale → 各 5 命中，ja-JP 含「業種プール」（14 语种块齐备抽查）。

**逐文件亲读**：industry-pool.ts 全文（104 行）、mock_generate.jinja 全文、IndustryPoolPanel.tsx / IndustryCombobox.tsx / EnvironmentsPanel.tsx(:1-110) / IndustryPoolPanel.test.tsx 全文、CreateEnvWizard.tsx（:25-94/:190-249/:330-389）、project_env_pipeline.py（:480-769）、api/routers/project_envs.py（:345-409）、api/models.py（:1660-1724）、domain/project_env.py（:1-135）、commands/project_env_commands.py（:275-320）、tests/test_project_env_prompts.py 全文、migration 40、en-US locale（:2674-2684）、new-keys.test.ts 头部、index.test.ts（:123-160）、ADR-016（:12-22）、TechStackCards.tsx（:35-80）。

**未运行**：pytest / vitest / npm build（设计稿阶段未实现，见 ⑧ 末尾说明）；语料素材的 118 篇来源核对由语料探索员执行（本稿转述其置信度标注，未重跑 curl）。
