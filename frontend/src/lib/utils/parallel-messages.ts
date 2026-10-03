/** Minimal shape the grouper needs; both chat message types satisfy it. */
export interface GroupableMessage {
  id: string
  type: string
  group_id?: string | null
  run_role?: string | null
}

export interface MessageListItem<T extends GroupableMessage> {
  kind: 'single' | 'parallel'
  /** kind === 'single' */
  message?: T
  /** kind === 'parallel' */
  groupId?: string
  question?: T
  answers?: T[]
  synthesis?: T
}

/** Fold consecutive group-tagged messages (PDR-004 parallel runs) into one
 * render item: the human question, the per-participant answers, and the
 * optional synthesis conclusion. Untagged messages pass through unchanged. */
export function groupParallelMessages<T extends GroupableMessage>(
  messages: T[]
): MessageListItem<T>[] {
  const items: MessageListItem<T>[] = []
  const groups = new Map<string, MessageListItem<T>>()

  for (const message of messages) {
    if (!message.group_id) {
      items.push({ kind: 'single', message })
      continue
    }
    let item = groups.get(message.group_id)
    if (!item) {
      item = {
        kind: 'parallel',
        groupId: message.group_id,
        answers: [],
      }
      groups.set(message.group_id, item)
      items.push(item)
    }
    if (message.type === 'human') {
      item.question = message
    } else if (message.run_role === 'synthesis') {
      item.synthesis = message
    } else {
      item.answers?.push(message)
    }
  }

  return items
}
