import { describe, it, expect } from 'vitest'
import {
  TECH_GLOSSARY_KEYS,
  GLOSSARY_KEY_SHAPE,
  normalizeTechName,
  glossaryKeyFor,
} from './tech-glossary'

// 两套已验证真实环境材料（与 env-structure.test.ts 同源）中 extractTechs 能抽出的技术名。
const ENV1_NAMES = ['Google OR-Tools', 'OSRM', 'PostgreSQL', 'PostGIS']
const ENV2_NAMES = [
  'Qwen2.5-14B-Instruct',
  'vLLM',
  'BGE-M3',
  'Milvus',
  'Spring Boot',
  'Spring Cloud Alibaba',
]

describe('normalizeTechName', () => {
  it('小写化 + 非「小写字母/数字」段折叠为单个连字符 + 去首尾空白与连字符', () => {
    expect(normalizeTechName('Google OR-Tools')).toBe('google-or-tools')
    expect(normalizeTechName('Qwen2.5-14B-Instruct')).toBe('qwen2-5-14b-instruct')
    expect(normalizeTechName('  Redis ')).toBe('redis')
    expect(normalizeTechName('K8s')).toBe('k8s')
    expect(normalizeTechName('BGE-M3')).toBe('bge-m3')
  })

  it('空串与纯符号输入安全', () => {
    expect(normalizeTechName('')).toBe('')
    expect(normalizeTechName('  ')).toBe('')
    expect(normalizeTechName('。。')).toBe('')
  })
})

describe('glossaryKeyFor：精确命中（大小写/前后空白归一）', () => {
  it('规范名恰为词条', () => {
    expect(glossaryKeyFor('redis')).toBe('redis')
    expect(glossaryKeyFor('  vLLM ')).toBe('vllm')
    expect(glossaryKeyFor('K8s')).toBe('k8s')
    expect(glossaryKeyFor('JMeter')).toBe('jmeter')
    expect(glossaryKeyFor('OSRM')).toBe('osrm')
  })
})

describe('glossaryKeyFor：边界匹配（空格/连字符隔开的版本号后缀）', () => {
  it('空格 + 版本号后缀 → 命中基础词条', () => {
    expect(glossaryKeyFor('PostgreSQL 17')).toBe('postgresql')
    expect(glossaryKeyFor('Redis 7.2')).toBe('redis')
    expect(glossaryKeyFor('Milvus 2.4')).toBe('milvus')
    expect(glossaryKeyFor('Spring Boot 3')).toBe('spring-boot')
    expect(glossaryKeyFor('Vue 3.4')).toBe('vue')
    expect(glossaryKeyFor('Node 20')).toBe('node')
    expect(glossaryKeyFor('OSRM 5.28')).toBe('osrm')
    expect(glossaryKeyFor('PostGIS 3.5')).toBe('postgis')
    expect(glossaryKeyFor('vLLM 0.6')).toBe('vllm')
  })

  it('连写版本号（数字紧跟词条）→ 数字分支命中', () => {
    expect(glossaryKeyFor('Qwen2.5-14B-Instruct')).toBe('qwen')
    expect(glossaryKeyFor('GLM-4')).toBe('glm')
    expect(glossaryKeyFor('vue3')).toBe('vue')
    expect(glossaryKeyFor('JMeter5.6')).toBe('jmeter')
  })

  it('多词条名命中其最长词条', () => {
    expect(glossaryKeyFor('Google OR-Tools')).toBe('or-tools')
    expect(glossaryKeyFor('Spring Cloud Alibaba')).toBe('spring-cloud')
    expect(glossaryKeyFor('BGE-M3')).toBe('bge')
  })
})

describe('glossaryKeyFor：未命中与边界不误配', () => {
  it('无词条技术名 / 空串 → null（回退原 title 行为）', () => {
    expect(glossaryKeyFor('Tech 1')).toBeNull()
    expect(glossaryKeyFor('')).toBeNull()
    expect(glossaryKeyFor('   ')).toBeNull()
  })

  it('词条须在边界上：前缀重叠不误配', () => {
    expect(glossaryKeyFor('google')).toBeNull() // 'go' 后跟字母，不配
    expect(glossaryKeyFor('roberta')).toBeNull() // 'bert' 不在串首/连字符后
    expect(glossaryKeyFor('javascript')).toBeNull() // 'java' 后跟字母，不配
    expect(glossaryKeyFor('SpringBoot')).toBeNull() // 无连字符，'spring-boot' 不边界匹配
  })
})

describe('glossaryKeyFor：与 extractTechs 真实素材对账', () => {
  it('ENV1/ENV2 全部技术名均有词条', () => {
    expect(ENV1_NAMES.map(glossaryKeyFor)).toEqual(['or-tools', 'osrm', 'postgresql', 'postgis'])
    expect(ENV2_NAMES.map(glossaryKeyFor)).toEqual([
      'qwen',
      'vllm',
      'bge',
      'milvus',
      'spring-boot',
      'spring-cloud',
    ])
  })
})

describe('TECH_GLOSSARY_KEYS 词条形状', () => {
  it('40 条、无重复、均满足 key 形状（小写/数字/连字符，无点）', () => {
    expect(TECH_GLOSSARY_KEYS).toHaveLength(40)
    expect(new Set(TECH_GLOSSARY_KEYS).size).toBe(40)
    for (const key of TECH_GLOSSARY_KEYS) {
      expect(GLOSSARY_KEY_SHAPE.test(key)).toBe(true)
    }
  })
})
