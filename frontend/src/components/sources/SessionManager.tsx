'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  MessageSquare,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Clock,
  Search
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/lib/utils/date-locale'
import { useTranslation } from '@/lib/hooks/use-translation'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { BaseChatSession } from '@/lib/types/api'
import { useModels } from '@/lib/hooks/use-models'

interface SessionManagerProps {
  sessions: BaseChatSession[]
  currentSessionId: string | null
  onCreateSession: (title: string) => void
  onSelectSession: (sessionId: string) => void
  onUpdateSession: (sessionId: string, title: string) => void
  onDeleteSession: (sessionId: string) => void
  loadingSessions: boolean
  /** Delete-mutation in-flight flag; drives the ConfirmDialog spinner. */
  isDeletingSession?: boolean
  /** Locks the delete entry while a generation is running (A12): notebook
   * streaming, source streaming, or a parallel run — the parallel path has
   * no backend 409 guard (chat_parallel.py is change-frozen), so the frontend
   * must keep the session undeletable for its duration. */
  deleteDisabled?: boolean
}

export function SessionManager({
  sessions,
  currentSessionId,
  onCreateSession,
  onSelectSession,
  onUpdateSession,
  onDeleteSession,
  loadingSessions,
  isDeletingSession = false,
  deleteDisabled = false
}: SessionManagerProps) {
  const { t, language } = useTranslation()
  const [isCreating, setIsCreating] = useState(false)
  const [newSessionTitle, setNewSessionTitle] = useState('')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<BaseChatSession | null>(null)

  const { data: models } = useModels()

  // Helper to get model name from ID
  const customModelLabel = t('common.customModel')
  const getModelName = useMemo(() => {
    return (modelId: string) => {
      const model = models?.find(m => m.id === modelId)
      return model?.name || customModelLabel
    }
  }, [models, customModelLabel])

  // Normalize the list order to updated-desc here in the panel (A1): notebook
  // sessions already arrive that way (domain query sorts by updated desc),
  // while source sessions arrive created-desc (api/routers/source_chat.py
  // sorts by created) — sorting locally makes both hosts read updated-desc
  // without touching the backend endpoint. Pure presentational sort; the data
  // source and fetch frequency are unchanged. Unparseable timestamps fall back
  // to 0 and keep their relative order (stable sort).
  const sortedSessions = useMemo(() => {
    const toTime = (value?: string) => {
      const parsed = value ? Date.parse(value) : NaN
      return Number.isNaN(parsed) ? 0 : parsed
    }
    return [...sessions].sort((a, b) => toTime(b.updated) - toTime(a.updated))
  }, [sessions])

  // Case-insensitive client-side title filter (ZCode-style session search).
  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return sortedSessions
    return sortedSessions.filter(session =>
      (session.title || '').toLowerCase().includes(query)
    )
  }, [sortedSessions, search])

  // Dismiss the confirm dialog once the deleted session leaves the list
  // (the parent's mutation invalidates the sessions cache on success).
  useEffect(() => {
    if (deleteTarget && !sessions.some(session => session.id === deleteTarget.id)) {
      setDeleteTarget(null)
    }
  }, [sessions, deleteTarget])

  const handleCreateSession = () => {
    if (newSessionTitle.trim()) {
      onCreateSession(newSessionTitle.trim())
      setNewSessionTitle('')
      setIsCreating(false)
    }
  }

  const handleStartEdit = (session: BaseChatSession) => {
    setEditingId(session.id)
    setEditTitle(session.title)
  }

  const handleSaveEdit = () => {
    if (editingId && editTitle.trim()) {
      onUpdateSession(editingId, editTitle.trim())
      setEditingId(null)
      setEditTitle('')
    }
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditTitle('')
  }

  const handleDeleteConfirm = () => {
    // Guard mirrors the disabled buttons: even if the dialog was already open
    // when a generation started, the delete must not fire while locked.
    if (deleteTarget && !deleteDisabled) {
      onDeleteSession(deleteTarget.id)
    }
  }

  const getSessionTitle = (session: BaseChatSession) =>
    session.title?.trim() || t('sessions.untitled')

  return (
    <>
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              {t('sessions.managerTitle')}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsCreating(true)}
              aria-label={t('common.create')}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 p-0 min-h-0">
          <ScrollArea className="h-full px-4">
            <div className="relative pt-1 pb-3">
              <Search
                className="absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('sessions.searchPlaceholder')}
                className="h-8 pl-8 text-xs"
              />
            </div>
            {isCreating && (
              <div className="p-3 border rounded-lg mb-3">
                <Input
                  value={newSessionTitle}
                  onChange={(e) => setNewSessionTitle(e.target.value)}
                  placeholder={t('sessions.newSessionPlaceholder')}
                  className="mb-2"
                  autoFocus
                  onKeyDown={(e) => {
                    // React 19 dropped onKeyPress — keydown is the supported
                    // form event for Enter-to-submit inputs.
                    if (e.key === 'Enter') handleCreateSession()
                  }}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCreateSession}>
                    {t('common.create')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setIsCreating(false)
                      setNewSessionTitle('')
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            )}

            {loadingSessions ? (
              <div className="text-center py-8 text-muted-foreground">
                {t('common.loading')}
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm">{t('sessions.empty')}</p>
                <p className="text-xs mt-2">{t('sessions.emptyHint')}</p>
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm">{t('sessions.noResults')}</p>
              </div>
            ) : (
              <div className="space-y-2 pb-4">
                {filteredSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      currentSessionId === session.id
                        ? 'bg-primary/10 border-primary'
                        : 'hover:bg-muted'
                    }`}
                    onClick={() => onSelectSession(session.id)}
                  >
                    {editingId === session.id ? (
                      <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                        <Input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit()
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleSaveEdit}>
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleCancelEdit}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between mb-1">
                          <h4 className="font-medium text-sm">
                            {getSessionTitle(session)}
                          </h4>
                          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              onClick={() => handleStartEdit(session)}
                              aria-label={t('sessions.rename')}
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              onClick={() => setDeleteTarget(session)}
                              disabled={deleteDisabled}
                              aria-label={t('sessions.deleteSession')}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(session.created), {
                            addSuffix: true,
                            locale: getDateLocale(language)
                          })}
                        </div>
                        {session.message_count != null && session.message_count > 0 && (
                          <Badge variant="secondary" className="mt-2 text-xs">
                            {t('sessions.messagesCount', { count: session.message_count })}
                          </Badge>
                        )}
                        {session.model_override && (
                          <Badge variant="outline" className="mt-2 ml-2 text-xs">
                            {getModelName(session.model_override)}
                          </Badge>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('sessions.deleteSession')}
        description={t('sessions.deleteSessionDesc', {
          title: deleteTarget ? getSessionTitle(deleteTarget) : '',
          count: deleteTarget?.message_count ?? 0
        })}
        confirmText={t('common.delete')}
        confirmVariant="destructive"
        onConfirm={handleDeleteConfirm}
        isLoading={isDeletingSession}
        confirmDisabled={deleteDisabled}
      />
    </>
  )
}
