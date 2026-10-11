// 软考论文题库种子数据（生成物，勿手改）——由题库提取管线从本机语料 API 生成。
// 生成时间：2026-10-11；SEED_VERSION 1
// 来源（考试元数据，逐字引用）：
//   - 真题 md：source:1r4qun27b2y21z68casr「论文真题+模拟-文字版.md」
//   - 范文库标题清单：GET /api/ruankao/essay-marks/library（希赛论文范文/芝士架构论文范文 两夹）
// 红线（ADR-017 / 离线语料产物准入）：本文件只含考试元数据——题目标题、年份 marker、
// 三问逐字原文、来源引用；范文正文、背景段叙事、参考解析一律不入内。
// 类型说明：v2 形状（Q 线落地 question-bank.ts 后可改为从该文件 import，结构须逐字一致）。

export type QuestionOrigin = 'real' | 'mock'

export interface RuankaoQuestionSourceRef {
  /** 'zhenti_md' | 'essay_library' | 'lunwen_pdf' | 'exam_note' */
  kind: string
  /** 'source:<id>'；纯文本出处为 null */
  sourceId: string | null
  /** 展示夹名：真题md / 希赛论文范文 / 芝士架构论文范文 / 论文（PDF） */
  folder: string
}

export interface RuankaoQuestion {
  /** 种子: 'ruankao-question-seed-' + 规范化标题稳定 hash（sha256 前 10 hex） */
  id: string
  /** 允许 ''；真题 marker 原样（'2024'、'2025 下'） */
  year: string
  title: string
  /** 技术域标签，自由文本 */
  domain: string
  q1: string
  q2: string
  q3: string
  practiced: boolean
  origin: QuestionOrigin
  /** 判定依据（中文数据字段，不进 i18n） */
  originNote?: string
  sourceRefs: RuankaoQuestionSourceRef[]
  source: 'seed' | 'user'
  createdAt: string
  updatedAt: string
}

export const SEED_VERSION: number = 1

export const SEED_QUESTIONS: readonly RuankaoQuestion[] = [
  {
    "id": "ruankao-question-seed-fa2045ae62",
    "year": "2025 下",
    "title": "软件测试",
    "domain": "综合",
    "q1": "软件测试\n秒杀场景，描述扩容，动静分离，缓存，服务降级，限流并说下具体实现\n说说你的项目中如何实现秒杀 -> 从ATAM流程，需求场景收集、架构描述与质量分析构造、折中权衡 角度讲了各种性能、可用性",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "real",
    "originNote": "2025下半年真题小节·考生回忆简记",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-a375630f22",
    "year": "2024",
    "title": "论大数据Lambda架构",
    "domain": "微服务与分布式",
    "q1": "1.概要叙述你参与管理和开发的软件项目以及你在其中所承担的主要工作。",
    "q2": "2.Lambda体系结构将数据流分为三个层次：批处理层（batch layer）、加速层（speed layer）和服务层（serving layer），请简要分析这三个层次的特性和用途。",
    "q3": "3.具体阐述你参与管理和开发的项目是如何基于Lambda架构实现大数据处理的。",
    "practiced": false,
    "origin": "real",
    "originNote": "真题md·真题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-ff90e8576b",
    "year": "2024",
    "title": "论模型驱动架构设计方法及其应用",
    "domain": "架构风格与设计模式",
    "q1": "1.概要叙述你参与分析、设计的软件项目以及你在其中所承担的主要工作。",
    "q2": "2.请简要描述采用模型驱动架构思想进行软件开发的全过程及其特点。",
    "q3": "3.具体阐述你参与的软件项目是如何基于模型驱动架构完成分析、设计和开发的。",
    "practiced": false,
    "origin": "real",
    "originNote": "真题md·真题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-35a1be2aa7",
    "year": "2024",
    "title": "论区块链技术及应用",
    "domain": "综合",
    "q1": "1.概要叙述你参与管理和开发的软件项目以及你在其中所承担的主要工作。",
    "q2": "2.区块链包含多种核心技术，请简要描述区块链的3种核心技术。",
    "q3": "3.具体阐述你参与管理和开发的项目是如何应用区块链技术进行设计与实现。",
    "practiced": false,
    "origin": "real",
    "originNote": "真题md·真题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-d3a512cb16",
    "year": "2024",
    "title": "论软件维护方法及其应用",
    "domain": "综合",
    "q1": "1.概要叙述你参与管理和开发的软件项目，以及你在其中所承担的主要工作。",
    "q2": "2.详细论述影响软件维护工作的因素有哪些。",
    "q3": "3.结合你具体参与管理和开发的实际项目，说明在具体维护过程中，如何度量软件的可维护性，说明具体的软件维护工作类型。",
    "practiced": false,
    "origin": "real",
    "originNote": "真题md·真题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-24ee90406b",
    "year": "2022",
    "title": "论面向方面的编程技术及其应用（AOP）",
    "domain": "架构风格与设计模式",
    "q1": "1、概要叙述你所参与管理或开发的软件项目，以及你在其中所承担的主要工作。",
    "q2": "2、叙述在项目实践过程使用AOP技术开发的具体步骤。",
    "q3": "3、结合项目，论述使用AOP的原因，开发过程中存在的问题及所使用技术带来的实际应用效果。",
    "practiced": false,
    "origin": "real",
    "originNote": "真题md·真题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-88c855862a",
    "year": "2022",
    "title": "论企业集成平台的理解与应用",
    "domain": "消息与集成",
    "q1": "1、概要叙述你所参与管理或开发的软件项目，以及你在其中所承担的主要工作。",
    "q2": "2、给出至少4种企业集成平台应具有的基本功能，并对这4种功能内涵进行简述。",
    "q3": "3、阐述你在软件开发的过程中都遇到了哪些实际问题及解决方法。",
    "practiced": false,
    "origin": "real",
    "originNote": "真题md·真题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-dc6658fe72",
    "year": "2020",
    "title": "论数据分片技术及其应用",
    "domain": "缓存与存储",
    "q1": "1.概要叙述你参与管理和开发软件的项目以及承担的工作。",
    "q2": "2. Hash分片、一致性Hash (Consistent Hash)分片和按照数据范围(Range Based)分片是三种常用的数据分片方式。请简要阐述三种分片方式的原理。",
    "q3": "3.具体阐述你参与管理和开发的项目采用了哪些分片方式，并且具体说明其实现过程和应用效果。",
    "practiced": false,
    "origin": "real",
    "originNote": "真题md·真题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-0d600467a2",
    "year": "2019",
    "title": "论软件设计方法及其应用",
    "domain": "综合",
    "q1": "1.概要叙述你所参与管理或开发的软件项目，以及你在其中所承担的主要工作。",
    "q2": "2.详细阐述有哪些不同的软件设计方法，并说明每种方法的适用场景。",
    "q3": "3.详细说明你所参与的软件开发项目中，使用了哪种软件设计方法，具体实施效果如何。",
    "practiced": false,
    "origin": "real",
    "originNote": "真题md·真题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-6692270d27",
    "year": "2018",
    "title": "论软件开发过程RUP及其应用",
    "domain": "综合",
    "q1": "1.概要叙述你参与管理和开发的软件项目以及你在其中所担任的主要工作。",
    "q2": "2.详细论述软件开发过程产品RUP所包含的4个阶段以及RUP的基本特征。",
    "q3": "3.结合你所参与管理和开发的软件项目，详细阐述RUP在该项目中的具体实施内容，包括核心工作流的选择、制品的确定、各个阶段之间的演进及迭代计划以及工作流内部结构的规划等。",
    "practiced": false,
    "origin": "real",
    "originNote": "真题md·真题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-934d7a70cc",
    "year": "2018",
    "title": "论软件体系结构的演化",
    "domain": "综合",
    "q1": "1. 概要叙述你参与管理和开发的软件项目以及你在其中所承担的主要工作。",
    "q2": "2. 软件体系结构的演化是使用系统演化步骤去修改系统，以满足新的需求。简要论述系统演化的6个步骤。",
    "q3": "3. 具体阐述你参与管理和开发的项目是如何基于系统演化的6个步骤完成软件体系结构演化的。",
    "practiced": false,
    "origin": "real",
    "originNote": "真题md·真题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-a21ff4d1cc",
    "year": "2017",
    "title": "论无服务器架构及其应用",
    "domain": "云原生与运维",
    "q1": "1.概要叙述你参与分析和设计的软件系统开发项目以及你所担任的主要工作。",
    "q2": "2.与传统的企业应用系统相比较，基于无服务器架构的应用系统具有哪些特点，请列举至少3个特点，并进行解释。",
    "q3": "3. 结合你具体参与分析和设计的软件开发项目，描述该软件的架构，说明该架构是如何采用无服务器架构模式的，并说明在采用无服务器架构后软件开发过程中遇到的实际问题和解决方案。",
    "practiced": false,
    "origin": "real",
    "originNote": "真题md·真题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      },
      {
        "kind": "essay_library",
        "sourceId": "source:f5nhm23sg2jxaptazf0k",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-2e2f6fdf45",
    "year": "",
    "title": "多模型数据库及应用",
    "domain": "缓存与存储",
    "q1": "①概要叙述你所参与管理或开发的软件项目，以及你在其中所承担的主要工作。",
    "q2": "②说明多模型的数据是如何体现的，如何采用多模型数据库进行统一管理的优势。",
    "q3": "③结合你具体参与管理和开发的项目，详细论述如何设计基于多模型数据库的信息系统。",
    "practiced": false,
    "origin": "real",
    "originNote": "考生回忆版·年份未标注",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-a8e94426b9",
    "year": "",
    "title": "论多源异构数据集成方法",
    "domain": "消息与集成",
    "q1": "1、预计：项目信息",
    "q2": "2、异构数据常见的体现方面和采用的技术线路",
    "q3": "3、预计：结合项目说明具体实施过程/遇到的问题及解决方案",
    "practiced": false,
    "origin": "real",
    "originNote": "考生回忆版·年份未标注",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-d9893605ed",
    "year": "",
    "title": "论分布式事务及其解决方案",
    "domain": "微服务与分布式",
    "q1": "1、预计：项目信息",
    "q2": "2、常用的四种基于分布式事务的解决方案，基于分布式事务的解决方案\n如何进行事务处理",
    "q3": "3、预计：结合项目说明具体实施过程/遇到的问题及解决方案",
    "practiced": false,
    "origin": "real",
    "originNote": "考生回忆版·年份未标注",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-1227d854a1",
    "year": "",
    "title": "论负载均衡技术",
    "domain": "可靠性与容错",
    "q1": "①概要叙述你所参与管理或开发的软件项目，以及你在其中所承担的主要工作。",
    "q2": "②说明静态负载均衡，动态负载均衡，基于场景的负载均衡都包含哪几种策略，简要进行介绍。",
    "q3": "③结合你具体参与管理和开发的项目，说明负载均衡技术的具体应用。",
    "practiced": false,
    "origin": "real",
    "originNote": "考生回忆版·年份未标注",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-db33e6bdfd",
    "year": "",
    "title": "论基于DSSA的软件架构设计与应用",
    "domain": "架构风格与设计模式",
    "q1": "1.概要叙述你参与管理和开发的软件项目以及你在其中所承担的主要工作。",
    "q2": "2. DSSA的建立过程分为5个阶段，每个阶段可以进一步划分为一些步骤或子阶段，就你所熟悉的领域，请给出针对该特定领域，在基于DSSA的软件设计开发中每个阶段的主要目标。",
    "q3": "3、具体阐述你参与管理和开发的项目中如何具体实施的，最终实际效果如何。",
    "practiced": false,
    "origin": "real",
    "originNote": "考生回忆版·年份未标注",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-1eca800d40",
    "year": "",
    "title": "论面向服务的架构设计",
    "domain": "综合",
    "q1": "1、预计：项目信息",
    "q2": "2、websevice的实现过程和soa具有哪些基本特征可以支持软件功能重用",
    "q3": "3、预计：结合项目说明具体实施过程/遇到的问题及解决方案",
    "practiced": false,
    "origin": "real",
    "originNote": "考生回忆版·年份未标注",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-3e3bbc284a",
    "year": "",
    "title": "论软件测试方法及应用",
    "domain": "综合",
    "q1": "①概要叙述你参与管理和开发的软件项目以及你在其中所承担的主要工作。",
    "q2": "②详细描述AI测试用例生成的基本处理流程，说明各个步骤的基本内容。",
    "q3": "③结合你具体参与管理和开发的项目，说明你如何实施AI测试用例生成，给出具体实施过程以及应用效果。",
    "practiced": false,
    "origin": "real",
    "originNote": "考生回忆版·年份未标注",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-518ef44efb",
    "year": "",
    "title": "论软件设计模式及其应用",
    "domain": "架构风格与设计模式",
    "q1": "1.概要叙述你参与分析和开发的软件系统，以及你在项目中所担任的主要工作。",
    "q2": "2.说明常用的软件设计模式有哪几类？阐述每种类型特点及其所包含的设计模式。",
    "q3": "3.详细说明你所参与的软件系统开发项目中，采用了哪些软件设计模式，具体实施效果如何。",
    "practiced": false,
    "origin": "real",
    "originNote": "考生回忆版·年份未标注",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      },
      {
        "kind": "essay_library",
        "sourceId": "source:kld34y8q1w9q1x1zp28x",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-aab4adce32",
    "year": "",
    "title": "论软件维护及其应用",
    "domain": "综合",
    "q1": "1、预计：项目信息",
    "q2": "2、软件维护的主要内容，提高可维护性的常见方法",
    "q3": "3、预计：结合项目说明具体实施过程遇到的问题以及处理结果",
    "practiced": false,
    "origin": "real",
    "originNote": "考生回忆版·年份未标注",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-5fa0f01d80",
    "year": "",
    "title": "论软件质量保证及其应用",
    "domain": "综合",
    "q1": "概要叙述你参与管理和开发的软件项目以及你在其中所担任的主要工作。",
    "q2": "详细论述软件质量保证中常见的活动有哪些？阐述每个活动的主要内容。",
    "q3": "结合你具体参与管理和开发的实际项目，说明是如何实施软件质量保证的各项活动，说明其实施过程及应用效果。",
    "practiced": false,
    "origin": "real",
    "originNote": "考生回忆版·年份未标注",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-e41c3d120a",
    "year": "",
    "title": "论事件驱动架构",
    "domain": "微服务与分布式",
    "q1": "①概要叙述你所参与管理或开发的软件项目，以及你在其中所承担的主要工作。",
    "q2": "②说明事件驱动架构思想的全过程及其特点。",
    "q3": "③结合你具体参与管理和开发的项目，分析、设计与实现事件驱动架构。",
    "practiced": false,
    "origin": "real",
    "originNote": "考生回忆版·年份未标注",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-29e721f5d8",
    "year": "",
    "title": "论数据访问层设计技术及其应用",
    "domain": "缓存与存储",
    "q1": "1.概要叙述你参与管理和开发的与数据访问层设计有关的软件项目，以及你在其中所担任的主要工作。",
    "q2": "2.详细论述常见的数据访问层设计技术及其所包含的主要内容。",
    "q3": "3.结合你参与管理和开发的实际项目，具体说明采用了哪种数据访问层设计技术，并叙述具体实施过程以及应用效果。",
    "practiced": false,
    "origin": "real",
    "originNote": "考生回忆版·年份未标注",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-49906311e1",
    "year": "",
    "title": "论 DevSecOps 及其应用",
    "domain": "云原生与运维",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:f4eg0yivr44rg70o36zp",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-772605c2e7",
    "year": "",
    "title": "论边缘计算及其应用",
    "domain": "物联网与嵌入式",
    "q1": "1.概要叙述你参与管理和开发的软件项目以及你在其中所承担的主要工作",
    "q2": "2.结合项目实际，概要说明六种边云协同，既资源协同、数据协同、智能协同、应用管理协同、业务管理协同、服务协同的含义。",
    "q3": "3.具体阐述你参与管理和开发的项目如何利用边缘计算进行设计与实现。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-409b4bf556",
    "year": "",
    "title": "论大规模分布式系统缓存设计策略",
    "domain": "微服务与分布式",
    "q1": "1. 概要叙述你参与实施的大规模分布式系统开发项目以及你所担任的主要工作。",
    "q2": "2. 从不同的用途和应用场景考虑，请详细阐述至少两种常见的缓存工作模式，并说明每种工作模式的适应场景。",
    "q3": "3. 阐述你在设计大规模分布式系统的缓存机制时遇到了哪些问题，如何解决。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      },
      {
        "kind": "essay_library",
        "sourceId": "source:3bsg7kfn4vn4wrtc45y9",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-945356befb",
    "year": "",
    "title": "论大规模分布式系统缓存设计策略摘要",
    "domain": "微服务与分布式",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:de1k5fzyqtpvc87ac2mu",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-24cbe58ebb",
    "year": "",
    "title": "论大模型技术及应用",
    "domain": "AI 与智能应用",
    "q1": "1.概要叙述你参与管理和开发的、 采用大模型的软件项目以及你在其中所承担的主要工作。",
    "q2": "2.DeepSeek作为大模型技术的前沿实践者，在其架构中既融合了多项传统IT技术，也有一些新技术的革新，结合实践，至少举例5种相关技术进行介绍。",
    "q3": "3.具体阐述你参与管理和开发的项目是如何应用大模型的，详细论述在项目设计与实现过程中遇到了哪些实际问题，是如何解决的。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-7de09e92a8",
    "year": "",
    "title": "论大语言模型辅助软件测试（反诈止付）",
    "domain": "安全与风控",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:gvsn9iyp5q50kl99b01x",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-87d42f1f73",
    "year": "",
    "title": "论大语言模型辅助软件测试（政务服务）",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:1432hi3yui0mant00yjd",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-59e903f6cb",
    "year": "",
    "title": "论单元测试方法及其应用",
    "domain": "综合",
    "q1": "1.概要叙述你参与管理和开发的软件项目，以及你在其中所担任的主要工作。",
    "q2": "2.结合你具体参与管理和开发的实际项目，详细论述单元测试中静态测试、动态测试方法的基本内容。",
    "q3": "3.结合你具体参与管理和开发的实际项目，说明在单元测试过程中，如何确定白盒测试的覆盖标准，如何组织实施回归测试。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-292704e573",
    "year": "",
    "title": "论分布式存储系统架构设计",
    "domain": "微服务与分布式",
    "q1": "1、概要叙述你参与分析和开发的分布式存储系统项目以及你所承担的主要工作。",
    "q2": "2、简要说明在分布式存储系统架构设计中所使用的分布式存储技术及其实现机制，详细叙述你在具体项目中选用了哪种分布式存储技术，说明其原因和实施效果。",
    "q3": "3、冗余是提高分布式存储系统可靠性的主要方法，通常在分布式存储系统设计中可采用哪些冗余技术来提升系统的可靠性？你在具体项目中选用了哪种冗余技术？说明其原因和实施效果。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-17a83bdab2",
    "year": "",
    "title": "论分布式数据库的集成",
    "domain": "微服务与分布式",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:ec616zlmc559zrufkbrm",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-7ea8b90314",
    "year": "",
    "title": "论分布式数据库的设计和实现",
    "domain": "微服务与分布式",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:k6yo98wozvsdqoyqfy73",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-9191642788",
    "year": "",
    "title": "论服务治理及其应用",
    "domain": "微服务与分布式",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:xwtancjj7wfcbyguw7ip",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-5eb0b12c05",
    "year": "",
    "title": "论负载均衡技术在Web系统中的应用",
    "domain": "可靠性与容错",
    "q1": "1:概要叙述你参与管理和开发的软件项目，以及你在其中所承担的主要工作。",
    "q2": "2:详细阐述常见的三种负载均衡算法，说明算法的基本原理。",
    "q3": "3:详细说明你所参与的软件开发项目中，如何基于负载均衡算法实现Web应用系统的负载均衡。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-9ffb3db3f5",
    "year": "",
    "title": "论改进Web服务器性能的有关技术",
    "domain": "Web 与前后端架构",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:upohrv3jn7rwqcp16p8z",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-37b9ba27a8",
    "year": "",
    "title": "论高并发系统的设计与实践（购车平台）",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:6b1fwn3c2mzz5m1sjcgz",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-5e6d8927a7",
    "year": "",
    "title": "论高并发系统的设计与实践（警情平台）",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:8kjzpdng64zdtd7fswzz",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-641653a551",
    "year": "",
    "title": "论高并发系统的设计与实践（企业 AI 办公）",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:370eiiac7oljapk5rmpi",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-02e3e380fd",
    "year": "",
    "title": "论高并发系统的设计与实践（遥感平台）",
    "domain": "大数据与实时计算",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:6hdnghmyhweee6lzldyi",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-fb42a5241d",
    "year": "",
    "title": "论高并发系统的设计与实践（智慧停车）",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:kyt549sim0wpp1b9r9io",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-ced974c322",
    "year": "",
    "title": "论高并发系统架构设计与实践（券核销）",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:yyf6v5kbk35mveo1rlsg",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-bbda43ec47",
    "year": "",
    "title": "论高可靠性系统中软件容错技术的应用",
    "domain": "可靠性与容错",
    "q1": "1. 简述你参与设计和开发的、与容错相关的软件项目以及你所承担的主要工作。",
    "q2": "2. 具体论述你在设计软件时，如何考虑容错问题，采用了哪几种容错技术和方法。",
    "q3": "3. 分析你所采用的容错方法是否达到系统的可靠性和实时性要求。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      },
      {
        "kind": "essay_library",
        "sourceId": "source:tktzb8ubxqohpttn75yp",
        "folder": "希赛论文范文"
      },
      {
        "kind": "essay_library",
        "sourceId": "source:cm5o5d5qtf78lek8vu3c",
        "folder": "希赛论文范文"
      },
      {
        "kind": "essay_library",
        "sourceId": "source:5e288rg937bfnwdcw3d8",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-3f3d4d9baf",
    "year": "",
    "title": "论湖仓一体架构及其应用",
    "domain": "大数据与实时计算",
    "q1": "1.概要叙述你参与管理和开发的、采用湖仓一体架构的软件项目以及你在其中所承担的主要工作。",
    "q2": "2.请对湖仓一体架构进行总结与分析，给出其中四类关键特征，并简要对这四类关键特征的内涵进行阐述。",
    "q3": "3.具体阐述你参与管理和开发的项目是如何采用湖仓一体架构的，并围绕上述四类关键特征，详细论述在项目设计与实现过程中遇到了哪些实际问题，是如何解决的。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-51945d986c",
    "year": "",
    "title": "论基于场景的软件体系结构评估方法",
    "domain": "综合",
    "q1": "1．概要叙述你参与管理和开发的软件项目以及你在其中所担任的主要工作，包括角色、工作内容等。",
    "q2": "2．请从评估目的、评估参与者、评估活动或过程、评估结果等几个方面对SAAM或ATAM评估方法进行分析。",
    "q3": "3．结合你参与的实际工作和项目的实际情况，具体阐述你在进行体系结构设计和评估时，采用了什么评估方法，如何具体实施，最终实际效果如何。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-c2d81c5971",
    "year": "",
    "title": "论基于构件的软件开发",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:zx917wmkim0s41ncqirb",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-cdef949d29",
    "year": "",
    "title": "论基于构件的软件开发方法的应用",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:5wqua8m4yb70ed8smcop",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-5f22733d50",
    "year": "",
    "title": "论基于构件的软件开发方法及其应用 - 腾讯云",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:hrn0kd2dbs98nzro2l9c",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-7a04081a84",
    "year": "",
    "title": "论基于架构的软件设计方法（ABSD）的应用",
    "domain": "架构风格与设计模式",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:sdla0rurkfsdh4rq83dt",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-e172891605",
    "year": "",
    "title": "论面向服务的架构及其应用",
    "domain": "微服务与分布式",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:62yb545lyo5jn666zmwx",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-94dd188e16",
    "year": "",
    "title": "论企业集成平台的技术及应用",
    "domain": "消息与集成",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:5jog542m2nrlfej28wti",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-7b4b380fbb",
    "year": "",
    "title": "论企业集成平台的技术与应用2",
    "domain": "消息与集成",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:tomznqffa3pr1kysqeds",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-0c45f5e0eb",
    "year": "",
    "title": "论企业信息化战略实施与部署",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:xcxrh810czrlhij1kv0s",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-f4c9b46fe6",
    "year": "",
    "title": "论企业智能运维技术与方法",
    "domain": "云原生与运维",
    "q1": "1.概要叙述你参与管理与实施的软件运维项目以及你在其中所担任的主要工作。",
    "q2": "2.智能运维主要从效率提高、质量保障和成本管理等三个方面提升运维水平，其成熟程度可以分为尝试应用、单点应用、串联应用、能力完备和能力成熟等五个级别，请任意选择三个成熟度级别，说明其在效率提升、质量保障和成本管理等方面的特征。",
    "q3": "3.结合你具体参与管理与实施的实际软件系统运维项目，举例说明如何采用智能运维技术和方法提高运维效率、保障运维质量并降低运维成本，实施效果如何。在智能运维过程中都遇到了哪些具体问题，是如何解决的。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-6cb9165432",
    "year": "",
    "title": "论嵌入式实时软件测试方法和工具的选用",
    "domain": "物联网与嵌入式",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:gkhgdi0oxvxuwsz3w6jx",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-6d20d0d90f",
    "year": "",
    "title": "论软件测试方法和工具的选用",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:h2ignbhu043k543rxppd",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-e2135dfbd1",
    "year": "",
    "title": "论软件测试中缺陷管理及其应用",
    "domain": "综合",
    "q1": "1.概要叙述你参与管理和开发的软件项目以及承担的工作。",
    "q2": "2.详细论述常见的缺陷种类及级别，论述缺陷管理的基本流程。",
    "q3": "3.结合你具体参与管理和开发的实际项目，说明是如何进行缺陷管理的。请具体说明实施过程以及应用效果。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-76d1e22b49",
    "year": "",
    "title": "论软件的可靠性设计",
    "domain": "可靠性与容错",
    "q1": "1.概要叙述你参与管理和开发的软件项目以及你在其中所担任的主要工作。",
    "q2": "2.简要说明目前比较主流的软件可靠性设计技术、结合项目实际情况，阐述所选择的可靠性设计技术及其原因。",
    "q3": "3.结合你具体参与管理和开发的实际项目，举例说明所选取的软件可靠性技术的具体实施过程，并详细分析实施效果。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      },
      {
        "kind": "essay_library",
        "sourceId": "source:9jiymoxtg8m7qqjv1lh6",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-1b2ae82a2f",
    "year": "",
    "title": "论软件的可维护性设计",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:hwv7qzs1mmnbf6sb1pne",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-f07939b766",
    "year": "",
    "title": "论软件的系统测试及其应用",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:r1q9bvrt0exvgne9y8x2",
        "folder": "希赛论文范文"
      },
      {
        "kind": "essay_library",
        "sourceId": "source:b382sss962dni4gej4yk",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-078d929c2d",
    "year": "",
    "title": "论软件过程模型的改进",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:0ob8n8cgm7dnhps6v3iz",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-d5cfb93f8e",
    "year": "",
    "title": "论软件架构风格的设计与应用（城市运行）",
    "domain": "架构风格与设计模式",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:du8h8br8ycsnm9pykrcr",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-4b1d40c512",
    "year": "",
    "title": "论软件架构风格的设计与应用（基层治理）",
    "domain": "架构风格与设计模式",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:ep64fsid3jbt1c5s56gf",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-1492388976",
    "year": "",
    "title": "论软件架构风格的设计与应用（数字教材）",
    "domain": "架构风格与设计模式",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:kq8umddk9fnn1dgqbnik",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-5392181640",
    "year": "",
    "title": "论软件架构风格的设计与应用（银行核心系统）",
    "domain": "架构风格与设计模式",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:z4oimxm2u6k24rmhhxg7",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-4e8745d0c2",
    "year": "",
    "title": "论软件架构风格的设计与应用（智能客服）",
    "domain": "架构风格与设计模式",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:iygswhc00rjx51h922uw",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-f27fd240ab",
    "year": "",
    "title": "论软件架构建模技术与应用",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:1ejd0t16so2o71adbvc2",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-c7ef60c7ed",
    "year": "",
    "title": "论软件三层结构的设计",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:6l9pc5z7g2282awi6kud",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-35286020d0",
    "year": "",
    "title": "论软件设计模式及应用",
    "domain": "架构风格与设计模式",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:hvb7o3d0qs0e5bb0dl8q",
        "folder": "希赛论文范文"
      },
      {
        "kind": "essay_library",
        "sourceId": "source:8bahj62292ihy1d7g8bs",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-67ed020fe3",
    "year": "",
    "title": "论软件系统架构风格",
    "domain": "架构风格与设计模式",
    "q1": "1.概要叙述你参与分析和开发的软件系统开发项目以及你所担任的主要工作。",
    "q2": "2.分析软件系统开发中常用的软件系统架构风格有哪些？详细阐述每种风格的具体含义。",
    "q3": "3.详细说明在你所参与的软件系统开发项目中，采用了哪种软件系统架构风格，具体实施效果如何。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-7ea52d7c93",
    "year": "",
    "title": "论软件系统架构风格及应用",
    "domain": "架构风格与设计模式",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:pct7s9vq1wwu94wubove",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-dc38f30385",
    "year": "",
    "title": "论软件系统架构评估",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:nymc51apmvzu13r5yez8",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-9369c52903",
    "year": "",
    "title": "论软件系统架构评估及其应用",
    "domain": "综合",
    "q1": "1.概要叙述你所参与管理或开发的软件项目，以及你在其中所承担的主要工作。",
    "q2": "2.详细阐述有哪些不同的软件系统架构评估方法，并从评估目标、质量属性和评估活动等方面论述其区别。",
    "q3": "3.详细说明你所参与的软件开发项目中，使用了哪种评估方法，具体实施过程和效果如何。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-9ae9f5ea85",
    "year": "",
    "title": "论软件系统建模方法及其应用",
    "domain": "综合",
    "q1": "1.概要叙述你参与的软件系统开发项目以及你所担任的主要工作。",
    "q2": "2.说明软件系统开发中常用的建模方法有哪几类？阐述每种方法的特点及其适用范围。",
    "q3": "3.详细说明你所参与的软件系统开发项目中，采用了哪些软件系统建模方法，具体 实施效果如何。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-76ebbe00d3",
    "year": "",
    "title": "论软件项目管理技术及其应用",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:021hep4p159xj24uufqu",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-8e7f6f80b3",
    "year": "",
    "title": "论软件需求获取技术及应用",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:jto5hbqbb34trc1dsg8z",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-73aa2d74a5",
    "year": "",
    "title": "论数据湖技术及其应用",
    "domain": "大数据与实时计算",
    "q1": "1.概要叙述你所参与管理或开发的软件项目，以及你在其中所承担的主要工作。",
    "q2": "2.详细阐述数据湖湖技术，并从主要数据来源、数据模式（Schema）转换时机、数据存储成本、数据质量、面对用户和主要支撑应用类型等5个方面详细论述数据湖技术与数据仓库技术的差异。",
    "q3": "3.详细说明你所参与的软件开发项目中，如何采用数据湖技术进行企业数据管理，并说明具体实施过程以及应用效果。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-b4fac95e70",
    "year": "",
    "title": "论数据中心集中存储架构",
    "domain": "缓存与存储",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:oyjh32662xwddwcczbbp",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-ff9c2ddcbb",
    "year": "",
    "title": "论网络安全体系设计",
    "domain": "安全与风控",
    "q1": "1.概要叙述你参与管理和开发的软件项目以及你在其中承担的主要工作，并详细阐述该软件系统在网络安全方面的要求。",
    "q2": "2.请对GB/T 9387.2-1995中定义的5大类安全服务进行描述，阐述每类安全服务的定义和主要实现手段。",
    "q3": "3.请结合项目实际，具体阐述你在项目中实现了上述5大类安全服务中的哪些服务，具体运用了哪些实现手段。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-e73d0066a3",
    "year": "",
    "title": "论微服务架构及其应用",
    "domain": "微服务与分布式",
    "q1": "1、概要叙述你所参与管理或开发的软件项目，以及你在其中所承担的主要工作。",
    "q2": "2、简要描述微服务优点。",
    "q3": "3、具体阐述是如何基于微服务架构进行软件设计实现的。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      },
      {
        "kind": "essay_library",
        "sourceId": "source:sk6slo3a17v5hbidk6fc",
        "folder": "希赛论文范文"
      },
      {
        "kind": "essay_library",
        "sourceId": "source:b3itged73qkqhoco14c8",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-ae4e3eb254",
    "year": "",
    "title": "论系统安全架构设计及其应用",
    "domain": "安全与风控",
    "q1": "1、概要叙述你所参与管理或开发的软件项目，以及你在其中所承担的主要工作。",
    "q2": "2、详细论述安全架构设计中鉴别框架和访问控制框架设计的内容，并论述鉴别和访问控制所面临的主要威胁，并说明其危害。",
    "q3": "3、阐述你在软件开发的过程中都遇到了哪些实际问题及解决方法。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      },
      {
        "kind": "essay_library",
        "sourceId": "source:pjuccqaisuipk5jsse4k",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-84665027df",
    "year": "",
    "title": "论系统高并发性能优化的设计与实践（跨境电商）",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:u98pajggohr18wbtlan1",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-c0efdb93d7",
    "year": "",
    "title": "论系统高并发性能优化的设计与实践（智慧医疗）",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:e6ozn1iyav114yt2iz0a",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-3e228245db",
    "year": "",
    "title": "论系统自动化测试及其应用",
    "domain": "综合",
    "q1": "1.概要叙述你参与管理和开发的软件项目以及你在其中所担任的主要工作。",
    "q2": "2.详细论述系统自动化测试的主要工作内容及优缺点。",
    "q3": "3.结合你具体参与管理和开发的实际项目，说明是如何进行系统自动化测试的，具体实施过程以及应用效果。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-fcdeebe40f",
    "year": "",
    "title": "论信息系统安全保障体系的规划与应用（智慧医院）",
    "domain": "安全与风控",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:qvgo5xjaun0icsv7xmyi",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-cc583140a3",
    "year": "",
    "title": "论信息系统的安全性与保密性设计",
    "domain": "安全与风控",
    "q1": "1.概要叙述你参与分析设计的信息系统及你所担任的主要工作。",
    "q2": "2.深入讨论作者参与建设的信息系统中，面临的安全及保密性问题，以及解决该问题采用的技术方案。",
    "q3": "3.经过系统运行实践，客观的评价你的技术方案，并指出不足，以及解决方案。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      },
      {
        "kind": "essay_library",
        "sourceId": "source:74b962n9t99mqpvq503k",
        "folder": "希赛论文范文"
      },
      {
        "kind": "essay_library",
        "sourceId": "source:2lu8zzadve4nlbrfy9ua",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-14d8478487",
    "year": "",
    "title": "论信息系统开发方法及应用",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:kr12t4134atg3ln8g841",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-f4b580e77f",
    "year": "",
    "title": "论需求分析方法及应用",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:vkric7wsphq435f6r1ag",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-b308289338",
    "year": "",
    "title": "论需求评审方法及其应用（智慧教育）",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:tbsx67r945tk6ypih53j",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-b81cb29447",
    "year": "",
    "title": "论需求评审在软件项目中的应用（老兵码）",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:k2mpe2tdwaei3bv684c1",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-d470a83137",
    "year": "",
    "title": "论需求评审在软件项目中的应用（野外勤务）",
    "domain": "综合",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:dyrbxytnakj5wipojcbn",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-19f6da9cda",
    "year": "",
    "title": "论遗留系统演化策略及其应用",
    "domain": "综合",
    "q1": "1.概要叙述你参与管理和开发的软件项目，以及你在其中所担任的主要工作。",
    "q2": "2.详细论述遗留系统评价的主要活动，论述常见的演化策略。",
    "q3": "3.结合你具体参与管理和开发的实际项目，说明如何进行遗留系统评价并选择合适的演化策略，请说明具体实施过程以及应用效果。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-91c8da1576",
    "year": "",
    "title": "论异构数据库集成应用",
    "domain": "缓存与存储",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:o9i4j32fm9jilmmwr2o9",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-5928413c88",
    "year": "",
    "title": "论云上自动化运维及其应用",
    "domain": "云原生与运维",
    "q1": "1.概要叙述你参与运维的软件项目以及你在其中所承担的主要工作。",
    "q2": "2.请简要描述云上自动化运维（如CloudOps）的主要衡量指标。",
    "q3": "3.具体阐述你所参与的项目是如何进行云上自动化运维的。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-129dcc06f3",
    "year": "",
    "title": "论云原生架构及其应用",
    "domain": "云原生与运维",
    "q1": "1.概要叙述你参与管理和开发的软件项目以及承担的主要工作。",
    "q2": "2.服务化、弹性、可观测性和自动化是云原生架构的四类设计原则，请简要并对这四类设计原则的内涵进行阐述。",
    "q3": "3.具体阐述你参与管理和开发的项目是如何采用云原生架构的，并且围绕上述四类设计原则，详细论述在项目设计与实现过程中遇到了哪些实际问题，是如何解决的。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-00abab286f",
    "year": "",
    "title": "论中间件技术的应用",
    "domain": "中间件与事务",
    "q1": "1.概要叙述你参与分析和开发的应用项目，以及你所担任的主要工作。",
    "q2": "2.具体说明你参与的项目哪些部分采用了中间件技术，为什么要采用中间件，如何实施的。",
    "q3": "3.说明中间件技术的效果，若存在不足，请指出不足，并给出解决方案。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-2b0d31185c",
    "year": "",
    "title": "论注塑机的云计算运维与异常检测",
    "domain": "云原生与运维",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:lf7ce1ob6w3805sx1b8p",
        "folder": "芝士架构论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-6c26da4dc6",
    "year": "",
    "title": "论NoSQL数据库技术及其应用",
    "domain": "缓存与存储",
    "q1": "1.概要叙述你参与管理和开发的软件项目以及你在其中所担任的主要工作。",
    "q2": "2.详细论述常见的NoSQL数据库技术及其所包含的主要内容，并说明NoSQL数据库的主要适用场景。",
    "q3": "3.结合你具体参与管理和开发的实际项目，说明具体采用哪种NoSQL数据库技术，并说明架构设计过程及其应用效果。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-a8569d87b3",
    "year": "",
    "title": "论SOA面向服务架构技术的应用",
    "domain": "微服务与分布式",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:k4heukfk2negv4lbqt7y",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-3ec93be3fe",
    "year": "",
    "title": "论SOA在企业集成架构设计中的应用",
    "domain": "微服务与分布式",
    "q1": "1、概要叙述你参与管理和实施的企业应用集成项目及你在其中所担任的主要工作。",
    "q2": "2、具体论述SOA架构的内容、特点，以及你熟悉的工具和环境对SOA的支持，在应用中重点解决了哪些问题。",
    "q3": "3、通过你的切身实践详细论述SOA在企业应用集成中发挥的作用和优势。",
    "practiced": false,
    "origin": "mock",
    "originNote": "真题md·模拟题段",
    "sourceRefs": [
      {
        "kind": "zhenti_md",
        "sourceId": "source:1r4qun27b2y21z68casr",
        "folder": "真题md"
      },
      {
        "kind": "essay_library",
        "sourceId": "source:arqwjv6lckmgeoklpmtv",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  },
  {
    "id": "ruankao-question-seed-9748ff44fa",
    "year": "",
    "title": "论Web应用系统性能优化技术与应用",
    "domain": "Web 与前后端架构",
    "q1": "",
    "q2": "",
    "q3": "",
    "practiced": false,
    "origin": "mock",
    "originNote": "题库权威未收录→默认模拟",
    "sourceRefs": [
      {
        "kind": "essay_library",
        "sourceId": "source:7z4lqk8c1t9a3b2b10yg",
        "folder": "希赛论文范文"
      }
    ],
    "source": "seed",
    "createdAt": "2026-10-11T00:00:00.000Z",
    "updatedAt": "2026-10-11T00:00:00.000Z"
  }
]
