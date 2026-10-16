// 文件夹折叠记忆（Gemini 来源列 + 上下文选择器共用一个 store）：localStorage
// v1 持久，零后端。只存用户 overrides，未触碰的文件夹走各自组件的默认规则
// （来源列：有来源默认展开；选择器：恒默认展开），两处树同用 useContextTree
// 的 source_group 记录 id，键空间一致；'ungrouped' 键只在来源列里有意义。

export const FOLDER_COLLAPSE_STORAGE_KEY = 'notebooks.folderCollapse.v1'

/** key = source_group id 或 'ungrouped'；true=折叠 */
export type FolderCollapseOverrides = Record<string, boolean>

interface FolderCollapseStoreV1 {
  version: 1
  byNotebook: Record<string, FolderCollapseOverrides>
}

// 空结果必须每次新建：writeFolderOverrides 会原地改写 parseStore 的返回值，
// 共享单例会让上一次的写入残留泄漏给后续读空存储的调用方。
function emptyStore(): FolderCollapseStoreV1 {
  return { version: 1, byNotebook: {} }
}

// 读取宽容：坏 JSON / version 不符 / byNotebook 非 object → 空 store（不抛异常）
function parseStore(): FolderCollapseStoreV1 {
  if (typeof window === 'undefined') return emptyStore()
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(FOLDER_COLLAPSE_STORAGE_KEY)
  } catch {
    return emptyStore()
  }
  if (!raw) return emptyStore()
  try {
    const parsed = JSON.parse(raw) as Partial<FolderCollapseStoreV1>
    if (
      parsed.version !== 1 ||
      parsed.byNotebook == null ||
      typeof parsed.byNotebook !== 'object'
    ) {
      return emptyStore()
    }
    return { version: 1, byNotebook: parsed.byNotebook }
  } catch {
    return emptyStore()
  }
}

export function readFolderOverrides(notebookId: string): FolderCollapseOverrides {
  const { byNotebook } = parseStore()
  const rawMap = byNotebook[notebookId]
  if (rawMap == null || typeof rawMap !== 'object') return {}
  // 值非 boolean 的键剔除该键，坏键不拖垮整表
  const overrides: FolderCollapseOverrides = {}
  for (const [key, value] of Object.entries(rawMap)) {
    if (typeof value === 'boolean') overrides[key] = value
  }
  return overrides
}

// 写静默：存储满/隐私模式下放弃落盘（UI 会话内存仍可见，不抛未捕获异常）
function writeStore(store: FolderCollapseStoreV1): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(FOLDER_COLLAPSE_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // 静默放弃
  }
}

/** 整表替换该笔记本的 overrides，其他笔记本条目原样保留 */
export function writeFolderOverrides(
  notebookId: string,
  overrides: FolderCollapseOverrides,
): void {
  const store = parseStore()
  store.byNotebook[notebookId] = { ...overrides }
  writeStore(store)
}

/** 读-改-写单键合并，不动他键 */
export function setFolderOverride(
  notebookId: string,
  groupId: string,
  collapsed: boolean,
): void {
  const current = readFolderOverrides(notebookId)
  writeFolderOverrides(notebookId, { ...current, [groupId]: collapsed })
}
