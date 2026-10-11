'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useTranslation } from '@/lib/hooks/use-translation'

interface EssayMarkEditGuardDialogProps {
  open: boolean
  /** 被编辑来源的标题（描述行前缀，帮助用户确认正在改哪一篇）。 */
  sourceTitle: string | null
  /** 继续编辑（用户明知是公开范文仍要保存）。 */
  onConfirm: () => void
  /** 取消。必须幂等（只关窗）：确认按钮触发 Radix 关闭请求时也会走到这里。 */
  onCancel: () => void
}

// 编辑公开范文的确认提示（UX 护栏，非红线本体）：effective 范文先确认再放行
// PUT。文案用 ruankao.essayMark.editGuard*；取消按钮复用 common.cancel。
export function EssayMarkEditGuardDialog({
  open,
  sourceTitle,
  onConfirm,
  onCancel,
}: EssayMarkEditGuardDialogProps) {
  const { t } = useTranslation()

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <AlertDialogContent data-testid="ruankao-essay-edit-guard">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('ruankao.essayMark.editGuardTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {sourceTitle ? `${sourceTitle} — ` : ''}
            {t('ruankao.essayMark.editGuardDesc')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t('ruankao.essayMark.editGuardConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
