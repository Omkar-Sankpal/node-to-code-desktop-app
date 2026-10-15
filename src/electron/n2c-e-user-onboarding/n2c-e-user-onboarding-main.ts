import { BrowserWindow, ipcMain, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const execFileAsync = promisify(execFile)
const ollamaCommand = process.platform === 'win32' ? 'ollama.exe' : 'ollama'
export const ollamaApiUrl = 'http://127.0.0.1:11434'

export type ModelId = 'gemma4-e2b' | 'gemma4-e4b' | 'qwen3-8b'
export type SetupPhase = 'checking' | 'not-installed' | 'installing-ollama' | 'starting-ollama' | 'downloading-model' | 'ready' | 'error'

export const models: Record<ModelId, { name: string; tag: string }> = {
  'gemma4-e2b': { name: 'Gemma 4 E2B (non-quantized)', tag: 'gemma4:e2b' },
  'gemma4-e4b': { name: 'Gemma 4 E4B (non-quantized)', tag: 'gemma4:e4b' },
  'qwen3-8b': { name: 'Qwen3 8B (Q4_K_M)', tag: 'qwen3:8b-q4_K_M' },
}

export interface SetupProgress {
  phase: SetupPhase
  percent: number
  status: string
  completed?: number
  total?: number
}

interface SystemInfo {
  ramGb: number
  freeStorageGb: number
}

interface PullResult {
  success: boolean
  cancelled?: boolean
  error?: string
}

let cancelActiveOperation: (() => void) | undefined

function getOllamaCandidates(): string[] {
  if (process.platform !== 'win32') return [ollamaCommand]
  return [
    ollamaCommand,
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama.exe'),
    path.join(process.env.ProgramFiles ?? '', 'Ollama', 'ollama.exe'),
  ]
}

async function getOllamaExecutable(): Promise<string | undefined> {
  const candidates = getOllamaCandidates()
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('where.exe', [ollamaCommand])
      candidates.push(...stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))
    } catch {
      // Check the known installation locations below.
    }
  }
  for (const candidate of [...new Set(candidates)]) {
    if (candidate !== ollamaCommand && !fs.existsSync(candidate)) continue
    try {
      const { stdout, stderr } = await execFileAsync(candidate, ['--version'])
      if (/ollama/i.test(`${stdout}${stderr}`)) return candidate
    } catch {
      continue
    }
  }
  return undefined
}

function emit(window: BrowserWindow, progress: SetupProgress): void {
  if (!window.isDestroyed()) window.webContents.send('ollama:setup-progress', progress)
}

export async function isOllamaInstalled(): Promise<boolean> {
  return Boolean(await getOllamaExecutable())
}

export async function isOllamaRunning(): Promise<boolean> {
  try {
    return (await fetch(`${ollamaApiUrl}/api/tags`)).ok
  } catch {
    return false
  }
}

export async function ensureOllamaRunning(window?: BrowserWindow): Promise<void> {
  if (await isOllamaRunning()) return
  if (window) emit(window, { phase: 'starting-ollama', percent: 0, status: 'Starting the local Ollama service…' })
  const executable = await getOllamaExecutable()
  if (!executable) throw new Error('Ollama is not installed. Install Ollama before starting its local service.')
  const server = spawn(executable, ['serve'], { windowsHide: true, detached: false, stdio: 'ignore' })
  server.once('error', () => undefined)
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await isOllamaRunning()) {
      if (window) emit(window, { phase: 'starting-ollama', percent: 100, status: 'Ollama is running locally.' })
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Ollama was installed but its local service did not start.')
}

async function getFreeStorageGb(): Promise<number> {
  if (process.platform !== 'win32') {
    const { stdout } = await execFileAsync('df', ['-k', os.homedir()])
    const availableKb = Number(stdout.trim().split(/\s+/).at(-3))
    return Number.isFinite(availableKb) ? availableKb / 1024 / 1024 : 0
  }
  const drive = path.parse(os.homedir()).root.replace('\\', '')
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-PSDrive -Name '${drive[0]}').Free`])
  const freeBytes = Number(stdout.trim())
  return Number.isFinite(freeBytes) ? freeBytes / 1024 ** 3 : 0
}

async function getSystemInfo(): Promise<SystemInfo> {
  return { ramGb: os.totalmem() / 1024 ** 3, freeStorageGb: await getFreeStorageGb() }
}

export async function getInstalledModels(): Promise<ModelId[]> {
  const response = await fetch(`${ollamaApiUrl}/api/tags`)
  if (!response.ok) throw new Error(`Could not read installed Ollama models (${response.status}).`)
  const result = (await response.json()) as { models?: Array<{ name?: string }> }
  const installedNames = new Set((result.models ?? []).map((model) => model.name))
  return (Object.entries(models) as Array<[ModelId, { tag: string }]>)
    .filter(([, model]) => installedNames.has(model.tag))
    .map(([modelId]) => modelId)
}

async function installOllama(window: BrowserWindow): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Automatic Ollama installation is currently supported on Windows only.')
  emit(window, { phase: 'installing-ollama', percent: 0, status: 'Downloading and installing Ollama…' })
  await new Promise<void>((resolve, reject) => {
    const installer = spawn('winget.exe', ['install', '--id', 'Ollama.Ollama', '--exact', '--source', 'winget', '--accept-source-agreements', '--accept-package-agreements'], { windowsHide: true })
    let cancelled = false
    cancelActiveOperation = () => {
      cancelled = true
      installer.kill()
    }
    let output = ''
    const onData = (data: Buffer) => {
      output += data.toString()
      const match = output.match(/(\d{1,3})\s*%/)
      emit(window, { phase: 'installing-ollama', percent: match ? Number(match[1]) : 0, status: 'Downloading and installing Ollama…' })
    }
    installer.stdout.on('data', onData)
    installer.stderr.on('data', onData)
    installer.on('error', (error) => {
      cancelActiveOperation = undefined
      reject(cancelled ? new Error('Ollama installation was cancelled.') : error)
    })
    installer.on('close', (code) => {
      cancelActiveOperation = undefined
      if (cancelled) reject(new Error('Ollama installation was cancelled.'))
      else if (code === 0) {
        emit(window, { phase: 'installing-ollama', percent: 100, status: 'Ollama installer finished. Verifying installation…' })
        resolve()
      }
      else reject(new Error(output.trim() || `Ollama installer exited with code ${code ?? 'unknown'}.`))
    })
  })
  const installed = await getOllamaExecutable()
  if (!installed) throw new Error('The installer finished, but Ollama could not be found. Restart the app and try again.')
}

async function pullModel(window: BrowserWindow, modelId: ModelId): Promise<PullResult> {
  const abortController = new AbortController()
  cancelActiveOperation = () => abortController.abort()
  const response = await fetch(`${ollamaApiUrl}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: models[modelId].tag, stream: true }),
    signal: abortController.signal,
  })
  if (!response.ok || !response.body) {
    cancelActiveOperation = undefined
    return { success: false, error: `Ollama model download failed with status ${response.status}.` }
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const item = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string }
        if (item.error) return { success: false, error: item.error }
        const percent = item.total ? Math.min(100, Math.round(((item.completed ?? 0) / item.total) * 100)) : 0
        emit(window, { phase: 'downloading-model', percent, status: item.status ?? 'Downloading model…', completed: item.completed, total: item.total })
      }
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      emit(window, { phase: 'ready', percent: 0, status: 'Model download cancelled.' })
      return { success: false, cancelled: true, error: 'Model download was cancelled.' }
    }
    throw error
  } finally {
    cancelActiveOperation = undefined
    reader.releaseLock()
  }
  emit(window, { phase: 'downloading-model', percent: 100, status: 'Model downloaded successfully.' })
  return { success: true }
}

export function registerOllamaOnboardingHandlers(window: BrowserWindow): void {
  ipcMain.handle('ollama:status', async () => {
    emit(window, { phase: 'checking', percent: 0, status: 'Checking Ollama and your local system…' })
    const installed = await isOllamaInstalled()
    if (installed) await ensureOllamaRunning(window)
    const installedModels = installed ? await getInstalledModels() : []
    emit(window, installed
      ? { phase: installedModels.length ? 'ready' : 'checking', percent: 100, status: installedModels.length ? 'Ollama is ready.' : 'Ollama is installed. Choose a model to continue.' }
      : { phase: 'not-installed', percent: 0, status: 'Ollama is not installed on this device.' })
    return { installed, running: installed ? await isOllamaRunning() : false, models: installedModels, system: await getSystemInfo() }
  })
  ipcMain.handle('ollama:install', async () => {
    await installOllama(window)
    await ensureOllamaRunning(window)
    const installed = await isOllamaInstalled()
    if (!installed) throw new Error('Ollama installation could not be verified.')
    return { installed }
  })
  ipcMain.handle('ollama:pull-model', async (_event, modelId: ModelId) => {
    if (!(modelId in models)) throw new Error('Unknown model selected.')
    await ensureOllamaRunning(window)
    return pullModel(window, modelId)
  })
  ipcMain.handle('ollama:cancel-setup', () => {
    if (cancelActiveOperation) {
      cancelActiveOperation()
      return true
    }
    return false
  })
  ipcMain.handle('ollama:open-download-page', () => { void shell.openExternal('https://ollama.com/download/windows') })
}
