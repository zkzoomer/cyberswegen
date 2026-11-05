/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// This is the Node.js Codex agent used inside the Daytona sandbox.
// This script is uploaded to the sandbox and invoked with PROMPT in the environment.

import { Codex, Thread } from '@openai/codex-sdk'
import { appendFile } from 'node:fs/promises'
import type {
  ThreadOptions,
  ThreadItem,
  TodoListItem,
  CommandExecutionItem,
  FileChangeItem,
  McpToolCallItem,
  WebSearchItem,
  ErrorItem,
  AgentMessageItem,
  Usage,
} from '@openai/codex-sdk'

const FAILURE_EVENT_LOG =
  process.env.CODEX_FAILURE_EVENT_LOG ?? '/home/daytona/workspace/codex-worker-failures.jsonl'

async function persistFailureEvent(event: unknown): Promise<void> {
  const record = JSON.stringify({ timestamp: new Date().toISOString(), event })
  try {
    await appendFile(FAILURE_EVENT_LOG, `${record}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Failed to persist Codex failure event to ${FAILURE_EVENT_LOG}: ${message}`)
  }
}

// Convert output from the agent to a printable string
function toolCallToString(item: ThreadItem): string {
  if (item.type === 'command_execution') {
    const commandItem = item as CommandExecutionItem
    const status = commandItem.status === 'completed' && commandItem.exit_code === 0 ? '✓' : '✗'
    return `🔨 ${status} Run: \`${commandItem.command}\``
  } else if (item.type === 'file_change') {
    const fileChangeItem = item as FileChangeItem
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
    return fileChangeItem.changes.map((change) => `📝 ${capitalize(change.kind)} ${change.path}`).join('\n')
  } else if (item.type === 'mcp_tool_call') {
    const mcpToolCallItem = item as McpToolCallItem
    return `🔧 MCP Tool: ${mcpToolCallItem.tool}`
  } else if (item.type === 'web_search') {
    const webSearchItem = item as WebSearchItem
    return `🌐 Web search: ${webSearchItem.query}`
  } else if (item.type === 'todo_list') {
    const todoListItem = item as TodoListItem
    const todoList = todoListItem.items.map((todo) => `  - [${todo.completed ? 'x' : ' '}] ${todo.text}`).join('\n')
    return `🗒️ To-do list:\n` + todoList
  } else if (item.type === 'error') {
    const errorItem = item as ErrorItem
    return `❌ Error: ${errorItem.message}`
  } else if (item.type === 'agent_message') {
    const agentMessageItem = item as AgentMessageItem
    return agentMessageItem.text
  }
  return ''
}

async function main(): Promise<void> {
  const prompt = process.env.PROMPT?.trim()
  if (!prompt) {
    console.error('Error: PROMPT not provided')
    process.exit(1)
  }

  const supportedReasoningEfforts = new Set([
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'ultra',
    'persistent',
  ])
  const reasoningEffort = process.env.CODEX_REASONING_EFFORT ?? 'medium'
  if (!supportedReasoningEfforts.has(reasoningEffort)) {
    console.error(`Error: unsupported CODEX_REASONING_EFFORT: ${reasoningEffort}`)
    process.exit(1)
  }

  // Authentication is established in this disposable sandbox with
  // `codex login --device-auth` before the launcher starts. No API key is passed.
  const codex = new Codex()

  // Configure one autonomous task-building turn.
  const options: ThreadOptions = {
    model: process.env.CODEX_MODEL ?? 'gpt-5.6-sol',
    modelReasoningEffort: reasoningEffort as NonNullable<ThreadOptions['modelReasoningEffort']>,
    workingDirectory: '/home/daytona/workspace',
    skipGitRepoCheck: true,
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never',
    networkAccessEnabled: true,
    webSearchMode: 'live',
  }
  const thread: Thread = codex.startThread(options)

  // Run the Codex agent and stream the output
  const { events } = await thread.runStreamed(prompt, {
    cyberAccessProgram: 'daybreak_blue',
  })
  for await (const event of events) {
    if (event.type === 'item.completed') {
      // Print each completed item
      const output = toolCallToString(event.item).trim()
      if (output) console.log(output)
    } else if (event.type === 'turn.completed') {
      // Print usage summary when the agent is finished
      const { cached_input_tokens, input_tokens, output_tokens } = event.usage as Usage
      console.log(`*Usage Summary: Cached: ${cached_input_tokens}, Input: ${input_tokens}, Output: ${output_tokens}*`)
    } else if (event.type === 'turn.failed') {
      console.error(`Codex turn failed: ${event.error.message}`)
      await persistFailureEvent(event)
    } else if (event.type === 'error') {
      console.error(`Codex stream error: ${event.message}`)
      await persistFailureEvent(event)
    }
  }
}

main().catch((err) => {
  console.error('Agent error:', err)
  process.exit(1)
})
