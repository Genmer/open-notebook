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
  // Citation quote attached to a source modal: the reader locates and
  // highlights this passage when the modal opens (deep citation jumps).
  const citeQuote = searchParams?.get('cite') ?? undefined

  /**
   * Open a modal by updating URL params without navigation
   * @param type - Type of modal to open (source, note, insight)
   * @param id - ID of the content to display
   * @param context - Optional notebook context and citation quote; a
   *   context-less call clears any stale `nb`/`cite` params so a classic
   *   two-arg open never inherits them.
   */
  // Memoized so consumers can safely use it as a dependency (e.g. useCallback /
  // React.memo props) without re-creating handlers on every render.
  const openModal = useCallback(
    (type: ModalType, id: string, context?: { notebookId?: string; citeQuote?: string }) => {
      const params = new URLSearchParams(searchParams?.toString() || '')
      params.set('modal', type)
      params.set('id', id)
      if (context?.notebookId) {
        params.set('nb', context.notebookId)
      } else {
        params.delete('nb')
      }
      if (context?.citeQuote) {
        params.set('cite', context.citeQuote)
      } else {
        params.delete('cite')
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
    params.delete('cite')
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }, [router, searchParams, pathname])

  return {
    modalType,
    modalId,
    notebookId,
    citeQuote,
    openModal,
    closeModal,
    isOpen: !!modalType && !!modalId
  }
}
