// Messages between the tutor agent (a Claude Code CLI process with the app's MCP tools) and the app.
import type { Effort, LlmErrorKind } from './types'

export interface AgentToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface AgentStartRequest {
  chatId: string
  system: string
  tools: AgentToolDef[]
  /** Claude Code session to continue (from an earlier run of this chat) */
  resume: string | null
  /** fresh session id to use when not resuming */
  sessionId: string
  model?: string
  effort?: Effort
}

export type AgentEvent =
  | { chatId: string; type: 'status'; status: 'starting' | 'ready' | 'thinking' | 'writing' | 'idle'; model?: string | null }
  /** assistant text streaming in; one message id per assistant text block */
  | { chatId: string; type: 'text'; blockId: string; delta: string }
  /** a tool call's input streaming in, before the call runs */
  | { chatId: string; type: 'tool_input'; toolUseId: string; name: string; json: string; done: boolean }
  /** the agent is calling one of the app's tools and waits for agentToolResult(callId) */
  | { chatId: string; type: 'tool_call'; callId: string; name: string; args: Record<string, unknown> }
  /** the tool call was abandoned by the agent (it stopped or was interrupted) */
  | { chatId: string; type: 'tool_cancel'; callId: string }
  | { chatId: string; type: 'turn_end'; ok: boolean; error?: string; errorKind?: LlmErrorKind; costUsd?: number | null }
  | { chatId: string; type: 'exit'; error?: string; errorKind?: LlmErrorKind }

export interface AgentToolResult {
  text: string
  isError?: boolean
}

/** Tools are exposed to the CLI as mcp__anamnesis__<name>. */
export const MCP_SERVER = 'anamnesis'
export const toolShortName = (name: string): string => name.replace(/^mcp__anamnesis__/, '')
