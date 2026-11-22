// A minimal MCP server (Streamable HTTP, JSON-RPC 2.0) on 127.0.0.1 that exposes the app's tutor tools
// to a Claude Code CLI agent. Each agent gets its own path and bearer token. A tools/call is answered
// with an SSE stream that stays open (with keep-alive comments) until the app has a result, so a tool
// can wait as long as the learner needs to answer.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpToolResult {
  text: string
  isError?: boolean
}

export interface McpEndpoint {
  url: string
  token: string
  close: () => void
}

interface Agent {
  token: string
  tools: McpTool[]
  onCall: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<McpToolResult>
}

const PROTOCOL = '2025-06-18'
const PING_MS = 20_000

export class McpBridge {
  private server: Server | null = null
  private port = 0
  private agents = new Map<string, Agent>()

  private async listen(): Promise<void> {
    if (this.server) return
    const server = createServer((req, res) => void this.handle(req, res))
    // tool calls wait for the learner: no request timeouts on this server
    server.requestTimeout = 0
    server.headersTimeout = 60_000
    server.keepAliveTimeout = 120_000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    this.port = (server.address() as AddressInfo).port
    this.server = server
  }

  async register(id: string, tools: McpTool[], onCall: Agent['onCall']): Promise<McpEndpoint> {
    await this.listen()
    const token = randomBytes(24).toString('hex')
    const key = encodeURIComponent(id)
    this.agents.set(key, { token, tools, onCall })
    return { url: `http://127.0.0.1:${this.port}/mcp/${key}`, token, close: () => this.agents.delete(key) }
  }

  close(): void {
    this.server?.close()
    this.server = null
    this.agents.clear()
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const m = /^\/mcp\/([^/?]+)/.exec(req.url ?? '')
    const agent = m ? this.agents.get(m[1]) : undefined
    if (!agent) return end(res, 404)
    if (!authorized(req, agent.token)) return end(res, 401)
    // no browser may talk to this server
    if (req.headers.origin) return end(res, 403)
    if (req.method === 'DELETE') return end(res, 200)
    if (req.method !== 'POST') return end(res, 405)

    let msg: unknown
    try {
      msg = JSON.parse(await readBody(req))
    } catch {
      return json(res, 400, rpcError(null, -32700, 'Parse error'))
    }
    if (Array.isArray(msg)) return json(res, 400, rpcError(null, -32600, 'Batches are not supported'))
    const { id, method, params } = (msg ?? {}) as { id?: string | number; method?: string; params?: Record<string, unknown> }
    if (id === undefined || id === null) return end(res, 202) // a notification or a response: nothing to say

    switch (method) {
      case 'initialize': {
        const asked = typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL
        return json(res, 200, {
          jsonrpc: '2.0',
          id,
          result: { protocolVersion: asked, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'anamnesis', version: '1.0.0' } }
        })
      }
      case 'ping':
        return json(res, 200, { jsonrpc: '2.0', id, result: {} })
      case 'tools/list':
        return json(res, 200, { jsonrpc: '2.0', id, result: { tools: agent.tools } })
      case 'tools/call':
        return this.call(res, req, agent, id, params ?? {})
      default:
        return json(res, 200, rpcError(id, -32601, `Method not found: ${method}`))
    }
  }

  private async call(res: ServerResponse, req: IncomingMessage, agent: Agent, id: string | number, params: Record<string, unknown>): Promise<void> {
    const name = String(params.name ?? '')
    const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>
    if (!agent.tools.some((t) => t.name === name)) return json(res, 200, rpcError(id, -32602, `Unknown tool: ${name}`))
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write(': waiting for the learner\n\n')
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS)
    const abort = new AbortController()
    const onClose = (): void => {
      if (!res.writableFinished) abort.abort()
    }
    req.socket.on('close', onClose)
    let result: McpToolResult
    try {
      result = await agent.onCall(name, args, abort.signal)
    } catch (e) {
      result = { text: `Tool failed: ${String((e as Error)?.message ?? e)}`, isError: true }
    } finally {
      clearInterval(ping)
      req.socket.off('close', onClose)
    }
    if (res.writableEnded || res.destroyed) return
    const body = { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: result.text }], isError: !!result.isError } }
    res.end(`event: message\ndata: ${JSON.stringify(body)}\n\n`)
  }
}

function authorized(req: IncomingMessage, token: string): boolean {
  const h = String(req.headers.authorization ?? '')
  const got = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '')
  const want = Buffer.from(token)
  return got.length === want.length && timingSafeEqual(got, want)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > 4_000_000) throw new Error('too large')
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function rpcError(id: string | number | null, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function end(res: ServerResponse, status: number): void {
  res.writeHead(status)
  res.end()
}
