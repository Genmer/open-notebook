import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { QuickAskHost } from './QuickAskHost'
import { QuickChatError, type QuickChatMessage } from '@/lib/api/quick-chat'

const { streamMock, agentsListMock, modelsListMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  agentsListMock: vi.fn(),
  modelsListMock: vi.fn(),
}))

// 流式端点 mock（importOriginal 保留 QuickChatError 真类供错误映射测试用）
vi.mock('@/lib/api/quick-chat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/quick-chat')>()
  return { ...actual, quickChatStream: streamMock }
})

vi.mock('@/lib/api/agents', () => ({
  agentsApi: { list: agentsListMock },
}))

vi.mock('@/lib/api/models', () => ({
  modelsApi: { list: modelsListMock },
}))

function renderHost() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <QuickAskHost />
    </QueryClientProvider>,
  )
}

function openPanel() {
  fireEvent.click(screen.getByTestId('quick-ask-launcher'))
  expect(screen.getByTestId('quick-ask-panel')).toBeInTheDocument()
}

function typeAndSend(text: string) {
  const input = screen.getByTestId('quick-ask-input') as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: text } })
  fireEvent.click(screen.getByTestId('quick-ask-send'))
}

describe('QuickAskHost', () => {
  beforeEach(() => {
    localStorage.clear()
    streamMock.mockReset()
    agentsListMock.mockReset().mockResolvedValue([
      {
        id: 'agent:1',
        name: '论文教练',
        system_prompt: 'x',
        description: null,
        model_id: null,
        temperature: null,
        max_tokens: null,
        enabled: true,
        sort_order: 0,
        in_use_session_count: 0,
        created: '',
        updated: '',
      },
    ])
    modelsListMock.mockReset().mockResolvedValue([
      { id: 'model:glm', name: 'GLM', type: 'language', provider: 'zhipu' },
    ])
  })

  it('启动钮 → 侧边卡打开，空态可见；关闭还原启动钮', () => {
    renderHost()
    openPanel()
    expect(screen.getByTestId('quick-ask-empty')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('quick-ask-close'))
    expect(screen.queryByTestId('quick-ask-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('quick-ask-launcher')).toBeInTheDocument()
  })

  it('发送成功：增量回调 → 助手回合落库 localStorage，输入清空', async () => {
    renderHost()
    openPanel()
    streamMock.mockImplementation(
      async ({ onDelta }: { onDelta: (d: string) => void }) => {
        onDelta('你')
        onDelta('好')
        return '你好'
      },
    )
    typeAndSend('打个招呼')
    await waitFor(() =>
      expect(screen.getByTestId('quick-ask-turn-assistant')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('quick-ask-turn-assistant')).toHaveTextContent('你好')
    const saved = JSON.parse(localStorage.getItem('quickask:turns') ?? '[]')
    expect(saved).toHaveLength(2)
    expect(saved[0].content).toBe('打个招呼')
    expect(saved[1].content).toBe('你好')
    expect((screen.getByTestId('quick-ask-input') as HTMLTextAreaElement).value).toBe('')
    const call = streamMock.mock.calls[0][0]
    expect(call.messages.map((m: QuickChatMessage) => m.role)).toEqual(['user'])
    expect(call.modelId).toBeNull()
    expect(call.agentId).toBeNull()
    expect(call.contextBlocks).toEqual([])
  })

  it('拾取页面元素 → 芯片出现并可移除；随问题一起发送后清空', async () => {
    renderHost()
    openPanel()
    // 拾取模式：点击面板外的页面元素（jsdom 无 innerText，标签退化为纯 tag）
    fireEvent.click(screen.getByTestId('quick-ask-pick'))
    const first = document.createElement('p')
    first.textContent = '页面上的参考段落甲'
    const second = document.createElement('p')
    second.textContent = '页面上的参考段落乙'
    document.body.append(first, second)
    fireEvent.click(first)
    fireEvent.click(second)
    // Esc 结束拾取
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('quick-ask-context')).toBeInTheDocument()
    // 移除第一块芯片
    fireEvent.click(screen.getAllByLabelText('quickAsk.removeContext')[0])
    streamMock.mockImplementation(async () => '答')
    typeAndSend('结合上下文回答')
    await waitFor(() =>
      expect(screen.getByTestId('quick-ask-turn-assistant')).toBeInTheDocument(),
    )
    const call = streamMock.mock.calls[0][0]
    expect(call.contextBlocks).toHaveLength(1)
    expect(call.contextBlocks[0].text).toBe('页面上的参考段落乙')
    expect(call.messages[0].contextLabels).toEqual(['p · 页面上的参考段落乙'])
    // 发送后上下文清空
    await waitFor(() =>
      expect(screen.queryByTestId('quick-ask-context')).not.toBeInTheDocument(),
    )
    document.body.removeChild(first)
    document.body.removeChild(second)
  })

  it('模型/智能体偏好从 localStorage 恢复并随请求发送', async () => {
    localStorage.setItem('quickask:modelId', 'model:glm')
    localStorage.setItem('quickask:agentId', 'agent:1')
    renderHost()
    openPanel()
    streamMock.mockImplementation(async () => 'ok')
    typeAndSend('问题')
    await waitFor(() =>
      expect(streamMock).toHaveBeenCalledTimes(1),
    )
    const call = streamMock.mock.calls[0][0]
    expect(call.modelId).toBe('model:glm')
    expect(call.agentId).toBe('agent:1')
  })

  it('错误映射：QuickChatError(model_timeout) → 裸键错误条', async () => {
    renderHost()
    openPanel()
    streamMock.mockImplementation(async () => {
      throw new QuickChatError('model_timeout')
    })
    typeAndSend('会超时的问题')
    await waitFor(() =>
      expect(screen.getByTestId('quick-ask-error')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('quick-ask-error')).toHaveTextContent(
      'quickAsk.error.model_timeout',
    )
  })

  it('停止：中断保留已生成的部分回答', async () => {
    renderHost()
    openPanel()
    streamMock.mockImplementation(
      ({
        onDelta,
        signal,
      }: {
        onDelta: (d: string) => void
        signal: AbortSignal
      }) =>
        new Promise((_resolve, reject) => {
          onDelta('已生成的部分')
          signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
        }),
    )
    typeAndSend('长回答')
    await waitFor(() => expect(streamMock).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByTestId('quick-ask-stop'))
    await waitFor(() =>
      expect(screen.getByTestId('quick-ask-turn-assistant')).toHaveTextContent(
        '已生成的部分',
      ),
    )
    expect(screen.queryByTestId('quick-ask-error')).not.toBeInTheDocument()
  })

  it('清空对话：确认后回合清空且 localStorage 移除', async () => {
    localStorage.setItem(
      'quickask:turns',
      JSON.stringify([{ role: 'user', content: '旧问题' }]),
    )
    renderHost()
    openPanel()
    expect(screen.getByTestId('quick-ask-turn-user')).toHaveTextContent('旧问题')
    fireEvent.click(screen.getByTestId('quick-ask-clear'))
    fireEvent.click(screen.getByTestId('quick-ask-clear-confirm'))
    await waitFor(() =>
      expect(screen.queryByTestId('quick-ask-turn-user')).not.toBeInTheDocument(),
    )
    expect(localStorage.getItem('quickask:turns')).toBeNull()
  })

  it('StrictMode 双挂载下历史恢复不被挂载写入吃掉（真机 StrictMode 撞出的回归）', () => {
    localStorage.setItem(
      'quickask:turns',
      JSON.stringify([
        { role: 'user', content: '历史问题甲' },
        { role: 'assistant', content: '历史回答乙' },
      ]),
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <QuickAskHost />
        </QueryClientProvider>
      </StrictMode>,
    )
    // 存档必须在挂载后原样保留（挂载期零写入），打开面板可见
    expect(JSON.parse(localStorage.getItem('quickask:turns') ?? '[]')).toHaveLength(2)
    fireEvent.click(screen.getByTestId('quick-ask-launcher'))
    expect(screen.getByTestId('quick-ask-turn-user')).toHaveTextContent('历史问题甲')
    expect(screen.getByTestId('quick-ask-turn-assistant')).toHaveTextContent('历史回答乙')
    expect(localStorage.getItem('quickask:turns')).not.toBeNull()
  })
})
