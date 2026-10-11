// 发教练批改桥（批次4 写作台）：sessionStorage 一次性种子 + 整页打开笔记本聊天。
// 「预填不代发」——文本预填进聊天输入框，由考生自己点发送：契合教练红线
// 「AI 生成的表述一律要经考生改写消化」与「不代写」精神，也避免自动触发模型调用。
// 红线论证：种子文本是考生草稿（不是范文）；教练会话上下文=agent system_prompt
// + project_env 注入（用户自己的项目材料）+ 用户消息——无范文可达路径。

import { agentsApi } from '@/lib/api/agents'
import { notebooksApi } from '@/lib/api/notebooks'
import { AGENT_TEMPLATES } from '@/lib/agent-templates'

const HANDOFF_KEY = 'ruankao.coachHandoff.v1'

export interface CoachHandoff {
  text: string
  projectEnvId?: string | null
}

export type HandoffResult =
  | { ok: true; notebookId: string }
  | { ok: false; reason: 'no_notebook' }

// 教练智能体名（从 agent-templates 的 ruankao-essay-coach 模板派生，不复制字符串；
// 用户改名后按名匹配失效 → 调用方降级为 toast 引导手选，不阻塞）
const coachTemplate = AGENT_TEMPLATES.find((tpl) => tpl.key === 'ruankao-essay-coach')
export const COACH_NAME_ZH = coachTemplate?.name.zh ?? ''
export const COACH_NAME_EN = coachTemplate?.name.en ?? ''

/** Write the one-shot seed and open the first notebook's chat in a new tab.
 * Returns `no_notebook` when the user has no notebook yet (caller toasts the
 * create-one guidance). A network failure while listing notebooks folds into
 * the same result — the user is pointed at the notebook page either way. */
export async function writeCoachHandoff(h: CoachHandoff): Promise<HandoffResult> {
  let notebook: { id: string } | undefined
  try {
    notebook = (await notebooksApi.list())[0]
  } catch {
    notebook = undefined
  }
  if (!notebook) return { ok: false, reason: 'no_notebook' }

  try {
    window.sessionStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({ ...h, notebookId: notebook.id })
    )
  } catch {
    // sessionStorage 不可用（隐私模式）：种子写不进去，消费端也不会误触发
  }
  window.open(`/notebooks/${encodeURIComponent(notebook.id)}`)
  return { ok: true, notebookId: notebook.id }
}

export interface StoredCoachHandoff extends CoachHandoff {
  notebookId: string
}

/** Read-and-remove the seed (one-shot). A seed meant for another notebook is
 * not consumed (it stays in storage for the target notebook). Returns null
 * when nothing is pending. */
export function consumeCoachHandoff(
  currentNotebookId: string
): StoredCoachHandoff | null {
  if (typeof window === 'undefined') return null
  let raw: string | null = null
  try {
    raw = window.sessionStorage.getItem(HANDOFF_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: Partial<StoredCoachHandoff>
  try {
    parsed = JSON.parse(raw) as Partial<StoredCoachHandoff>
  } catch {
    // 坏种子直接清掉，不再留给后续挂载
    tryRemoveHandoff()
    return null
  }
  if (
    typeof parsed.text !== 'string' ||
    typeof parsed.notebookId !== 'string' ||
    parsed.notebookId !== currentNotebookId
  ) {
    return null
  }
  tryRemoveHandoff()
  return {
    text: parsed.text,
    projectEnvId:
      parsed.projectEnvId === undefined ? null : (parsed.projectEnvId ?? null),
    notebookId: parsed.notebookId,
  }
}

function tryRemoveHandoff(): void {
  try {
    window.sessionStorage.removeItem(HANDOFF_KEY)
  } catch {
    // remove 失败不致命（下次读取仍会校验 notebookId）
  }
}

/** Resolve the coach agent id by template name (zh or en). Exported for the
 * ChatPanel seed effect and tests. */
export async function findCoachAgentId(): Promise<string | null> {
  const agents = await agentsApi.list()
  const coach = agents.find(
    (a) => a.name === COACH_NAME_ZH || a.name === COACH_NAME_EN
  )
  return coach?.id ?? null
}
