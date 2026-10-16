import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { ensureOllamaRunning, models, ollamaApiUrl, registerOllamaOnboardingHandlers, type ModelId } from './n2c-e-user-onboarding/n2c-e-user-onboarding-main.js'
const electronDirectory = path.dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatResult {
  message: ChatMessage
}

interface GenerationNode {
  id: string
  data?: {
    label?: string
    description?: string
    kind?: string
    apis?: Array<{ method: string; path: string; description: string }>
  }
}

interface GenerationGraph {
  nodes: GenerationNode[]
  edges: Array<{ source: string; target: string }>
}

interface GeneratedFile {
  path: string
  content: string
}

interface GenerationResult {
  projectPath: string
  files: GeneratedFile[]
  editorOpened: boolean
  editorMessage?: string
}

interface GenerationProgress {
  phase: 'preparing' | 'generating' | 'writing' | 'complete' | 'error'
  percent: number
  status: string
  filesWritten?: number
  totalFiles?: number
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

async function streamGeneration(modelId: ModelId, messages: ChatMessage[], onProgress: (progress: GenerationProgress) => void): Promise<string> {
  await ensureOllamaRunning()
  const response = await fetch(`${ollamaApiUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: models[modelId].tag, messages, stream: true, format: 'json', options: { temperature: 0.1 } }),
  })
  if (!response.ok || !response.body) throw new Error(`Ollama generation request failed with status ${response.status}.`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const item = JSON.parse(line) as { message?: { content?: string } }
      content += item.message?.content ?? ''
      onProgress({ phase: 'generating', percent: Math.min(85, 10 + Math.round(content.length / 500)), status: 'Receiving generated files from the local model…' })
    }
  }
  if (buffer.trim()) {
    const item = JSON.parse(buffer) as { message?: { content?: string } }
    content += item.message?.content ?? ''
  }
  if (!content) throw new Error('Ollama returned an empty generation response.')
  return content
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

function sanitizeProjectName(value: string): string {
  const sanitized = value.trim().replace(/[<>:"/\\|?*]/g, '-').split('').filter((character) => character.charCodeAt(0) >= 32).join('').replace(/[. ]+$/g, '')
  if (!sanitized || sanitized === '.' || sanitized === '..') throw new Error('Project name must contain at least one valid character.')
  return sanitized.slice(0, 80)
}

function parseGeneratedFiles(content: string): GeneratedFile[] {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = cleaned.indexOf('{')
  if (start < 0) throw new Error('The model did not return a JSON file manifest.')
  let depth = 0
  let inString = false
  let escaped = false
  let end = -1
  for (let index = start; index < cleaned.length; index += 1) {
    const character = cleaned[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}' && --depth === 0) {
      end = index
      break
    }
  }
  if (end <= start) throw new Error('The model did not return a complete JSON file manifest.')
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { files?: GeneratedFile[] }
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) throw new Error('The model returned no generated files.')
  if (parsed.files.some((file) => !file || typeof file.path !== 'string' || typeof file.content !== 'string')) {
    throw new Error('The model returned an invalid file structure.')
  }
  return parsed.files
}

async function findVsCodeCommand(): Promise<string | undefined> {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const candidates = [
    path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
    path.join(programFiles, 'Microsoft VS Code', 'bin', 'code.cmd'),
    path.join(programFiles, 'Microsoft VS Code', 'code.exe'),
  ]
  try {
    const { stdout } = await execFileAsync('where.exe', ['code.cmd'])
    candidates.unshift(...stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))
  } catch {
    // Fall back to the standard per-user and machine installation paths.
  }
  for (const candidate of [...new Set(candidates)]) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      continue
    }
  }
  return undefined
}

async function openInVsCode(projectPath: string): Promise<{ opened: boolean; message?: string }> {
  const command = await findVsCodeCommand()
  if (!command) return { opened: false, message: 'VS Code was not found. Install VS Code or add its code command to PATH.' }
  const executable = command.toLowerCase().endsWith('code.cmd')
    ? path.resolve(path.dirname(command), '..', 'Code.exe')
    : command
  try {
    try {
      await fs.access(executable)
      await new Promise<void>((resolve, reject) => {
        const process = spawn(executable, [projectPath], { detached: true, windowsHide: true, stdio: 'ignore' })
        process.once('error', reject)
        process.once('spawn', () => {
          process.unref()
          resolve()
        })
      })
    } catch (executableCause) {
      if (!command.toLowerCase().endsWith('.cmd')) throw executableCause
      await new Promise<void>((resolve, reject) => {
        const process = spawn('cmd.exe', ['/d', '/c', 'call', command, projectPath], { detached: true, windowsHide: true, stdio: 'ignore' })
        process.once('error', reject)
        process.once('spawn', () => {
          process.unref()
          resolve()
        })
      })
    }
    return { opened: true }
  } catch (cause) {
    return { opened: false, message: `VS Code could not be opened: ${cause instanceof Error ? cause.message : 'unknown launch error'}` }
  }
}

async function generateProject(modelId: ModelId, projectName: string, graph: GenerationGraph, window: BrowserWindow): Promise<GenerationResult> {
  if (!(modelId in models)) throw new Error('Unknown model selected.')
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Invalid project graph.')
  const safeName = sanitizeProjectName(projectName)
  const projectPath = path.join('C:', 'nodetocode', 'projects', safeName)
  await fs.mkdir(projectPath, { recursive: true })
  const sendProgress = (progress: GenerationProgress) => {
    if (!window.isDestroyed()) window.webContents.send('project:generation-progress', progress)
  }
  sendProgress({ phase: 'preparing', percent: 5, status: 'Preparing the Java project request…' })
  const prompt = `Generate a complete Spring Boot Java backend from this visual project graph.

Requirements:
- Use Maven and Java 17.
- Include a pom.xml with Spring Web, Spring Data JPA, and H2 dependencies.
- Create a Main_file.java application entry point.
- Implement every API definition attached to controller nodes as a functional REST endpoint.
- Connect service methods to the repository/model layer and configure an in-memory H2 database.
- Return exactly one valid JSON object with this exact shape: {"files":[{"path":"relative/path","content":"file contents"}]}.
- Do not return multiple JSON objects, markdown fences, explanations, comments, or any text before or after the object.
- File paths must be relative to the project root. Do not include absolute paths or binary files.

Project graph:
${JSON.stringify(graph, null, 2)}`
  let generatedContent = await streamGeneration(modelId, [{ role: 'user', content: prompt }], sendProgress)
  let files: GeneratedFile[]
  try {
    files = parseGeneratedFiles(generatedContent)
  } catch {
    sendProgress({ phase: 'generating', percent: 20, status: 'Normalizing the model response and retrying…' })
    const repairPrompt = `Return only one valid JSON object with this exact shape: {"files":[{"path":"relative/path","content":"file contents"}]}.
Do not add markdown, explanations, multiple JSON objects, or text before or after the object.
Repair this model response:
${generatedContent}`
    generatedContent = await streamGeneration(modelId, [{ role: 'user', content: repairPrompt }], sendProgress)
    try {
      files = parseGeneratedFiles(generatedContent)
    } catch (retryCause) {
      throw new Error(`Could not parse generated project files after retry: ${retryCause instanceof Error ? retryCause.message : 'invalid model response'}`, { cause: retryCause })
    }
  }
  const safeFiles: GeneratedFile[] = []
  const seenPaths = new Set<string>()
  for (const file of files) {
    const relativePath = file.path.replace(/\\/g, '/')
    if (!relativePath || path.posix.isAbsolute(relativePath) || relativePath.split('/').includes('..') || relativePath.includes(':')) {
      throw new Error(`The model returned an unsafe file path: ${file.path}`)
    }
    if (seenPaths.has(relativePath)) throw new Error(`The model returned a duplicate file path: ${relativePath}`)
    seenPaths.add(relativePath)
    const destination = path.join(projectPath, ...relativePath.split('/'))
    if (!destination.toLowerCase().startsWith(`${projectPath.toLowerCase()}${path.sep}`)) throw new Error(`The model returned an unsafe file path: ${file.path}`)
    safeFiles.push({ path: relativePath, content: file.content })
  }
  sendProgress({ phase: 'writing', percent: 88, status: `Writing ${safeFiles.length} generated files…`, totalFiles: safeFiles.length, filesWritten: 0 })
  for (const [index, file] of safeFiles.entries()) {
    const destination = path.join(projectPath, ...file.path.split('/'))
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, file.content, 'utf8')
    sendProgress({ phase: 'writing', percent: 88 + Math.round(((index + 1) / safeFiles.length) * 10), status: `Writing ${file.path}…`, totalFiles: safeFiles.length, filesWritten: index + 1 })
  }
  const editor = await openInVsCode(projectPath)
  sendProgress({ phase: 'complete', percent: 100, status: 'Project generated and ready in VS Code.', totalFiles: safeFiles.length, filesWritten: safeFiles.length })
  return { projectPath, files: safeFiles, editorOpened: editor.opened, editorMessage: editor.message }
}

function registerGenerationHandler(): void {
  ipcMain.handle('project:generate', (event, modelId: ModelId, projectName: string, graph: GenerationGraph) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('The application window is unavailable.')
    return generateProject(modelId, projectName, graph, window)
  })
  ipcMain.handle('project:open-folder', async (_event, projectPath: string) => {
    if (!path.isAbsolute(projectPath)) throw new Error('Invalid project path.')
    const error = await shell.openPath(projectPath)
    if (error) throw new Error(`Could not open project folder: ${error}`)
  })
  ipcMain.handle('project:export-zip', async (_event, projectPath: string) => {
    if (!path.isAbsolute(projectPath)) throw new Error('Invalid project path.')
    const zipPath = `${projectPath}.zip`
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -Path $args[0] -DestinationPath $args[1] -Force', '-Args', projectPath, zipPath], { windowsHide: true })
    return zipPath
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
  registerGenerationHandler()
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
