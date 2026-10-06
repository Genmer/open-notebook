'use client'

import { useCallback } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export type ModalType = 'source' | 'note' | 'insight'

export function useModalManager() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  // Read current modal state from URL params
  const modalType = searchParams?.get('modal') as ModalType | null
  const modalId = searchParams?.get('id')
  // Notebook context of the open modal (feeds the AI save chain so saves land
  // in the right notebook); undefined when the modal was opened without one.
  const notebookId = searchParams?.get('nb') ?? undefined

  /**
   * Open a modal by updating URL params without navigation
   * @param type - Type of modal to open (source, note, insight)
   * @param id - ID of the content to display
   * @param context - Optional notebook context; a context-less call clears any
   *   stale `nb` param so a classic two-arg open never inherits a notebook.
   */
  // Memoized so consumers can safely use it as a dependency (e.g. useCallback /
  // React.memo props) without re-creating handlers on every render.
  const openModal = useCallback(
    (type: ModalType, id: string, context?: { notebookId?: string }) => {
      const params = new URLSearchParams(searchParams?.toString() || '')
      params.set('modal', type)
      params.set('id', id)
      if (context?.notebookId) {
        params.set('nb', context.notebookId)
      } else {
        params.delete('nb')
      }
      // Use scroll: false to prevent page from scrolling when modal state changes
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, searchParams, pathname]
  )

  /**
   * Close the currently open modal by removing modal params from URL
   */
  const closeModal = useCallback(() => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.delete('modal')
    params.delete('id')
    params.delete('nb')
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }, [router, searchParams, pathname])

  return {
    modalType,
    modalId,
    notebookId,
    openModal,
    closeModal,
    isOpen: !!modalType && !!modalId
  }
}
