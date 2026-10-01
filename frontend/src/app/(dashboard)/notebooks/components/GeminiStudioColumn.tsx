'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Sparkles,
  Mic,
  BookOpen,
  FileCheck2,
  HelpCircle,
  Brain,
  Plus,
  StickyNote,
  Trash2,
  Edit,
  FilePlus2,
  Bot,
  User,
  Loader2,
  ListTodo,
  ExternalLink,
} from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { createCollapseButton } from '@/components/notebooks/CollapsibleColumn'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import type { NoteResponse, SourceListResponse } from '@/lib/types/api'
import type { ContextSelections } from '@/lib/types/notebook-context'
import type { NotebookSourceFilters } from '@/lib/hooks/use-sources'
import { NoteEditorDialog } from './NoteEditorDialog'
import { ArtifactViewDialog } from './ArtifactViewDialog'
import { SaveAsSourceDialog } from './SaveAsSourceDialog'
import { GeneratePodcastDialog } from '@/components/podcasts/GeneratePodcastDialog'
import { useDeleteNote } from '@/lib/hooks/use-notes'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/lib/utils/date-locale'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { notebooksApi } from '@/lib/api/notebooks'
import { artifactsApi, type CommandJobStatus } from '@/lib/api/artifacts'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { TaskLiveInspector } from '@/components/tasks/TaskLiveInspector'
import {
  buildArtifactContextConfig,
  hasIncludedContext,
  type ArtifactType,
  type ArtifactContextConfig,
} from '@/lib/utils/artifact-context'

interface GeminiStudioColumnProps {
  notebookId: string
  notes?: NoteResponse[]
  isLoading: boolean
  sources?: SourceListResponse[]
  contextSelections?: ContextSelections
  /** 当前分组浏览范围，用于「存为来源」弹窗预选默认文件夹。 */
  sourceGrouping?: NotebookSourceFilters
}

interface StudioTool {
  id: string
  name: string
  desc: string
  icon: typeof Mic
  tag: string
  tagColor: string
  action: 'podcast' | 'artifact'
  artifactType?: ArtifactType
  defaultInstruction?: string
}

export function GeminiStudioColumn({
  notebookId,
  notes = [],
  isLoading,
  sources = [],
  contextSelections,
  sourceGrouping,
}: GeminiStudioColumnProps) {
  const { t, language } = useTranslation()
  const { toggleNotes } = useNotebookColumnsStore()
  const router = useRouter()
  const queryClient = useQueryClient()
  const deleteNote = useDeleteNote()
  // 全屏阅读侧栏点来源：带 nb 上下文打开详情弹窗（AI 保存链路供数点）。
  const { openModal } = useModalManager()

  // 状态管理
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingNote, setEditingNote] = useState<NoteResponse | undefined>()
  const [podcastDialogOpen, setPodcastDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null)
  const [viewingNote, setViewingNote] = useState<NoteResponse | null>(null)
  const [saveAsSourceNote, setSaveAsSourceNote] = useState<NoteResponse | undefined>()
  const [saveAsSourceOpen, setSaveAsSourceOpen] = useState(false)

  // 工件生成对话框状态
  const [activeTool, setActiveTool] = useState<StudioTool | null>(null)
  const [toolDialogOpen, setToolDialogOpen] = useState(false)
  const [customInstruction, setCustomInstruction] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 生成任务进度管理：提交后进入进度详情视图（替代原来的转圈圈等待）
  const [submittedJob, setSubmittedJob] = useState<{
    jobId: string
    toolName: string
    startedAt: number
  } | null>(null)
  const [jobStatus, setJobStatus] = useState<CommandJobStatus | null>(null)

  // Studio 工具箱定义
  const studioTools: StudioTool[] = [
    {
      id: 'audio_overview',
      name: 'Audio Overview',
      desc: '生成双人主持的深度对谈音频播客（支持真实 TTS 原生合成）',
      icon: Mic,
      tag: '播客',
      tagColor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      action: 'podcast',
    },
    {
      id: 'study_guide',
      name: 'Study Guide',
      desc: '提炼核心概念、考试测验问答与系统复习大纲',
      icon: BookOpen,
      tag: '快捷工件',
      tagColor: 'bg-primary/10 text-primary border-primary/20',
      action: 'artifact',
      artifactType: 'study_guide',
      defaultInstruction: '请为我整理一份系统的学习指南，包含核心概念术语解析、关键要点总结以及自测选择题与简答题。',
    },
    {
      id: 'briefing_doc',
      name: 'Briefing Doc',
      desc: '生成专业执行简报、关键论据、战略启示与结论',
      icon: FileCheck2,
      tag: '快捷工件',
      tagColor: 'bg-primary/10 text-primary border-primary/20',
      action: 'artifact',
      artifactType: 'essay_draft',
      defaultInstruction: '请提炼一份专业的高管项目简报，包含背景摘要、关键支撑事实、潜在风险评估及后续行动建议。',
    },
    {
      id: 'faq',
      name: 'FAQ 问答集',
      desc: '基于来源提取最关键的常见问答与详细解答',
      icon: HelpCircle,
      tag: '快捷工件',
      tagColor: 'bg-primary/10 text-primary border-primary/20',
      action: 'artifact',
      artifactType: 'faq',
      defaultInstruction: '请全面梳理当前资料，整理出读者最常关心的核心问题与翔实解答。',
    },
    {
      id: 'flashcards',
      name: 'Flashcards',
      desc: '提取核心知识点与问答对，生成正反面抽认记忆卡片',
      icon: Brain,
      tag: '快捷工件',
      tagColor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
      action: 'artifact',
      artifactType: 'flashcards',
      defaultInstruction: '请提炼核心概念与重要结论，生成便于记忆与抽认自测的问答知识卡片集。',
    },
  ]

  // 计算工件上下文配置
  const contextConfig = useMemo(() => {
    if (contextSelections) {
      const cfg = buildArtifactContextConfig(contextSelections, sources, notes)
      if (hasIncludedContext(cfg)) {
        return cfg
      }
    }
    const fallbackCfg: ArtifactContextConfig = { sources: {}, notes: {} }
    sources.forEach((s) => {
      fallbackCfg.sources[s.id] = 'full content'
    })
    notes.forEach((n) => {
      fallbackCfg.notes[n.id] = 'full content'
    })
    return fallbackCfg
  }, [contextSelections, sources, notes])

  const includedSourcesCount = Object.values(contextConfig.sources).filter(
    (s) => s !== 'not in'
  ).length

  const handleToolClick = (tool: StudioTool) => {
    if (tool.action === 'podcast') {
      setPodcastDialogOpen(true)
    } else {
      setActiveTool(tool)
      setCustomInstruction(tool.defaultInstruction || '')
      setToolDialogOpen(true)
    }
  }

  // 提交真实的异步工件生成任务（提交即切换到进度详情视图，不再原地转圈等待）
  const handleGenerateArtifact = async () => {
    if (!activeTool?.artifactType) return
    setIsSubmitting(true)
    try {
      const job = await notebooksApi.generateArtifact(notebookId, {
        artifact_type: activeTool.artifactType,
        instruction: customInstruction.trim() || undefined,
        context_config: contextConfig,
      })
      const startedAt = Date.now()
      setSubmittedJob({ jobId: job.job_id, toolName: activeTool.name, startedAt })
      // Optimistic initial state: the backend CommandStatus enum starts at 'new'
      // (no 'queued' value exists on this endpoint — see CommandJobStatus).
      setJobStatus({ job_id: job.job_id, status: 'new' })
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } }; message?: string }
      toast.error(error.response?.data?.detail || error.message || '生成工件失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  // 进度轮询：每 2 秒拉取任务状态；对话框关闭后任务照常在后台推进
  useEffect(() => {
    if (!submittedJob) return
    let cancelled = false
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    const { jobId, startedAt } = submittedJob

    const poll = async () => {
      if (cancelled) return
      // 5 分钟未返回不再本地轮询，交由进度管理页持续跟踪
      if (Date.now() - startedAt > 5 * 60 * 1000) {
        return
      }
      try {
        const status = await artifactsApi.getJobStatus(jobId)
        if (cancelled) return
        setJobStatus(status)
        if (
          status.status === 'completed' ||
          status.status === 'failed' ||
          status.status === 'canceled' ||
          status.status === 'unknown'
        ) {
          if (status.status === 'completed') {
            await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notes(notebookId) })
            toast.success(`${submittedJob.toolName} 生成成功，已作为笔记沉淀至笔记本！`)
          }
          return
        }
      } catch {
        // 单次请求失败不中断轮询（网络抖动），下一轮重试
      }
      if (!cancelled) pollTimer = setTimeout(poll, 2000)
    }

    poll()
    return () => {
      cancelled = true
      clearTimeout(pollTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submittedJob])

  // 重置进度视图：用户点"完成"或重新发起生成时回到表单
  const resetJobProgress = () => {
    setSubmittedJob(null)
    setJobStatus(null)
    setCustomInstruction('')
  }

  const openTasksCenter = () => {
    setToolDialogOpen(false)
    router.push('/tasks')
  }

  const handleDeleteConfirm = () => {
    if (noteToDelete) {
      deleteNote.mutate(noteToDelete, {
        onSuccess: () => {
          setDeleteDialogOpen(false)
          setNoteToDelete(null)
          toast.success(t('notes.deleteSuccess'))
        },
      })
    }
  }

  return (
    <Card className="h-full flex flex-col border-border/80 shadow-xs bg-card">
      <CardHeader className="p-4 pb-3 border-b border-border/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-semibold">Studio (工作室)</CardTitle>
            <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 font-normal">
              {notes.length} 篇笔记
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 shadow-none"
              onClick={() => {
                setEditingNote(undefined)
                setEditorOpen(true)
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              新建笔记
            </Button>
            {createCollapseButton(toggleNotes, 'Studio')}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
        <ScrollArea className="notebook-studio-scroll flex-1 min-h-0 p-4 space-y-5">
          {/* 1. 成熟功能卡片网格 (Studio Actions) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                Studio 工具箱 (Notebook Actions)
              </span>
              <button
                type="button"
                onClick={() => router.push('/tasks')}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
                title="打开进度管理（任务中心）"
              >
                <ListTodo className="h-3 w-3" />
                进度管理
                <ExternalLink className="h-2.5 w-2.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {studioTools.map((tool) => {
                const Icon = tool.icon
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => handleToolClick(tool)}
                    className="flex flex-col text-left p-2.5 rounded-lg border border-border/70 bg-card hover:bg-muted/40 hover:border-primary/40 transition-all cursor-pointer group shadow-2xs"
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <div className="p-1 rounded-md bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded border font-medium ${tool.tagColor}`}>
                        {tool.tag}
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                      {tool.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                      {tool.desc}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 2. 笔记卡片瀑布流 (Notes Matrix) */}
          <div className="space-y-2 pt-3 border-t border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                笔记本卡片流 ({notes.length})
              </span>
              <span className="text-[11px] text-muted-foreground">
                可从对话一键沉淀
              </span>
            </div>

            {isLoading ? (
              <div className="text-center py-6 text-xs text-muted-foreground">
                加载笔记中...
              </div>
            ) : notes.length === 0 ? (
              <div className="text-center py-8 px-4 rounded-lg border border-dashed border-border/80">
                <StickyNote className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs font-medium text-muted-foreground">
                  暂无笔记卡片
                </p>
                <p className="text-[11px] text-muted-foreground/70 mt-1">
                  可在中间对话中点击【保存为笔记】，或划选关键文字一键沉淀至此处。
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="p-3 rounded-lg border border-border/80 bg-card hover:border-primary/40 transition-all shadow-2xs space-y-1.5 group cursor-pointer"
                    onClick={() => setViewingNote(note)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        {note.note_type === 'ai' ? (
                          <Bot className="h-3.5 w-3.5 text-primary shrink-0" />
                        ) : (
                          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <h4 className="text-xs font-semibold text-foreground truncate">
                          {note.title || '无标题笔记'}
                        </h4>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingNote(note)
                            setEditorOpen(true)
                          }}
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSaveAsSourceNote(note)
                            setSaveAsSourceOpen(true)
                          }}
                          aria-label={t('notebooks.saveAsSource.action')}
                          title={t('notebooks.saveAsSource.action')}
                        >
                          <FilePlus2 className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation()
                            setNoteToDelete(note.id)
                            setDeleteDialogOpen(true)
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {note.content || '无内容'}
                    </p>

                    <div className="text-[10px] text-muted-foreground/70 pt-1">
                      {formatDistanceToNow(new Date(note.updated), {
                        addSuffix: true,
                        locale: getDateLocale(language),
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>

      {/* 笔记编辑弹窗 */}
      <NoteEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        notebookId={notebookId}
        note={editingNote}
      />

      {/* 播客生成对话框 (Audio Overview 真实联动) */}
      <GeneratePodcastDialog
        open={podcastDialogOpen}
        onOpenChange={setPodcastDialogOpen}
      />

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('notes.deleteNote')}
        description={t('notes.deleteConfirm')}
        confirmText={t('common.delete')}
        confirmVariant="destructive"
        onConfirm={handleDeleteConfirm}
        isLoading={deleteNote.isPending}
      />

      {/* 笔记全屏阅读弹窗：列表接口带回了 content，直接用统一的只读渲染
          （Markdown 排版 / 闪卡翻转 / 全屏切换），见 ArtifactViewDialog。
          底部操作栏回调会先关阅读弹窗再开对应弹窗，避免两个 open Dialog 叠开。 */}
      <ArtifactViewDialog
        open={!!viewingNote}
        onOpenChange={(open) => !open && setViewingNote(null)}
        note={viewingNote ?? undefined}
        notebookId={notebookId}
        notes={notes}
        activeNoteId={viewingNote?.id ?? null}
        onNoteSelect={(n) => setViewingNote(n)}
        onOpenSource={(id) => openModal('source', id, { notebookId })}
        onEdit={() => {
          setEditingNote(viewingNote ?? undefined)
          setViewingNote(null)
          setEditorOpen(true)
        }}
        onSaveAsSource={() => {
          const note = viewingNote
          setViewingNote(null)
          if (note) {
            setSaveAsSourceNote(note)
            setSaveAsSourceOpen(true)
          }
        }}
      />

      {/* 存为来源弹窗：把笔记内容转成 text 来源加入本笔记本 */}
      <SaveAsSourceDialog
        open={saveAsSourceOpen}
        onOpenChange={setSaveAsSourceOpen}
        notebookId={notebookId}
        note={saveAsSourceNote}
        sourceGrouping={sourceGrouping}
      />

      {/* Studio 真实工件生成弹窗（提交后切换为进度详情视图） */}
      <Dialog open={toolDialogOpen} onOpenChange={setToolDialogOpen}>
        <DialogContent className={cn("max-w-md", submittedJob && "max-w-xl sm:max-w-xl")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {submittedJob ? `${submittedJob.toolName} · 生成进度` : activeTool?.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {submittedJob
                ? '任务已在后台异步执行，可实时查看状态或跳转进度管理'
                : activeTool?.desc}
            </DialogDescription>
          </DialogHeader>

          {submittedJob ? (
            <TaskLiveInspector
              job={{
                jobId: submittedJob.jobId,
                toolName: submittedJob.toolName,
                status: jobStatus?.status || 'running',
                startedAt: submittedJob.startedAt,
                progress: jobStatus?.progress,
                errorMessage: jobStatus?.error_message,
              }}
              embedded={true}
              onOpenTasksCenter={openTasksCenter}
            />
          ) : (
            <div className="space-y-3 py-2">
              <span className="text-xs font-semibold text-foreground block">
                生成指令与侧重点 (可选自定义)：
              </span>
              <Textarea
                value={customInstruction}
                onChange={(e) => setCustomInstruction(e.target.value)}
                placeholder="输入给 AI 的定制指令或关注侧重点..."
                rows={3}
                className="text-xs resize-none"
                disabled={isSubmitting}
              />
              <p className="text-[11px] text-muted-foreground">
                将基于当前选取的 {includedSourcesCount} 个知识来源及相关笔记进行提炼生成，生成完成后自动沉淀为右侧卡片笔记。
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {submittedJob ? (
              jobStatus?.status === 'completed' ? (
                <Button
                  size="sm"
                  className="bg-primary text-primary-foreground"
                  onClick={() => {
                    resetJobProgress()
                    setToolDialogOpen(false)
                  }}
                >
                  完成
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setToolDialogOpen(false)}
                  >
                    后台运行，关闭
                  </Button>
                  <Button size="sm" className="gap-1.5" onClick={openTasksCenter}>
                    <ListTodo className="h-3.5 w-3.5" />
                    打开进度管理
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </>
              )
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setToolDialogOpen(false)}
                  disabled={isSubmitting}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={handleGenerateArtifact}
                  disabled={isSubmitting}
                  className="bg-primary text-primary-foreground gap-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      正在提交任务...
                    </>
                  ) : (
                    '立即生成并存为笔记'
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

