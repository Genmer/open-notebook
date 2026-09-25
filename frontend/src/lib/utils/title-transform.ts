export interface RenameRules {
  prefix?: string
  suffix?: string
  find?: string
  replace?: string
}

// Rule order is fixed: find/replace runs first, then prefix, then suffix.
// An empty `find` skips the replace step (replaceAll of "" would explode the title).
export function transformTitle(title: string, rules: RenameRules): string {
  let next = title
  if (rules.find !== undefined && rules.find !== '') {
    next = next.split(rules.find).join(rules.replace ?? '')
  }
  if (rules.prefix !== undefined && rules.prefix !== '') {
    next = rules.prefix + next
  }
  if (rules.suffix !== undefined && rules.suffix !== '') {
    next = next + rules.suffix
  }
  return next
}

export function hasTitleChanged(before: string, after: string): boolean {
  return before !== after
}
