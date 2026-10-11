import { beforeEach, describe, expect, it } from 'vitest'
import {
  RUANKAO_WIZARD_SEED_KEY,
  consumeWizardSeed,
  wizardSeedFromQuestion,
  writeWizardSeed,
} from './wizard-seed'

describe('wizard-seed channel (ruankao.wizardSeed.v1)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('round-trips the seed and consumes it one-shot (即焚)', () => {
    expect(
      writeWizardSeed({ keywords: ['微服务架构及其应用', '微服务与分布式'], name: '论微服务架构及其应用' }),
    ).toBe(true)

    const first = consumeWizardSeed()
    expect(first).toEqual({
      keywords: ['微服务架构及其应用', '微服务与分布式'],
      name: '论微服务架构及其应用',
    })
    // 一次性语义：第二次消费为空
    expect(consumeWizardSeed()).toBeNull()
  })

  it('returns null when nothing is pending and drops broken payloads', () => {
    expect(consumeWizardSeed()).toBeNull()

    window.sessionStorage.setItem(RUANKAO_WIZARD_SEED_KEY, '{not json')
    expect(consumeWizardSeed()).toBeNull()
    // 坏种子被清掉，不再留给后续挂载
    expect(window.sessionStorage.getItem(RUANKAO_WIZARD_SEED_KEY)).toBeNull()

    // 形状非法：全空载荷等价于无种子
    window.sessionStorage.setItem(
      RUANKAO_WIZARD_SEED_KEY,
      JSON.stringify({ industry: '  ', keywords: [1, 2], name: 42 }),
    )
    expect(consumeWizardSeed()).toBeNull()
  })

  it('keeps only well-formed optional fields', () => {
    window.sessionStorage.setItem(
      RUANKAO_WIZARD_SEED_KEY,
      JSON.stringify({ industry: '能源行业', keywords: ['kw'], name: '名称', extra: 'x' }),
    )
    expect(consumeWizardSeed()).toEqual({
      industry: '能源行业',
      keywords: ['kw'],
      name: '名称',
    })
  })
})

describe('wizardSeedFromQuestion derivation', () => {
  it('strips the 论 prefix, keeps the title as the mock name and skips generic domains', () => {
    expect(
      wizardSeedFromQuestion({ title: '论微服务架构及其应用', domain: '微服务与分布式' }),
    ).toEqual({
      name: '论微服务架构及其应用',
      keywords: ['微服务架构及其应用', '微服务与分布式'],
    })
    // 「综合」域不带值（生成关键词里是噪声）
    expect(wizardSeedFromQuestion({ title: '论区块链技术及应用', domain: '综合' })).toEqual({
      name: '论区块链技术及应用',
      keywords: ['区块链技术及应用'],
    })
    // 非论前缀标题与空域原样保留
    expect(wizardSeedFromQuestion({ title: '软件测试', domain: '' })).toEqual({
      name: '软件测试',
      keywords: ['软件测试'],
    })
  })
})
