import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureOllamaRunning, models, ollamaApiUrl, registerOllamaOnboardingHandlers, type ModelId } from './n2c-e-user-onboarding/n2c-e-user-onboarding-main.js'
const electronDirectory = path.dirname(fileURLToPath(import.meta.url))

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatResult {
  message: ChatMessage
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

function registerChatHandler(): void {
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

  registerOllamaOnboardingHandlers(window)
  registerChatHandler()
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
