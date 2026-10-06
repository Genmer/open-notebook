import type { NextRequest } from 'next/server'
import { sseProxy } from '../../../../_sse-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  return sseProxy(
    req,
    `/api/chat/sessions/${encodeURIComponent(sessionId)}/stream`
  )
}
