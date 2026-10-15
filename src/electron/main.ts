import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const ollamaExecutable = process.platform === 'win32' ? 'ollama.exe' : 'ollama'
const electronDirectory = path.dirname(fileURLToPath(import.meta.url))
const ollamaApiUrl = 'http://127.0.0.1:11434'
let ollamaServer: ReturnType<typeof spawn> | undefined

type ModelId = 'gemma4-e2b' | 'gemma4-e4b' | 'qwen3-8b'

const models: Record<ModelId, { name: string; tag: string }> = {
  'gemma4-e2b': { name: 'Gemma 4 E2B (non-quantized)', tag: 'gemma4:e2b' },
  'gemma4-e4b': { name: 'Gemma 4 E4B (non-quantized)', tag: 'gemma4:e4b' },
  'qwen3-8b': { name: 'Qwen3 8B (Q4_K_M)', tag: 'qwen3:8b-q4_K_M' },
}

interface SystemInfo {
  ramGb: number
  freeStorageGb: number
}

interface PullResult {
  success: boolean
  error?: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatResult {
  message: ChatMessage
}

async function getInstalledModels(): Promise<ModelId[]> {
  await ensureOllamaRunning()
  const response = await fetch(`${ollamaApiUrl}/api/tags`)
  if (!response.ok) throw new Error(`Could not read installed Ollama models (${response.status}).`)
  const result = (await response.json()) as { models?: Array<{ name?: string }> }
  const installedNames = new Set((result.models ?? []).map((model) => model.name))
  return (Object.entries(models) as Array<[ModelId, { tag: string }]>)
    .filter(([, model]) => installedNames.has(model.tag))
    .map(([modelId]) => modelId)
}

async function isOllamaInstalled(): Promise<boolean> {
  try {
    await execFileAsync(ollamaExecutable, ['--version'])
    return true
  } catch {
    return false
  }
}

async function isOllamaRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${ollamaApiUrl}/api/tags`)
    return response.ok
  } catch {
    return false
  }
}

async function ensureOllamaRunning(): Promise<void> {
  if (await isOllamaRunning()) return

  ollamaServer = spawn(ollamaExecutable, ['serve'], {
    windowsHide: true,
    detached: false,
    stdio: 'ignore',
  })
  ollamaServer.once('error', () => {
    ollamaServer = undefined
  })

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await isOllamaRunning()) return
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
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `(Get-PSDrive -Name '${drive[0]}').Free`,
  ])
  const freeBytes = Number(stdout.trim())
  return Number.isFinite(freeBytes) ? freeBytes / 1024 ** 3 : 0
}

async function getSystemInfo(): Promise<SystemInfo> {
  return {
    ramGb: os.totalmem() / 1024 ** 3,
    freeStorageGb: await getFreeStorageGb(),
  }
}

async function installOllama(): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('Automatic Ollama installation is currently supported on Windows only.')
  }

  await execFileAsync('winget.exe', [
    'install',
    '--id',
    'Ollama.Ollama',
    '--exact',
    '--source',
    'winget',
    '--accept-source-agreements',
    '--accept-package-agreements',
  ])
}

function pullModel(
  window: BrowserWindow,
  modelId: ModelId,
): Promise<PullResult> {
  const model = models[modelId]
  return new Promise((resolve) => {
    const process = spawn(ollamaExecutable, ['pull', model.tag], {
      windowsHide: true,
    })
    let errorOutput = ''

    process.stdout.on('data', (data: Buffer) => {
      window.webContents.send('ollama:model-progress', data.toString())
    })
    process.stderr.on('data', (data: Buffer) => {
      const output = data.toString()
      errorOutput += output
      window.webContents.send('ollama:model-progress', output)
    })
    process.on('error', (error) => resolve({ success: false, error: error.message }))
    process.on('close', (code) => {
      resolve(
        code === 0
          ? { success: true }
          : { success: false, error: errorOutput.trim() || `Ollama exited with code ${code ?? 'unknown'}.` },
      )
    })
  })
}

async function chatWithModel(modelId: ModelId, messages: ChatMessage[]): Promise<ChatResult> {
  await ensureOllamaRunning()
  const response = await fetch(`${ollamaApiUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: models[modelId].tag,
      messages,
      stream: false,
    }),
  })

  if (!response.ok) {
    throw new Error(`Ollama chat request failed with status ${response.status}.`)
  }

  const result = (await response.json()) as { message?: ChatMessage }
  if (!result.message?.content) {
    throw new Error('Ollama returned an empty response.')
  }
  return { message: result.message }
}

function registerIpcHandlers(window: BrowserWindow): void {
  ipcMain.handle('ollama:status', async () => {
    const installed = await isOllamaInstalled()
    const models = installed ? await getInstalledModels() : []
    return {
      installed,
      running: installed ? await isOllamaRunning() : false,
      models,
      system: await getSystemInfo(),
    }
  })

  ipcMain.handle('ollama:install', async () => {
    await installOllama()
    return { installed: await isOllamaInstalled() }
  })

  ipcMain.handle('ollama:pull-model', (_event, modelId: ModelId) => {
    if (!(modelId in models)) {
      throw new Error('Unknown model selected.')
    }
    return ensureOllamaRunning().then(() => pullModel(window, modelId))
  })

  ipcMain.handle('ollama:open-download-page', () => {
    void shell.openExternal('https://ollama.com/download/windows')
  })

  ipcMain.handle('ollama:chat', (_event, modelId: ModelId, messages: ChatMessage[]) => {
    if (!(modelId in models)) {
      throw new Error('Unknown model selected.')
    }
    if (!Array.isArray(messages) || messages.some((message) => (
      !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string'
    ))) {
      throw new Error('Invalid chat messages.')
    }
    return chatWithModel(modelId, messages)
  })
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 640,
    minHeight: 560,
    show: false,
    webPreferences: {
      preload: path.join(electronDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  registerIpcHandlers(window)
  window.once('ready-to-show', () => window.show())
  void window.loadFile(path.join(app.getAppPath(), 'dist-react', 'index.html'))
}

app.whenReady().then(createWindow).catch((error: unknown) => {
  console.error('Failed to create the application window:', error)
  app.quit()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('will-quit', () => {
  ollamaServer?.kill()
})
