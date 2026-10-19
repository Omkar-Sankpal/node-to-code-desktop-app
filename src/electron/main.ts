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

interface GenerationStage {
  name: string
  instructions: string
  allowEmpty?: boolean
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
      keep_alive: 0,
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
    body: JSON.stringify({ model: models[modelId].tag, messages, stream: true, format: 'json', keep_alive: 0, options: { temperature: 0.1, num_ctx: 32768, num_predict: 12000 } }),
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
      const item = JSON.parse(line) as { message?: { content?: string }; error?: string }
      if (item.error) throw new Error(`Ollama generation failed: ${item.error}`)
      content += item.message?.content ?? ''
      onProgress({ phase: 'generating', percent: Math.min(85, 10 + Math.round(content.length / 500)), status: 'Receiving generated files from the local model…' })
    }
  }
  if (buffer.trim()) {
    const item = JSON.parse(buffer) as { message?: { content?: string }; error?: string }
    if (item.error) throw new Error(`Ollama generation failed: ${item.error}`)
    content += item.message?.content ?? ''
  }
  if (!content.trim()) throw new Error('Ollama returned an empty generation response. The selected model may still be loading or may not support this request.')
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

function parseGeneratedFiles(content: string, allowEmpty = false): GeneratedFile[] {
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
  if (!Array.isArray(parsed.files) || (!allowEmpty && parsed.files.length === 0)) throw new Error('The model returned no generated files.')
  if (parsed.files.some((file) => !file || typeof file.path !== 'string' || typeof file.content !== 'string')) {
    throw new Error('The model returned an invalid file structure.')
  }
  return parsed.files
}

function generationStages(): GenerationStage[] {
  return [
    {
      name: 'project foundation',
      instructions: 'Generate pom.xml and src/main/resources/application.properties. Use Spring Boot 3.3.5, Java 17, Maven, Spring Web, Spring Data JPA, and H2. Do not generate Java source files in this stage. These files must be complete and usable by all later stages.',
    },
    {
      name: 'folder structure',
      instructions: 'Create the clean Maven folder structure after foundation. Return an empty files array because the Electron writer creates folders deterministically: src/main/java/com/generated/model, src/main/java/com/generated/repository, src/main/java/com/generated/service, src/main/java/com/generated/controller, src/main/resources, and src/test/java/com/generated. Do not generate source files in this stage.',
      allowEmpty: true,
    },
    {
      name: 'models and repositories',
      instructions: 'Generate every JPA entity/model class and every Spring Data repository interface required by the graph. Put models in src/main/java/com/generated/model and repositories in src/main/java/com/generated/repository. Do not generate services, controllers, or the application class in this stage. Do not omit a model or repository implied by any graph node.',
    },
    {
      name: 'service layer',
      instructions: 'Generate every required service class in src/main/java/com/generated/service. Services must use the repository/model types from the previous context and contain real callable methods for the requested flow. Do not generate controllers or the application class in this stage.',
    },
    {
      name: 'controller layer',
      instructions: 'Generate every required REST controller in src/main/java/com/generated/controller. Implement every API definition from the graph with valid Spring mappings and connect controllers to the generated services. Do not generate the application class in this stage.',
    },
    {
      name: 'application entry point',
      instructions: 'Generate only src/main/java/com/generated/Demo.java with package com.generated, a public class Demo, and a valid @SpringBootApplication main method. Do not generate any other file.',
    },
  ]
}

function stageContext(files: GeneratedFile[]): string {
  if (!files.length) return 'No files have been generated yet.'
  return files.map((file) => `FILE: ${file.path}\n${file.content}`).join('\n\n').slice(-60_000)
}

function buildStagePrompt(stage: GenerationStage, graph: GenerationGraph, files: GeneratedFile[]): string {
  return `You are generating one stage of a Spring Boot project. This is a fresh context window: do not assume any earlier chat messages.

Stage: ${stage.name}
${stage.instructions}

Project contract:
- Use package com.generated for Java source.
- Use Java 17 syntax and compile-safe Spring Boot code.
- Preserve names and API paths from the visual graph.
- Return exactly one valid JSON object: {"files":[{"path":"relative/path","content":"file contents"}]}.
- Return only files for this stage. Never return markdown fences, explanations, or text outside the JSON object.
- Paths must be relative and use forward slashes.

Visual graph:
${JSON.stringify(graph, null, 2)}

Files already generated for context:
${stageContext(files)}`
}

async function generateStage(modelId: ModelId, stage: GenerationStage, graph: GenerationGraph, files: GeneratedFile[], onProgress: (progress: GenerationProgress) => void): Promise<GeneratedFile[]> {
  const prompt = buildStagePrompt(stage, graph, files)
  let response = ''
  try {
    response = await streamGeneration(modelId, [{ role: 'user', content: prompt }], onProgress)
    return parseGeneratedFiles(response, stage.allowEmpty)
  } catch (cause) {
    onProgress({ phase: 'generating', percent: 20, status: `Repairing ${stage.name} response…` })
    const repairPrompt = `Return only valid JSON in this exact shape: {"files":[{"path":"relative/path","content":"file contents"}]}. Repair the following response for the ${stage.name} stage. Do not add explanations or markdown.\n\n${response || (cause instanceof Error ? cause.message : 'The response was empty.')}`
    const repaired = await streamGeneration(modelId, [{ role: 'user', content: repairPrompt }], onProgress)
    return parseGeneratedFiles(repaired, stage.allowEmpty)
  }
}

async function writeGeneratedFiles(projectPath: string, files: GeneratedFile[]): Promise<void> {
  for (const file of files) {
    const destination = path.join(projectPath, ...file.path.split('/'))
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, file.content, 'utf8')
  }
}

async function createProjectStructure(projectPath: string): Promise<void> {
  const folders = [
    'src/main/java/com/generated/model',
    'src/main/java/com/generated/repository',
    'src/main/java/com/generated/service',
    'src/main/java/com/generated/controller',
    'src/main/resources',
    'src/test/java/com/generated',
  ]
  await Promise.all(folders.map((folder) => fs.mkdir(path.join(projectPath, folder), { recursive: true })))
}

async function compileGeneratedProject(projectPath: string): Promise<{ success: boolean; available: boolean; output: string }> {
  const commands = process.platform === 'win32'
    ? [{ executable: 'cmd.exe', args: ['/d', '/s', '/c', 'mvn.cmd -q -DskipTests compile'], label: 'mvn.cmd' }]
    : [{ executable: 'mvn', args: ['-q', '-DskipTests', 'compile'], label: 'mvn' }]
  let lastError = 'Maven was not found.'
  for (const command of commands) {
    try {
      const result = await execFileAsync(command.executable, command.args, { cwd: projectPath, timeout: 180_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
      return { success: true, available: true, output: `${result.stdout}\n${result.stderr}`.trim() }
    } catch (cause) {
      const error = cause as { code?: string | number; stdout?: string; stderr?: string; message?: string }
      if (error.code === 'ENOENT') {
        lastError = `${command.label} was not found.`
        continue
      }
      const output = `${error.stdout ?? ''}\n${error.stderr ?? error.message ?? 'Maven compilation failed.'}`.trim()
      if (/not recognized|could not find|not found/i.test(output)) return { success: false, available: false, output: `${command.label} was not found.` }
      return { success: false, available: true, output }
    }
  }
  return { success: false, available: false, output: lastError }
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
  const projectPath = path.join('C:', 'projects', safeName)
  await fs.mkdir(projectPath, { recursive: true })
  const sendProgress = (progress: GenerationProgress) => {
    if (!window.isDestroyed()) window.webContents.send('project:generation-progress', progress)
  }
  sendProgress({ phase: 'preparing', percent: 5, status: 'Preparing segmented Java project generation…' })
  const files: GeneratedFile[] = []
  const stages = generationStages()
  for (const [index, stage] of stages.entries()) {
    const startPercent = 10 + Math.round((index / stages.length) * 65)
    sendProgress({ phase: 'generating', percent: startPercent, status: `Generating ${stage.name} in a fresh context…` })
    const stageFiles = await generateStage(modelId, stage, graph, files, sendProgress)
    if (stage.name === 'folder structure') await createProjectStructure(projectPath)
    for (const file of stageFiles) {
      const existingIndex = files.findIndex((existing) => existing.path === file.path)
      if (existingIndex >= 0) files[existingIndex] = file
      else files.push(file)
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
  sendProgress({ phase: 'writing', percent: 78, status: `Writing ${safeFiles.length} generated files…`, totalFiles: safeFiles.length, filesWritten: 0 })
  await writeGeneratedFiles(projectPath, safeFiles)
  sendProgress({ phase: 'writing', percent: 84, status: 'Compiling generated Java sources…', totalFiles: safeFiles.length, filesWritten: safeFiles.length })
  let compilation = await compileGeneratedProject(projectPath)
  if (!compilation.success && compilation.available) {
    sendProgress({ phase: 'generating', percent: 86, status: 'Repairing generated code from compiler diagnostics…' })
    const repairStage: GenerationStage = {
      name: 'compiler repair',
      instructions: `Fix the existing generated project so Maven compilation succeeds. Return only files that must change. Compiler output:\n${compilation.output}`,
    }
    const repairFiles = await generateStage(modelId, repairStage, graph, safeFiles, sendProgress)
    for (const file of repairFiles) {
      const existingIndex = safeFiles.findIndex((existing) => existing.path === file.path)
      if (existingIndex >= 0) safeFiles[existingIndex] = file
      else safeFiles.push(file)
    }
    await writeGeneratedFiles(projectPath, safeFiles)
    compilation = await compileGeneratedProject(projectPath)
  }
  if (!compilation.success && compilation.available) {
    throw new Error(`Generated project did not compile. ${compilation.output.slice(-4000)}`)
  }
  const editor = await openInVsCode(projectPath)
  const compilerMessage = compilation.available ? undefined : 'Maven was not found, so compilation could not be verified. Install Maven and run mvn compile in the generated project.'
  sendProgress({ phase: 'complete', percent: 100, status: compilerMessage ? 'Project generated; Maven compilation was not available.' : 'Project generated, compiled, and ready in VS Code.', totalFiles: safeFiles.length, filesWritten: safeFiles.length })
  return { projectPath, files: safeFiles, editorOpened: editor.opened, editorMessage: [editor.message, compilerMessage].filter(Boolean).join(' ') || undefined }
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
