import { describe, it, expect } from 'vitest'
import { AGENT_TEMPLATES } from './agent-templates'

// 金标「专业深化」徽章的数据侧契约：恰好两个软考模板被标记，
// 其余 24 个模板一律不带 deepened 字段。
describe('AGENT_TEMPLATES deepened flag', () => {
  const deepened = AGENT_TEMPLATES.filter((tpl) => tpl.deepened)

  it('marks exactly two templates as deepened', () => {
    expect(deepened).toHaveLength(2)
  })

  it('the deepened templates are the two ruankao essay templates', () => {
    expect(deepened.map((tpl) => tpl.key).sort()).toEqual([
      'ruankao-essay-coach',
      'ruankao-essay-examiner',
    ])
    expect(deepened.every((tpl) => tpl.category === 'ruankao')).toBe(true)
  })

  it('sampling parameters: coach unchanged, examiner maxTokens widened to 6144', () => {
    const coach = AGENT_TEMPLATES.find((tpl) => tpl.key === 'ruankao-essay-coach')!
    expect(coach.temperature).toBe(0.5)
    expect(coach.maxTokens).toBe(8192)

    const examiner = AGENT_TEMPLATES.find((tpl) => tpl.key === 'ruankao-essay-examiner')!
    // 判分要稳：temperature 不动；报告结构变长，仅放宽输出上限。
    expect(examiner.temperature).toBe(0.2)
    expect(examiner.maxTokens).toBe(6144)
  })
})
