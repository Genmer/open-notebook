import { cn } from '@/lib/utils'

// 文件夹计数徽章，GroupTree 节点与笔记本页 FolderGrid 共用。
// 0 也渲染（淡样式）——空文件夹必须可见，否则用户会重复新建撞重名。
export function GroupBadge({ count }: { count: number }) {
  return (
    <span
      data-testid="group-badge"
      className={cn(
        'shrink-0 rounded-full bg-muted px-1.5 text-xs text-muted-foreground',
        count === 0 && 'opacity-50'
      )}
    >
      {count}
    </span>
  )
}
