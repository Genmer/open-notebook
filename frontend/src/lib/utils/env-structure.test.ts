import { describe, it, expect } from 'vitest'
import {
  extractEnvStats,
  extractTechs,
  isForbiddenStat,
  splitTuningSteps,
  splitProblemPairs,
  extractRoleTitle,
} from './env-structure'

// 两套已验证的真实环境材料（TMS 用「其一/其二」，内部助手用「一是/二是」+ 问题解决同句）。
const ENV1 = {
  background:
    '2024年12月，我所在的软件公司承接了某全国连锁便利企业的智能TMS（运输管理系统）建设项目。该企业在全国拥有超过6000家门店，城配物流体系庞大，但排线长期依赖调度员的人工经验：单次排线耗时超过2小时，车辆平均装载率仅为68%，排线质量参差不齐，难以支撑门店快速扩张带来的配送需求。企业为此立项建设智能TMS，核心目标是通过AI路径优化实现排线自动化、提升装载率并有效压缩运输成本。我作为项目负责人，全面主持了需求分析、架构设计与实施落地工作，项目最终于2025年9月通过验收。',
  tech_background:
    '在技术选型上，我主导确定了以开源路径优化组合为核心的AI技术栈。路径优化内核选用Google OR-Tools 9.11求解带时间窗的车辆路径问题（VRPTW），其约束编程与元启发式能力可灵活建模多车型、多时间窗等城配约束；距离矩阵由OSRM 5.28基于真实路网预计算；地理数据采用PostgreSQL 17加PostGIS 3.5进行空间存储与分析。选择该开源组合的主要理由在于：它能够替代价格高昂的商业求解器，显著降低授权成本，且OR-Tools与OSRM均在大规模车辆路径场景下久经验证，社区活跃、文档完善。此外，系统整体采用微服务架构，排线服务无状态化设计，为后续水平扩展与求解器参数调优预留了空间。',
  tuning_process:
    '2025年5月，系统进入性能攻坚阶段。我组织团队使用JMeter 5.6对排线接口开展压测，模拟早高峰批量排线场景，发现P99响应时间高达9秒，远超3秒的性能目标，成为上线的最大瓶颈。经定位，耗时主要集中于求解器的首次解构造与串行搜索过程。为此我主导了针对性参数调优：一是将OR-Tools的首次解策略由默认的自动选择调整为路径最短启发式（PATH_CHEAPEST_ARC），大幅缩短初始解构造时间；二是显式设定求解时限，避免个别大规模实例无限搜索；三是开启并行搜索，充分利用多核算力并行探索解空间。复测显示，排线接口P99降至2.1秒，且各项解质量指标与调优前基本持平，实现了性能与解质量的平衡。随后系统完成灰度上线并全量推广，为项目按期通过验收奠定了坚实基础。',
  problems_solutions:
    '项目实施中我重点解决了三个关键问题。其一，超大规模门店订单使距离矩阵计算与整体求解耗时不可控。我利用OSRM离线预计算门店间距离矩阵并缓存于Redis，同时按配送区域将大规模VRPTW问题拆分为区域子问题并行求解，使排线耗时从小时级降至分钟级。其二，城配业务约束复杂，门店收货时间窗、多车型载重、司机工时等规则难以直接表达。我采用软时间窗惩罚与容量约束相结合的建模方式，将业务规则转化为目标函数惩罚项，使排线方案既合规又切实可行。其三，试运行初期装载率提升不及预期，现场执行与系统方案脱节。我们打通WMS订单体积重量数据，引入三维装载校验，并在司机端App建立执行反馈闭环，最终装载率稳定达到85%以上，排线自动化率达到90%，全面达成立项目标。',
  my_role:
    '作为项目负责人兼系统架构师，我全面主持项目的立项论证、需求分析、总体架构设计与技术选型，制定开发规范与里程碑计划，统筹管理团队的开发、测试与上线工作。在关键技术攻关中，我亲自负责路径优化内核的选型验证与求解器参数调优，并协调甲方物流部门、IT部门及第三方地图服务商，保障项目按期高质量交付。',
  scale:
    '我组建并带领项目团队共15人，涵盖项目经理、系统架构师、算法工程师、前后端开发、测试及运维等角色。系统管理该企业全国门店的主数据与空间坐标信息，日均处理约2.8万条配送订单，服务其城配车队及全国各区域的调度员与司机，系统稳定运行有力支撑了城配业务的连续开展。',
}

const ENV2 = {
  background:
    '2024年12月，我所在公司承建某大型物流集团的“内部应用助手”建设项目。该集团OA办公系统与物流下单系统长期独立运行，制度查询、公文起草、会议纪要和物流下单均依赖人工处理，效率低、差错多。集团决定引入文本大模型统一建设助手：接入OA实现制度问答、公文起草辅助与会议纪要生成，接入下单系统实现自然语言一句话下单，并适配千问App满足员工移动端使用需求。项目于2025年9月通过终验，全面提升集团办公与作业效率。',
  tech_background:
    '考虑到集团制度与运单数据的保密要求，我们采用私有化部署方案：基座模型选用Qwen2.5-14B-Instruct，推理服务基于vLLM 0.6框架以保障高并发下的推理吞吐。知识问答采用检索增强生成（RAG）架构：制度文档经解析与切分后，用BGE-M3模型向量化并存入Milvus 2.4向量库，检索结果经重排，保证答案可溯源。业务应用层基于Spring Boot 3与Spring Cloud Alibaba微服务体系构建，由网关统一鉴权限流。',
  tuning_process:
    '系统开发完成后进入上线调优阶段。我们先在总部部分部门灰度试运行，收集真实问句持续优化。针对首Token延迟偏高的问题，我们调整vLLM的张量并行度与并发参数，并对长提示词启用前缀缓存，首Token延迟明显下降。针对知识问答准确率不足的问题，我们将固定长度切分改为按标题层级的语义切分，并强化重排与答案引用溯源，人工评测集上的准确率由78%提升到92%，满足合同指标要求。随后完成千问App端适配并在全集团推广，项目最终通过性能专项复测与终验，各项指标均达到合同要求。',
  problems_solutions:
    '项目中有三个关键问题令我印象深刻。一是制度问答初测时，模型在既有的RAG架构下仍偶发编造条款，我们在调优阶段改进切分与重排、强化答案引用溯源的基础上，进一步在提示词中严格限定仅依据检索到的制度条文作答，并对低置信度结果自动转人工工单，终验时幻觉率由约8%降至1%以下。二是物流下单字段抽取在纯提示词下准确率仅85%，我们对Qwen2.5-7B-Instruct做LoRA微调，使其以严格JSON格式输出下单字段并经地址库校验回填，准确率提升到96%。三是千问App端出现移动端会话易断与知识越权可见问题，我们设计统一认证网关，移动端以OAuth2令牌换取短时会话票据，并按员工角色过滤知识库检索权限，一并解决了掉线与越权两个问题。',
  my_role:
    '我在项目中担任项目负责人兼系统架构师，全面负责立项调研、总体架构设计、技术选型以及进度与质量管理，并亲自主持大模型幻觉治理、下单字段抽取微调、千问App端安全接入等关键难点攻关。我带领各专业小组协同开发，协调集团办公室、运营部等业务部门完成需求确认与推广，项目按期高质量交付并通过终验。',
  scale:
    '项目合同金额约360万元。我带领17人团队完成建设，涵盖算法、后端、前端、测试等专业，大模型推理运行于私有化部署的GPU服务器上。',
}

const vals = (stats: ReturnType<typeof extractEnvStats>) => stats.map((s) => s.value + s.unit)

describe('extractEnvStats', () => {
  it('ENV1（TMS）：scale 退出扫描源，仅 background 出容量卡，无伪趋势', () => {
    const stats = extractEnvStats(ENV1.background)
    expect(vals(stats)).toEqual(['6000家', '2小时', '68%'])
    expect(stats.every((s) => !s.trendFrom)).toBe(true)
    expect(stats[0].label).toBe('该企业在全国拥有门店')
    expect(stats[1].label).toBe('单次排线耗时')
  })

  it('ENV2（内部助手）：人员/规模/资金内容不再出任何卡', () => {
    // 旧样例的 17人/360万元 卡全部废除；合规 background 无量化点 → 空
    expect(extractEnvStats(ENV2.background)).toEqual([])
  })

  it('抽取 X→Y 改善型趋势卡（复合单位），终点不重复出静态卡', () => {
    const stats = extractEnvStats('耗时由9秒降至2.1秒，日均处理2.8万条订单。')
    expect(stats[0]).toMatchObject({ trendFrom: '9秒', value: '2.1秒', direction: 'down' })
    expect(vals(stats)).toEqual(['2.1秒', '2.8万条'])
    expect(extractEnvStats('从300条降到90条。')).toHaveLength(1)
  })

  it('P99 由 9秒降至 2.1秒：趋势卡保留，同句 15人 人员卡废除', () => {
    const stats = extractEnvStats('P99由9秒降至2.1秒，团队共15人。')
    expect(stats).toHaveLength(1)
    expect(stats[0]).toMatchObject({ trendFrom: '9秒', value: '2.1秒', label: 'P99', direction: 'down' })
  })

  it('千分位：剥逗号显示；畸形分组不抽；金额值不出卡', () => {
    expect(vals(extractEnvStats('团队规模12,000人。'))).toEqual([])
    expect(vals(extractEnvStats('旗下1,200家门店。'))).toEqual(['1200家'])
    // 资金类：万元/亿元值整卡丢弃（新三层禁令）
    expect(vals(extractEnvStats('年营业额达到1,200万元。'))).toEqual([])
    expect(extractEnvStats('规模12,00人。')).toEqual([])
  })

  it('年份守卫：裸年份区间无卡；年份夹金额无伪趋势且金额静态卡废除', () => {
    expect(extractEnvStats('用户数从2019增长到2024。')).toEqual([])
    const stats = extractEnvStats('营收从2019年的1万元增长到2024年的5万元。')
    expect(stats.some((s) => s.trendFrom)).toBe(false)
    expect(vals(stats)).toEqual([])
  })

  it('年月日期不抽（单位白名单天然排除）', () => {
    expect(extractEnvStats('2024年12月开工，2025年9月验收。')).toEqual([])
  })

  it('空串与无结构文本安全', () => {
    expect(extractEnvStats('')).toEqual([])
    expect(extractEnvStats('We serve 5000 users daily.')).toEqual([])
    expect(() => extractEnvStats('好'.repeat(3000))).not.toThrow()
  })

  it('禁词兜底：三类禁词所在子句整卡丢弃，窗口外禁词也拦住', () => {
    // 禁词在 label 截断窗口之外（前 10 字容不下「项目合同金额约」），子句窗口仍命中
    expect(vals(extractEnvStats('项目合同金额约360万元。我带领项目团队完成建设。'))).toEqual([])
    expect(vals(extractEnvStats('团队规模12,000人。'))).toEqual([])
    // 趋势整条滤：合同金额句中的 X→Y 不再出趋势卡
    expect(extractEnvStats('合同金额由360万元压缩至120万元。')).toEqual([])
    // 实况反例「项目团队共18人」：子句禁词层直接拦下
    expect(vals(extractEnvStats('项目团队共18人，涵盖多个岗位。'))).toEqual([])
  })

  it('item 级谓词兜底：无精确禁词的人员卡由 label/值语义拦下', () => {
    // 子句无精确禁词，但 label 窗口（前10后6）含「团队」→ 人员卡不出
    expect(vals(extractEnvStats('项目合同金额约360万元。我带领17人团队完成建设。'))).toEqual([])
  })

  it('三层禁令下容量卡不误杀：语境过滤先行', () => {
    // 换行是子句边界：禁词子句外的容量数字照常出卡
    expect(vals(extractEnvStats('团队规模18人。\n日均订单2.8万条'))).toEqual(['2.8万条'])
    // 数字+人但无人员语境词：并发/在线容量是论文量化骨架，保留
    expect(vals(extractEnvStats('压测支持2000人同时在线，500并发下P95稳定2.6秒。'))).toEqual([
      '2000人',
      '2.6秒',
    ])
  })

  it('禁词兜底：纯函数幂等，重复抽取结果一致', () => {
    const background = '项目合同金额约360万元。门店6000家。单次排线耗时超过2小时。'
    expect(extractEnvStats(background)).toEqual(extractEnvStats(background))
  })
})

describe('isForbiddenStat', () => {
  it('人员/资金/用户规模卡整卡丢弃，容量卡保留', () => {
    // 实况样例：人员 label + 人单位
    expect(isForbiddenStat({ value: '15', unit: '人', label: '项目团队' })).toBe(true)
    // 资金值（万元/￥/unit=元）无论 label 一律丢弃
    expect(isForbiddenStat({ value: '120万元', unit: '', label: '压缩至' })).toBe(true)
    expect(isForbiddenStat({ value: '92%', unit: '', label: '准确率', trendFrom: '360万元' })).toBe(true)
    // 静态金额卡：元 在 unit 上
    expect(isForbiddenStat({ value: '1200万', unit: '元', label: '年营业额达到' })).toBe(true)
    // 用户规模 label
    expect(isForbiddenStat({ value: '6500', unit: '人', label: '月活跃用户达' })).toBe(true)
    // 容量卡：数字+人但无人员语境词；普通百分比卡
    expect(isForbiddenStat({ value: '2000', unit: '人', label: '压测同时在线' })).toBe(false)
    expect(isForbiddenStat({ value: '96%', unit: '', label: '问答准确率' })).toBe(false)
  })
})

describe('extractTechs', () => {
  it('ENV1：4 张带版本卡（solver/map/database）', () => {
    expect(extractTechs(ENV1.tech_background)).toEqual([
      { name: 'Google OR-Tools', version: '9.11', kind: 'solver' },
      { name: 'OSRM', version: '5.28', kind: 'map' },
      { name: 'PostgreSQL', version: '17', kind: 'database' },
      { name: 'PostGIS', version: '3.5', kind: 'map' },
    ])
  })

  it('ENV2：6 张（含无版本项，VRPTW/RAG/OA 纯大写排除）', () => {
    expect(extractTechs(ENV2.tech_background)).toEqual([
      { name: 'Qwen2.5-14B-Instruct', version: null, kind: 'model' },
      { name: 'vLLM', version: '0.6', kind: 'framework' },
      { name: 'BGE-M3', version: null, kind: 'model' },
      { name: 'Milvus', version: '2.4', kind: 'database' },
      { name: 'Spring Boot', version: '3', kind: 'framework' },
      { name: 'Spring Cloud Alibaba', version: null, kind: 'framework' },
    ])
  })

  it('英文整句带版本：词过滤+末词退化，零半句卡', () => {
    expect(extractTechs('We rebuilt the pipeline on Redis 7.2 and Kafka 3.5 last year.')).toEqual([
      { name: 'Redis', version: '7.2', kind: 'cache' },
      { name: 'Kafka', version: '3.5', kind: 'framework' },
    ])
    expect(extractTechs('The system runs the newer PostgreSQL 16 engine')).toEqual([
      { name: 'PostgreSQL', version: '16', kind: 'database' },
    ])
  })

  it('版本是年份 → 丢弃且名称入黑名单', () => {
    expect(extractTechs('使用Spring 2024年度计划与Redis。')).toEqual([
      { name: 'Redis', version: null, kind: 'cache' },
    ])
  })

  it('纯中文/纯大写/空串 → []', () => {
    expect(extractTechs('系统整体采用微服务架构。')).toEqual([])
    expect(extractTechs('VRPTW and RAG are used.')).toEqual([])
    expect(extractTechs('')).toEqual([])
    expect(() => extractTechs('好'.repeat(3000))).not.toThrow()
  })

  it('字母-点交替链不触发灾难性回溯（词内量词有界）', () => {
    const evil = 'a.'.repeat(40) + ' 5x'
    const start = Date.now()
    const items = extractTechs(evil)
    expect(Date.now() - start).toBeLessThan(500)
    expect(Array.isArray(items)).toBe(true)
  })
})

describe('splitTuningSteps', () => {
  it('ENV1：lead + 3 action + outcome，P99 跨句配对 chip', () => {
    const steps = splitTuningSteps(ENV1.tuning_process)
    expect(steps.map((s) => s.kind)).toEqual(['lead', 'action', 'action', 'action', 'outcome'])
    expect(steps[0].title).toBe('2025年5月，系统进入性能攻坚阶段')
    expect(steps.filter((s) => s.kind === 'action').map((a) => a.title)).toEqual([
      '将OR-Tools的首次解策略由默认的自…',
      '显式设定求解时限',
      '开启并行搜索',
    ])
    const outcome = steps[4]
    expect(outcome.metrics?.[0]).toMatchObject({ label: 'P99', from: '9秒', to: '2.1秒', direction: 'down' })
    // chip 溯源：context=前文命中句（「P99 高达 9秒」所在原句）
    expect(outcome.metrics?.[0]?.context).toContain('P99响应时间高达9秒')
    expect(outcome.body).toContain('P99降至2.1秒')
    expect(outcome.body).toContain('灰度上线')
  })

  it('ENV2：针对句路径 B，lead + 2 action + outcome，同句 78%→92% chip', () => {
    const steps = splitTuningSteps(ENV2.tuning_process)
    expect(steps.map((s) => s.kind)).toEqual(['lead', 'action', 'action', 'outcome'])
    expect(steps.filter((s) => s.kind === 'action').map((a) => a.title)).toEqual([
      '首Token延迟偏高',
      '知识问答准确率不足',
    ])
    expect(steps[3].metrics?.[0]).toMatchObject({ label: '', from: '78%', to: '92%', direction: 'up' })
    // chip 溯源：context=成果数字所在来源句
    expect(steps[3].metrics?.[0]?.context).toContain('78%提升到92%')
  })

  it('多行/半角枚举（H2）：换行列点不整体回退', () => {
    const steps = splitTuningSteps('背景交代。\n其一，先做A。\n其二，再做B。复测通过。')
    expect(steps.map((s) => s.kind)).toEqual(['lead', 'action', 'action', 'outcome'])
    expect(steps[1].title).toBe('先做A')
    expect(steps[3].body).toBe('复测通过。')
  })

  it('残缺枚举（标记后直接标点）：跳过该标记仍可用其余标记', () => {
    const steps = splitTuningSteps('背景介绍一句。其一，问题一描述。其三，问题三描述。复测通过。')
    expect(steps.map((s) => s.kind)).toEqual(['lead', 'action', 'action', 'outcome'])
    expect(steps.filter((s) => s.kind === 'action').map((a) => a.title)).toEqual(['问题一描述', '问题三描述'])
  })

  it('标记后直接跟标点 → 标记无效；单标记/无标记/无针对句 → []', () => {
    expect(splitTuningSteps('背景一句。其一，。其二，第二个步骤描述内容。')).toEqual([])
    expect(splitTuningSteps('只有一段。其一，独苗描述。')).toEqual([])
    expect(splitTuningSteps('我们做了很多优化，性能不错。')).toEqual([])
    expect(splitTuningSteps('')).toEqual([])
  })

  it('超 2000 字只扫描前 2000 字；「统一是」不误伤', () => {
    const long = '背景交代。一是步骤一内容很多。二是步骤二内容很多。'.padEnd(2100, '好')
    expect(splitTuningSteps(long).map((s) => s.kind)).toEqual(['lead', 'action', 'action'])
    // 「统一是」不当作「一是」标记：完整进 lead，枚举正常切
    const unify = splitTuningSteps('大家统一是好消息。一是先做甲。二是再做乙。')
    expect(unify.map((s) => s.kind)).toEqual(['lead', 'action', 'action'])
    expect(unify[0].title).toBe('大家统一是好消息')
    expect(() => splitTuningSteps('好'.repeat(3000))).not.toThrow()
  })
})

describe('splitProblemPairs', () => {
  it('ENV1（其一/句号分离）：intro + 3 对，问题/解决均完整', () => {
    const block = splitProblemPairs(ENV1.problems_solutions)
    expect(block.intro).toBe('项目实施中我重点解决了三个关键问题。')
    expect(block.pairs).toHaveLength(3)
    expect(block.pairs[0].problem).toBe('超大规模门店订单使距离矩阵计算与整体求解耗时不可控')
    expect(block.pairs[0].solution).toContain('我利用OSRM离线预计算')
    expect(block.pairs.every((p) => p.solution !== null)).toBe(true)
  })

  it('ENV2（一是/同句逗号+我们）：3 对走策略 b', () => {
    const block = splitProblemPairs(ENV2.problems_solutions)
    expect(block.intro).toBe('项目中有三个关键问题令我印象深刻。')
    expect(block.pairs).toHaveLength(3)
    expect(block.pairs[0].problem).toBe('制度问答初测时，模型在既有的RAG架构下仍偶发编造条款')
    expect(block.pairs[0].solution).toContain('我们在调优阶段改进切分与重排')
    expect(block.pairs.every((p) => p.solution !== null)).toBe(true)
  })

  it('多行枚举与半角逗号+空格前导（H2）不整体回退；短段走中性单卡零丢失', () => {
    const multi = splitProblemPairs(
      '项目解决了两个关键问题。\n其一，超大规模订单导致距离矩阵计算耗时不可控。我做了预计算。\n其二，装载率长期偏低。我们引入三维装载校验。'
    )
    expect(multi.intro).toBe('项目解决了两个关键问题。')
    expect(multi.pairs).toHaveLength(2)
    expect(multi.pairs[0]).toEqual({
      problem: '超大规模订单导致距离矩阵计算耗时不可控',
      solution: '我做了预计算。',
    })

    const half = splitProblemPairs('项目有三个问题, 其一排线耗时过长影响交付。我们优化了算法。其二装载率低。')
    expect(half.pairs).toHaveLength(2)
    expect(half.pairs[0].problem).toBe('排线耗时过长影响交付')
    expect(half.pairs[1]).toEqual({ problem: '装载率低。', solution: null })
  })

  it('「统一是」不是枚举标记（含逗号前导也不误伤）', () => {
    const a = splitProblemPairs(
      '大家统一是好消息。一是物流下单字段抽取准确率仅85%，我们对模型做LoRA微调。二是会话易断，我们设计统一认证网关。'
    )
    expect(a.intro).toBe('大家统一是好消息。')
    expect(a.pairs[0].problem).toBe('物流下单字段抽取准确率仅85%')
    // 第二段问题侧不足 6 字（「会话易断」）→ 整段中性单卡，文本零丢失
    expect(a.pairs[1]).toEqual({ problem: '会话易断，我们设计统一认证网关。', solution: null })

    const b = splitProblemPairs('考虑到，统一是关键。其一，问题甲足够长了，我们解决甲。其二，问题乙也足够长，我们解决乙。')
    expect(b.pairs).toHaveLength(2)
    expect(b.pairs[0].problem).toBe('问题甲足够长了')
    expect(b.pairs[0].solution).toBe('我们解决甲。')
  })

  it('单标记/残缺枚举/超 2000 字 → 空块回退', () => {
    expect(splitProblemPairs('总起。其一，唯一的一段描述。')).toEqual({ intro: '', pairs: [] })
    expect(splitProblemPairs('其一，。其二正常描述很长了。')).toEqual({ intro: '', pairs: [] })
    expect(splitProblemPairs('其一，' + 'x'.repeat(2100))).toEqual({ intro: '', pairs: [] })
    expect(splitProblemPairs('')).toEqual({ intro: '', pairs: [] })
    expect(() => splitProblemPairs('!'.repeat(3000))).not.toThrow()
  })
})

describe('extractRoleTitle', () => {
  it('两套真实 my_role 均抽出「项目负责人兼系统架构师」', () => {
    expect(extractRoleTitle(ENV1.my_role)).toBe('项目负责人兼系统架构师')
    expect(extractRoleTitle(ENV2.my_role)).toBe('项目负责人兼系统架构师')
  })

  it('负例：无触发词/无职位词/含我们/超长/空串 → null', () => {
    expect(extractRoleTitle('我负责后端开发，日常写代码。')).toBeNull()
    expect(extractRoleTitle('作为对比，两个系统差异明显。')).toBeNull()
    expect(extractRoleTitle('作为我们团队的负责人，我统筹一切。')).toBeNull()
    expect(extractRoleTitle('作为' + '甲'.repeat(60))).toBeNull()
    expect(extractRoleTitle('')).toBeNull()
    expect(extractRoleTitle('As the lead engineer, I ran the project.')).toBeNull()
  })
})
