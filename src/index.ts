/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Daytona, Sandbox } from '@daytona/sdk'
import * as dotenv from 'dotenv'
import { renderMarkdown } from './utils'

dotenv.config()

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REMOTE_WORKSPACE = '/home/daytona/workspace'
const REMOTE_OUTPUT = '/output'
const REMOTE_FAILURE_LOG = `${REMOTE_WORKSPACE}/codex-worker-failures.jsonl`
const SANDBOX_MAX_LIFETIME_MINUTES = readPositiveIntegerEnv(
  'DAYTONA_SANDBOX_MAX_LIFETIME_MINUTES',
  240,
)
const SANDBOX_RECOVERY_RETENTION_MINUTES = readPositiveIntegerEnv(
  'DAYTONA_SANDBOX_RECOVERY_RETENTION_MINUTES',
  120,
)

type CliOptions = {
  advisory: string
  focus?: string
  taskId: string
  dryRun: boolean
  authSmoke: boolean
  outputDir: string
}

type RemoteArtifact = {
  name: string
  path: string
  size: number
  sha256: string
}

function usage(): string {
  return [
    'Usage:',
    '  npm run start -- --advisory <https-url> --task-id <positive-integer> [--focus <scope>] [--output-dir <path>]',
    '  npm run start -- --advisory <https-url> --task-id <positive-integer> [--focus <scope>] --dry-run',
    '  npm run start -- --advisory <https-url> --auth-smoke',
    '',
    '--task-id is required for every task-building or dry-run invocation and is',
    'written to metadata.task_id. The controller fails before creating a sandbox',
    'when it is omitted. --auth-smoke is the only mode that does not require it.',
    '',
    '--dry-run renders JOB.md, displays it, creates a sandbox from the configured',
    'snapshot, writes a known smoke ZIP under /output, downloads and verifies it,',
    'then deletes the sandbox. It does not authenticate or invoke Codex.',
    '',
    '--auth-smoke creates a sandbox, asks you to authorize its one-time ChatGPT',
    'device login in your browser, runs a one-turn gpt-5.6-sol check, logs out,',
    'and deletes the sandbox. It does not build a CyberSWE task.',
  ].join('\n')
}

function readOptionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`)
  return value
}

function parseArgs(args: string[]): CliOptions {
  let advisory = ''
  let focus: string | undefined
  let taskId = ''
  let dryRun = false
  let authSmoke = false
  let outputDir = process.env.LOCAL_OUTPUT_DIR || './outputs'

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') {
      console.log(usage())
      process.exit(0)
    } else if (arg === '--advisory') {
      advisory = readOptionValue(args, index, arg)
      index += 1
    } else if (arg.startsWith('--advisory=')) {
      advisory = arg.slice('--advisory='.length)
    } else if (arg === '--focus') {
      focus = readOptionValue(args, index, arg)
      index += 1
    } else if (arg.startsWith('--focus=')) {
      focus = arg.slice('--focus='.length)
    } else if (arg === '--task-id') {
      taskId = readOptionValue(args, index, arg)
      index += 1
    } else if (arg.startsWith('--task-id=')) {
      taskId = arg.slice('--task-id='.length)
    } else if (arg === '--output-dir') {
      outputDir = readOptionValue(args, index, arg)
      index += 1
    } else if (arg.startsWith('--output-dir=')) {
      outputDir = arg.slice('--output-dir='.length)
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--auth-smoke') {
      authSmoke = true
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  if (dryRun && authSmoke) throw new Error('--dry-run and --auth-smoke are mutually exclusive')

  if (!advisory.trim()) throw new Error('--advisory is required')
  let parsed: URL
  try {
    parsed = new URL(advisory)
  } catch {
    throw new Error(`invalid advisory URL: ${advisory}`)
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) {
    throw new Error('the advisory must be an absolute HTTPS URL')
  }
  if (focus !== undefined && !focus.trim()) throw new Error('--focus cannot be empty')
  if (!authSmoke && !taskId) {
    throw new Error('--task-id is required for task-building and dry-run invocations')
  }
  if (authSmoke && !taskId) taskId = '1'
  if (!/^[1-9][0-9]*$/.test(taskId)) {
    throw new Error('--task-id must be a positive integer')
  }
  const numericTaskId = Number(taskId)
  if (!Number.isSafeInteger(numericTaskId)) {
    throw new Error('--task-id is too large')
  }
  if (!outputDir.trim()) throw new Error('--output-dir cannot be empty')

  return {
    advisory: parsed.toString(),
    focus: focus?.trim(),
    taskId,
    dryRun,
    authSmoke,
    outputDir: path.resolve(outputDir),
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set`)
  return value
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer number of minutes`)
  }
  return value
}

async function renderJob(options: CliOptions): Promise<string> {
  const templatePath = path.join(PROJECT_ROOT, 'JOB.template.md')
  const template = await fs.readFile(templatePath, 'utf8')
  const focus = options.focus ? `Approved focus: ${options.focus}` : ''
  const rendered = template
    .split('{{ADVISORY_URL}}').join(options.advisory)
    .split('{{OPTIONAL_FOCUS}}').join(focus)
    .split('{{TASK_ID}}').join(options.taskId)

  if (/\{\{[A-Z0-9_]+\}\}/.test(rendered)) {
    throw new Error('JOB.template.md contains an unresolved template variable')
  }
  return rendered.endsWith('\n') ? rendered : `${rendered}\n`
}

type RvAuthFile = {
  openrouter_api_key?: unknown
}

async function loadOpenRouterApiKey(): Promise<string> {
  const fromEnvironment = process.env.OPENROUTER_API_KEY?.trim()
  if (fromEnvironment) return fromEnvironment

  const configuredPath = process.env.RV_AUTH_PATH?.trim()
  const authPath = configuredPath
    ? path.resolve(configuredPath)
    : path.join(os.homedir(), '.rv', 'auth.json')

  let parsed: RvAuthFile
  try {
    parsed = JSON.parse(await fs.readFile(authPath, 'utf8')) as RvAuthFile
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`cannot read the local rv OpenRouter credential at ${authPath}: ${message}`)
  }

  if (typeof parsed.openrouter_api_key !== 'string' || parsed.openrouter_api_key.trim().length < 20) {
    throw new Error(`local rv auth file has no usable openrouter_api_key: ${authPath}`)
  }
  return parsed.openrouter_api_key.trim()
}

function environmentPrefix(variables: Record<string, string>): string {
  const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64')
  return Object.entries(variables)
    .map(([name, value]) => `${name}="$(printf '%s' '${encode(value)}' | base64 --decode)"`)
    .join(' ')
}

async function waitForDocker(sandbox: Sandbox): Promise<void> {
  let lastResult = ''
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = await sandbox.process.executeCommand(
      "docker info --format '{{.ServerVersion}}'",
      REMOTE_WORKSPACE,
      undefined,
      10,
    )
    if (result.exitCode === 0) {
      console.log(`Docker daemon ready: ${result.result.trim()}`)
      return
    }
    lastResult = result.result.trim()
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  throw new Error(`Docker daemon did not become ready${lastResult ? `: ${lastResult}` : ''}`)
}

async function uploadJobFiles(sandbox: Sandbox, job: string): Promise<void> {
  await sandbox.fs.uploadFile(path.join(PROJECT_ROOT, 'AGENTS.md'), `${REMOTE_WORKSPACE}/AGENTS.md`)
  await sandbox.fs.uploadFile(Buffer.from(job, 'utf8'), `${REMOTE_WORKSPACE}/JOB.md`)
  // Keep the lightweight launcher current without rebuilding the heavyweight
  // toolchain snapshot. Its pinned dependencies remain in /opt/cyberswe-agent.
  await sandbox.fs.uploadFile(
    path.join(PROJECT_ROOT, 'agent', 'index.ts'),
    '/opt/cyberswe-agent/index.ts',
  )
}

async function configureRvAuthentication(sandbox: Sandbox, openRouterApiKey: string): Promise<void> {
  await executeChecked(sandbox, 'install -d -m 700 /root/.rv')
  const remoteAuth = JSON.stringify({ openrouter_api_key: openRouterApiKey, daytona_api_key: null })
  await sandbox.fs.uploadFile(Buffer.from(`${remoteAuth}\n`, 'utf8'), '/root/.rv/auth.json')
  await executeChecked(sandbox, 'chmod 600 /root/.rv/auth.json')
  await executeChecked(
    sandbox,
    "python3 -c 'import json; p=json.load(open(\"/root/.rv/auth.json\")); assert isinstance(p.get(\"openrouter_api_key\"), str) and len(p[\"openrouter_api_key\"]) >= 20'",
  )
  await executeChecked(
    sandbox,
    "python3 -c 'import json,urllib.request; p=json.load(open(\"/root/.rv/auth.json\")); r=urllib.request.urlopen(urllib.request.Request(\"https://openrouter.ai/api/v1/key\", headers={\"Authorization\": \"Bearer \" + p[\"openrouter_api_key\"]}), timeout=20); assert r.status == 200'",
    30,
  )
  console.log('Realm Verifier OpenRouter authentication installed from the local rv credential.')
}

async function runCodexWorker(sandbox: Sandbox, prompt: string): Promise<void> {
  const sessionId = `cyberswe-${Date.now()}`

  await sandbox.process.createSession(sessionId)
  try {
    const command = await sandbox.process.executeSessionCommand(
      sessionId,
      {
        command: `${environmentPrefix({ PROMPT: prompt })} env -u OPENAI_API_KEY -u CODEX_API_KEY /opt/cyberswe-agent/node_modules/.bin/tsx /opt/cyberswe-agent/index.ts`,
        runAsync: true,
        suppressInputEcho: true,
      },
      0,
    )
    if (!command.cmdId) throw new Error('Daytona did not return a Codex command ID')

    await sandbox.process.getSessionCommandLogs(
      sessionId,
      command.cmdId,
      (chunk: string) => {
        const rendered = renderMarkdown(chunk.trimEnd())
        if (rendered) process.stdout.write(`${rendered}\n`)
      },
      (chunk: string) => {
        if (chunk) process.stderr.write(chunk)
      },
    )

    const completed = await sandbox.process.getSessionCommand(sessionId, command.cmdId)
    if (completed.exitCode !== 0) {
      throw new Error(`Codex worker exited with status ${String(completed.exitCode)}`)
    }
  } finally {
    await sandbox.process.deleteSession(sessionId).catch(() => undefined)
  }
}

function initialWorkerPrompt(): string {
  return [
    `Read ${REMOTE_WORKSPACE}/JOB.md first.`,
    `Then follow ${REMOTE_WORKSPACE}/AGENTS.md as the authoritative factory policy and complete the job autonomously.`,
    `This is authorized defensive regression testing of a public advisory, performed only against a vendored open-source repository inside an isolated disposable sandbox.`,
    `Do not access live targets or real credentials.`,
    `Do not stop until exactly one verified normal draft ZIP or recovery ZIP is present under ${REMOTE_OUTPUT}. Probe-budget exhaustion requires the normal draft ZIP, not recovery. Never leave completed work only inside the disposable sandbox.`,
  ].join(' ')
}

function recoveryWorkerPrompt(): string {
  return [
    `Continue from the existing workspace.`,
    `Do not repeat completed work.`,
    `Read ${REMOTE_WORKSPACE}/JOB.md and ${REMOTE_WORKSPACE}/AGENTS.md, inspect the files and validation state already present, and finish the remaining work.`,
    `This is local authorized patch validation of a public advisory against a vendored open-source repository in an isolated disposable sandbox.`,
    `Do not access live targets or real credentials.`,
    `Do not stop until exactly one verified normal draft ZIP or recovery ZIP is present under ${REMOTE_OUTPUT}. Probe-budget exhaustion requires the normal draft ZIP, not recovery. Never leave completed work only inside the disposable sandbox.`,
  ].join(' ')
}

async function hasCyberPolicyFailure(sandbox: Sandbox): Promise<boolean> {
  const result = await sandbox.process.executeCommand(
    `test -s '${REMOTE_FAILURE_LOG}' && grep -Eqi 'cyber_policy|possible cybersecurity risk' '${REMOTE_FAILURE_LOG}'`,
    REMOTE_WORKSPACE,
    undefined,
    30,
  )
  return result.exitCode === 0
}

async function runCodexWorkerWithCyberRetry(sandbox: Sandbox): Promise<void> {
  try {
    await runCodexWorker(sandbox, initialWorkerPrompt())
  } catch (error) {
    if (!(await hasCyberPolicyFailure(sandbox))) throw error
    console.warn('Codex cyber-policy refusal detected; retrying once in a fresh thread from the existing workspace.')
    await runCodexWorker(sandbox, recoveryWorkerPrompt())
  }
}

async function runStreamedSessionCommand(
  sandbox: Sandbox,
  sessionPrefix: string,
  commandText: string,
): Promise<void> {
  const sessionId = `${sessionPrefix}-${Date.now()}`
  await sandbox.process.createSession(sessionId)
  try {
    const command = await sandbox.process.executeSessionCommand(
      sessionId,
      {
        command: commandText,
        runAsync: true,
        suppressInputEcho: true,
      },
      0,
    )
    if (!command.cmdId) throw new Error(`Daytona did not return a command ID for ${sessionPrefix}`)

    await sandbox.process.getSessionCommandLogs(
      sessionId,
      command.cmdId,
      (chunk: string) => {
        if (chunk) process.stdout.write(chunk)
      },
      (chunk: string) => {
        if (chunk) process.stderr.write(chunk)
      },
    )

    const completed = await sandbox.process.getSessionCommand(sessionId, command.cmdId)
    if (completed.exitCode !== 0) {
      throw new Error(`${sessionPrefix} exited with status ${String(completed.exitCode)}`)
    }
  } finally {
    await sandbox.process.deleteSession(sessionId).catch(() => undefined)
  }
}

async function loginCodex(sandbox: Sandbox): Promise<void> {
  console.log('Starting one-time ChatGPT device login for this sandbox...')
  console.log('Open the URL printed below, enter its code, and approve access.')
  await runStreamedSessionCommand(
    sandbox,
    'codex-login',
    'env -u OPENAI_API_KEY -u CODEX_API_KEY codex login --device-auth',
  )
  const status = await executeChecked(
    sandbox,
    'env -u OPENAI_API_KEY -u CODEX_API_KEY codex login status',
  )
  if (!/logged in using chatgpt/i.test(status)) {
    throw new Error(`unexpected Codex login status: ${status}`)
  }
  console.log(`Codex authentication ready: ${status}`)
}

async function logoutCodex(sandbox: Sandbox): Promise<void> {
  const result = await sandbox.process.executeCommand(
    'env -u OPENAI_API_KEY -u CODEX_API_KEY codex logout',
    REMOTE_WORKSPACE,
    undefined,
    60,
  )
  if (result.exitCode !== 0) {
    throw new Error(`Codex logout failed: ${result.result.trim() || `status ${String(result.exitCode)}`}`)
  }
  console.log('Removed the sandbox\'s stored Codex login.')
}

async function tryLogoutCodex(sandbox: Sandbox): Promise<boolean> {
  try {
    await logoutCodex(sandbox)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Warning: could not remove the sandbox Codex login cleanly: ${message}`)
    return false
  }
}

async function runAuthenticationSmoke(sandbox: Sandbox, model: string): Promise<void> {
  if (!/^[A-Za-z0-9._-]+$/.test(model)) throw new Error(`unsafe CODEX_MODEL value: ${model}`)
  const result = await executeChecked(
    sandbox,
    `env -u OPENAI_API_KEY -u CODEX_API_KEY codex exec --ephemeral --skip-git-repo-check --model '${model}' --sandbox read-only --color never "Reply only with OK"`,
    300,
  )
  console.log(result)
  if (!/(^|\n)OK(\n|$)/.test(result)) {
    throw new Error('authentication smoke run completed without the expected OK response')
  }
}

const DRY_RUN_SCRIPT = `
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile, ZipInfo
import shutil

output = Path('/output')
output.mkdir(parents=True, exist_ok=True)
for child in output.iterdir():
    if child.is_dir() and not child.is_symlink():
        shutil.rmtree(child)
    else:
        child.unlink()

archive = output / 'controller-smoke.zip'
entry = ZipInfo('smoke.txt', date_time=(1980, 1, 1, 0, 0, 0))
entry.compress_type = ZIP_STORED
entry.external_attr = 0o100644 << 16
with ZipFile(archive, 'w') as bundle:
    bundle.writestr(entry, b'cyberswe-controller-smoke\\n')
print(archive)
`.trimStart()

async function createDryRunArtifact(sandbox: Sandbox): Promise<void> {
  const remoteScript = '/tmp/cyberswe-controller-smoke.py'
  await sandbox.fs.uploadFile(Buffer.from(DRY_RUN_SCRIPT, 'utf8'), remoteScript)
  const result = await sandbox.process.executeCommand(`python3 ${remoteScript}`, REMOTE_WORKSPACE, undefined, 60)
  if (result.exitCode !== 0) throw new Error(`dry-run artifact creation failed: ${result.result}`)
  console.log(`Created remote smoke artifact: ${result.result.trim()}`)
}

async function executeChecked(sandbox: Sandbox, command: string, timeout = 120): Promise<string> {
  const result = await sandbox.process.executeCommand(command, REMOTE_WORKSPACE, undefined, timeout)
  if (result.exitCode !== 0) throw new Error(`remote command failed: ${command}\n${result.result}`)
  return result.result.trim()
}

async function configureRv(sandbox: Sandbox): Promise<void> {
  const version = await executeChecked(sandbox, 'rv --version')
  const modeResult = await executeChecked(sandbox, 'rv mode openrouter')
  await executeChecked(
    sandbox,
    "/opt/uv-tools/realm-verifier/bin/python -c 'from rv.cli._common import setup_done; assert setup_done()'",
  )
  console.log(`Realm Verifier ready: ${version}`)
  console.log(`Realm Verifier mode configured inside sandbox: ${modeResult || 'openrouter'}`)
  console.log('Realm Verifier authentication preflight is ready.')
}

function validateArchiveEntries(entries: string[], dryRun: boolean, artifactName: string): void {
  if (dryRun) {
    if (entries.length !== 1 || entries[0] !== 'smoke.txt') {
      throw new Error(`dry-run ZIP has unexpected entries: ${entries.join(', ')}`)
    }
    return
  }

  if (artifactName.endsWith('-recovery-handoff.zip')) {
    if (entries.length !== 2 || entries.some((entry) => entry.includes('/'))) {
      throw new Error(`recovery handoff must contain one work-in-progress ZIP and failure-summary.md; found: ${entries.join(', ')}`)
    }
    if (!entries.includes('failure-summary.md')) throw new Error('recovery handoff is missing failure-summary.md')
    const workInProgress = entries.filter((entry) => entry.endsWith('-work-in-progress.zip'))
    if (workInProgress.length !== 1) {
      throw new Error('recovery handoff must contain exactly one *-work-in-progress.zip')
    }
    return
  }

  if ((entries.length !== 3 && entries.length !== 4) || entries.some((entry) => entry.includes('/'))) {
    throw new Error(`handoff ZIP must contain the task ZIP, reasoning notes, draft proposal, and at most one validation summary; found: ${entries.join(', ')}`)
  }
  if (!entries.includes('reasoning-notes.md')) throw new Error('handoff ZIP is missing reasoning-notes.md')
  if (!entries.includes('draft-proposal.txt')) throw new Error('handoff ZIP is missing draft-proposal.txt')
  const allowedNotes = new Set(['reasoning-notes.md', 'draft-proposal.txt', 'validation-summary.md'])
  const unexpectedNotes = entries.filter((entry) => !entry.endsWith('.zip') && !allowedNotes.has(entry))
  if (unexpectedNotes.length > 0) throw new Error(`handoff ZIP has unexpected notes: ${unexpectedNotes.join(', ')}`)
  const nestedTasks = entries.filter((entry) => /^[A-Za-z0-9._-]+\.zip$/.test(entry))
  if (nestedTasks.length !== 1) {
    throw new Error('handoff ZIP must contain exactly one unmodified rv submit ZIP')
  }
}

async function inspectRemoteArtifact(sandbox: Sandbox, dryRun: boolean): Promise<RemoteArtifact> {
  const listing = await executeChecked(
    sandbox,
    "find /output -mindepth 1 -maxdepth 1 -printf '%f\\n' | LC_ALL=C sort",
  )
  const names = listing.split('\n').map((name) => name.trim()).filter(Boolean)
  if (names.length !== 1 || !/^[A-Za-z0-9._-]+\.zip$/.test(names[0])) {
    throw new Error(`/output must contain exactly one safely named ZIP; found: ${names.join(', ') || '(empty)'}`)
  }

  const name = names[0]
  const remotePath = `${REMOTE_OUTPUT}/${name}`
  const sizeText = await executeChecked(sandbox, `stat -c '%s' '${remotePath}'`)
  const shaText = await executeChecked(sandbox, `sha256sum '${remotePath}'`)
  const entryText = await executeChecked(sandbox, `unzip -Z1 '${remotePath}'`)
  const entries = entryText.split('\n').map((entry) => entry.trim()).filter(Boolean)
  validateArchiveEntries(entries, dryRun, name)

  const size = Number(sizeText)
  const sha256 = shaText.split(/\s+/)[0]
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`invalid remote ZIP size: ${sizeText}`)
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`invalid remote SHA-256: ${shaText}`)

  return { name, path: remotePath, size, sha256 }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

async function chooseLocalPath(outputDir: string, remoteName: string, dryRun: boolean): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true })
  const preferred = dryRun
    ? path.join(outputDir, `controller-smoke-${timestampForFilename()}.zip`)
    : path.join(outputDir, remoteName)
  try {
    await fs.access(preferred)
  } catch {
    return preferred
  }

  const extension = path.extname(remoteName)
  const stem = path.basename(remoteName, extension)
  return path.join(outputDir, `${stem}-${timestampForFilename()}${extension}`)
}

async function downloadAndVerify(
  sandbox: Sandbox,
  artifact: RemoteArtifact,
  outputDir: string,
  dryRun: boolean,
): Promise<string> {
  const localPath = await chooseLocalPath(outputDir, artifact.name, dryRun)
  await sandbox.fs.downloadFile(artifact.path, localPath, 0)
  const [localStat, localSha256] = await Promise.all([fs.stat(localPath), sha256File(localPath)])
  if (localStat.size !== artifact.size || localSha256 !== artifact.sha256) {
    throw new Error(
      `download verification failed: remote ${artifact.size}/${artifact.sha256}, local ${localStat.size}/${localSha256}`,
    )
  }
  return localPath
}

async function downloadFailureLog(sandbox: Sandbox, outputDir: string): Promise<string | undefined> {
  const exists = await sandbox.process.executeCommand(
    `test -s '${REMOTE_FAILURE_LOG}'`,
    REMOTE_WORKSPACE,
    undefined,
    30,
  )
  if (exists.exitCode !== 0) return undefined

  await fs.mkdir(outputDir, { recursive: true })
  const localPath = path.join(outputDir, `codex-worker-failures-${timestampForFilename()}.jsonl`)
  await sandbox.fs.downloadFile(REMOTE_FAILURE_LOG, localPath, 0)
  return localPath
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const job = await renderJob(options)
  const openRouterApiKey = options.authSmoke ? undefined : await loadOpenRouterApiKey()

  if (options.dryRun) {
    console.log('--- Rendered JOB.md ---')
    console.log(job.trimEnd())
    console.log('--- End JOB.md ---')
  }

  const daytona = new Daytona({ apiKey: requireEnv('DAYTONA_API_KEY') })
  const snapshot = requireEnv('DAYTONA_SNAPSHOT')
  const envVars: Record<string, string> = {}
  if (!options.dryRun) {
    envVars.CODEX_MODEL = requireEnv('CODEX_MODEL')
    envVars.CODEX_REASONING_EFFORT = requireEnv('CODEX_REASONING_EFFORT')
  }
  console.log(`Creating Daytona sandbox from snapshot ${snapshot}...`)
  const sandboxKind = options.dryRun ? 'smoke' : options.authSmoke ? 'auth-smoke' : 'job'
  const sandbox = await daytona.create(
    {
      name: `cyberswe-${sandboxKind}-${Date.now()}`,
      snapshot,
      envVars,
      public: false,
      // Internal builds do not reliably count as Daytona activity, so an
      // inactivity stop can kill healthy work. The wall-clock TTL below is
      // the unconditional backstop instead.
      autoStopInterval: 0,
      autoDeleteInterval: SANDBOX_RECOVERY_RETENTION_MINUTES,
      ttlMinutes: SANDBOX_MAX_LIFETIME_MINUTES,
    },
    { timeout: 600 },
  )
  console.log(`Sandbox created: ${sandbox.id} (${sandbox.name})`)

  let authenticated = false
  let deleted = false
  let handlingSignal = false
  const destroyOnInterruption = async (signal: string) => {
    if (handlingSignal) return
    handlingSignal = true
    console.error(`\nReceived ${signal}; logging out and destroying the disposable sandbox.`)
    await tryLogoutCodex(sandbox)
    try {
      await sandbox.delete()
      deleted = true
      console.error(`Deleted interrupted sandbox ${sandbox.id}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`Could not delete sandbox ${sandbox.id}; delete it manually in Daytona: ${message}`)
    }
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
  process.once('SIGINT', () => void destroyOnInterruption('SIGINT'))
  process.once('SIGTERM', () => void destroyOnInterruption('SIGTERM'))

  try {
    await waitForDocker(sandbox)
    if (!options.authSmoke) await uploadJobFiles(sandbox, job)
    if (openRouterApiKey) await configureRvAuthentication(sandbox, openRouterApiKey)
    await configureRv(sandbox)
    if (!options.dryRun) {
      await loginCodex(sandbox)
      authenticated = true
    }

    if (options.authSmoke) {
      await runAuthenticationSmoke(sandbox, requireEnv('CODEX_MODEL'))
      console.log('Authentication smoke run completed successfully.')
    } else if (options.dryRun) {
      await createDryRunArtifact(sandbox)
    } else {
      await executeChecked(sandbox, 'find /output -mindepth 1 -maxdepth 1 -delete')
      await executeChecked(sandbox, `rm -f '${REMOTE_FAILURE_LOG}'`)
      await runCodexWorkerWithCyberRetry(sandbox)
    }

    if (!options.authSmoke) {
      const artifact = await inspectRemoteArtifact(sandbox, options.dryRun)
      console.log(`Remote artifact: ${artifact.path} (${artifact.size} bytes, sha256 ${artifact.sha256})`)
      const localPath = await downloadAndVerify(sandbox, artifact, options.outputDir, options.dryRun)
      console.log(`Verified local artifact: ${localPath}`)
    }

    if (authenticated) {
      await logoutCodex(sandbox)
      authenticated = false
    }
    console.log(`Deleting completed sandbox ${sandbox.id}...`)
    await sandbox.delete()
    deleted = true
    console.log(
      options.authSmoke
        ? 'Authentication smoke completed successfully.'
        : options.dryRun
          ? 'Dry run completed successfully.'
          : 'CyberSWE draft handoff completed successfully.',
    )
  } catch (error) {
    await tryLogoutCodex(sandbox)
    authenticated = false
    try {
      const failureLog = await downloadFailureLog(sandbox, options.outputDir)
      if (failureLog) console.error(`Saved Codex failure events: ${failureLog}`)
    } catch (logError) {
      const message = logError instanceof Error ? logError.message : String(logError)
      console.error(`Warning: could not download Codex failure events: ${message}`)
    }
    try {
      // End CPU/RAM billing immediately while retaining the filesystem for a
      // short recovery window. Re-anchoring the TTL also guarantees cleanup
      // even if stopping the sandbox itself fails.
      await sandbox.setTtl(SANDBOX_RECOVERY_RETENTION_MINUTES)
      await sandbox.setAutoDeleteInterval(SANDBOX_RECOVERY_RETENTION_MINUTES)
      await sandbox.stop(120)
      console.error(
        `Job failed; stopped recovery sandbox ${sandbox.id}. Its filesystem will be retained for ` +
          `${SANDBOX_RECOVERY_RETENTION_MINUTES} minutes, then deleted automatically.`,
      )
    } catch (cleanupError) {
      const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      console.error(
        `Warning: could not stop recovery sandbox ${sandbox.id}: ${message}. ` +
          `Its ${SANDBOX_RECOVERY_RETENTION_MINUTES}-minute wall-clock TTL still applies.`,
      )
    }
    throw error
  } finally {
    if (!deleted) console.error(`Recovery sandbox: ${sandbox.id}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? `Error: ${error.message}` : error)
  process.exitCode = 1
})
