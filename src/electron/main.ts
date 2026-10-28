import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { ensureOllamaRunning, getInstalledModels, modelForTag, ollamaApiUrl, registerOllamaOnboardingHandlers, type ModelId } from './n2c-e-user-onboarding/n2c-e-user-onboarding-main.js'
import { isSpringProjectPath, validateSpringStructure, type SpringDependency, type SpringStructureManifest, type SpringStructurePreview } from './n2c-e-gen-spring-structure/n2c-e-gen-spring-structure-main.js'
import { springBootProjectType } from './n2c-e-gen-spring/n2c-e-gen-spring-project-type.js'
const electronDirectory = path.dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
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
    apiContracts?: Array<{ method: string; path: string; description: string; requestBody?: string; responseType?: string; pathParams?: string[]; queryParams?: string[] }>
    entityFields?: Array<{ name: string; type: string; constraints?: string[]; relationship?: { type: string; target: string; mappedBy?: string } }>
    serviceMethods?: Array<{ name: string; description: string; params?: string; returnType?: string; dependencies?: string[] }>
    configEntries?: Array<{ key: string; value?: string; description?: string }>
    packagePath?: string
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


async function chatWithModel(modelId: ModelId, messages: ChatMessage[], format?: 'json'): Promise<ChatResult> {
  await ensureOllamaRunning()
  const model = modelForTag(modelId)
  const installedModels = await getInstalledModels()
  if (!installedModels.includes(model.tag)) throw new Error(`The selected model "${model.tag}" is not installed in Ollama. Download it from the model switcher first.`)
  let response: Response
  try {
    response = await fetch(`${ollamaApiUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.tag,
        messages,
        stream: false,
        think: false,
        options: { temperature: 0.1, num_ctx: 32768, num_predict: 16000 },
        ...(format ? { format } : {}),
        keep_alive: 0,
      }),
    })
  } catch (cause) {
    throw new Error(`Could not connect to Ollama while using ${model.tag}. Restart Ollama and try again. ${cause instanceof Error ? cause.message : ''}`, { cause })
  }

  if (!response.ok) {
    const detail = await response.text()
    if (/cuda|shared object initialization|llama-server process has terminated/i.test(detail)) {
      response = await fetch(`${ollamaApiUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.tag,
          messages,
          stream: false,
          think: false,
          options: { temperature: 0.1, num_ctx: 32768, num_predict: 16000, num_gpu: 0 },
          ...(format ? { format } : {}),
          keep_alive: 0,
        }),
      })
      if (!response.ok) {
        const cpuDetail = await response.text()
        throw new Error(`Ollama could not answer with ${model.tag} using GPU or CPU fallback (${response.status}). ${cpuDetail || detail}`)
      }
    } else {
      throw new Error(`Ollama could not answer with ${model.tag} (${response.status}). ${detail || 'The model may be unavailable or still loading.'}`)
    }
  }

  const result = (await response.json()) as { message?: ChatMessage }
  if (!result.message?.content) {
    throw new Error('Ollama returned an empty response.')
  }
  return { message: result.message }
}

/**
 * Stream raw text from Ollama for single-file generation.
 * Does NOT use format:"json" — the model returns plain Java/text.
 * num_predict: 4096 is enough for one class, and prevents the token-repeat abort.
 */
async function streamRawContent(
  modelId: ModelId,
  messages: ChatMessage[],
  onProgress: (progress: GenerationProgress) => void,
  progressLabel: string,
  progressPercent: number,
): Promise<string> {
  await ensureOllamaRunning()
  const model = modelForTag(modelId)
  const installedModels = await getInstalledModels()
  if (!installedModels.includes(model.tag)) throw new Error(`The selected model "${model.tag}" is not installed in Ollama.`)
  const ollamaBody = { model: model.tag, messages, stream: true, think: false, keep_alive: 0, options: { temperature: 0.15, num_ctx: 16384, num_predict: 4096, repeat_penalty: 1.1 } }
  let response: Response
  try {
    response = await fetch(`${ollamaApiUrl}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ollamaBody) })
  } catch (cause) {
    throw new Error(`Could not connect to Ollama. ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
  if (!response.ok) {
    const detail = await response.text()
    if (/cuda|shared object|llama-server/i.test(detail)) {
      // CPU fallback
      response = await fetch(`${ollamaApiUrl}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ollamaBody, options: { ...ollamaBody.options, num_gpu: 0 } }) })
      if (!response.ok) throw new Error(`Ollama CPU fallback failed (${response.status}).`)
    } else {
      throw new Error(`Ollama request failed (${response.status}): ${detail}`)
    }
  }
  if (!response.body) throw new Error('Ollama returned no response body.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  onProgress({ phase: 'generating', percent: progressPercent, status: progressLabel })
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const line of parts) {
      if (!line.trim()) continue
      try {
        const item = JSON.parse(line) as { message?: { content?: string }; response?: string; error?: string; done?: boolean }
        if (item.error) throw new Error(`Ollama error: ${item.error}`)
        content += item.message?.content ?? item.response ?? ''
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Ollama error:')) throw err
      }
    }
  }
  if (buffer.trim()) {
    try {
      const item = JSON.parse(buffer) as { message?: { content?: string }; response?: string; error?: string }
      if (item.error) throw new Error(`Ollama error: ${item.error}`)
      content += item.message?.content ?? item.response ?? ''
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Ollama error:')) throw err
    }
  }
  if (!content.trim()) throw new Error(`Ollama returned empty content for: ${progressLabel}`)
  return content
}

/**
 * Stream JSON-formatted batch generation from Ollama.
 * Used only for config stage and repair fallback (when per-node is not applicable).
 * num_predict: 8192 — larger budget for batch JSON but still capped.
 */
async function streamJsonGeneration(
  modelId: ModelId,
  messages: ChatMessage[],
  onProgress: (progress: GenerationProgress) => void,
  progressRange: { start: number; end: number },
): Promise<string> {
  await ensureOllamaRunning()
  const model = modelForTag(modelId)
  const installedModels = await getInstalledModels()
  if (!installedModels.includes(model.tag)) throw new Error(`The selected model "${model.tag}" is not installed in Ollama.`)
  const ollamaBody = { model: model.tag, messages, stream: true, format: 'json', think: false, keep_alive: 0, options: { temperature: 0.1, num_ctx: 16384, num_predict: 8192, repeat_penalty: 1.1 } }
  let response: Response
  try {
    response = await fetch(`${ollamaApiUrl}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ollamaBody) })
  } catch (cause) {
    throw new Error(`Could not connect to Ollama. ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
  if (!response.ok) {
    const detail = await response.text()
    if (/cuda|shared object|llama-server/i.test(detail)) {
      response = await fetch(`${ollamaApiUrl}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ollamaBody, options: { ...ollamaBody.options, num_gpu: 0 } }) })
      if (!response.ok) throw new Error(`Ollama CPU fallback failed (${response.status}).`)
    } else {
      throw new Error(`Ollama request failed (${response.status}): ${detail}`)
    }
  }
  if (!response.body) throw new Error('Ollama returned no response body.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const line of parts) {
      if (!line.trim()) continue
      try {
        const item = JSON.parse(line) as { message?: { content?: string }; response?: string; error?: string }
        if (item.error) throw new Error(`Ollama error: ${item.error}`)
        content += item.message?.content ?? item.response ?? ''
        const pct = progressRange.start + Math.min(progressRange.end - progressRange.start - 1, Math.round(content.length / 300))
        onProgress({ phase: 'generating', percent: pct, status: 'Generating from model...' })
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Ollama error:')) throw err
      }
    }
  }
  if (buffer.trim()) {
    try {
      const item = JSON.parse(buffer) as { message?: { content?: string }; response?: string; error?: string }
      if (item.error) throw new Error(`Ollama error: ${item.error}`)
      content += item.message?.content ?? item.response ?? ''
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Ollama error:')) throw err
    }
  }
  if (!content.trim()) throw new Error('Ollama returned an empty generation response.')
  return content
}

function registerChatHandler(): void {
  ipcMain.handle('ollama:chat', (_event, modelId: ModelId, messages: ChatMessage[]) => {
    modelForTag(modelId)
    if (!Array.isArray(messages) || messages.some((message) => (
      !message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string'
    ))) {
      throw new Error('Invalid chat messages.')
    }
    return chatWithModel(modelId, messages)
  })
}

function sanitizeProjectName(value: string): string {
  const sanitized = value.trim().replace(/[<>:"/\\\\|?*]/g, '-').replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
  if (!sanitized || sanitized === '.' || sanitized === '..') return 'spring-boot-app'
  return sanitized.slice(0, 80)
}

function repairPomDependencyTags(content: string): string {
  const dependenciesStart = content.indexOf('<dependencies>')
  const dependenciesEnd = content.indexOf('</dependencies>')
  if (dependenciesStart < 0 || dependenciesEnd <= dependenciesStart) return content
  const before = content.slice(0, dependenciesStart + '<dependencies>'.length)
  const body = content.slice(dependenciesStart + '<dependencies>'.length, dependenciesEnd)
  const after = content.slice(dependenciesEnd)
  const repairedBody = body.replace(/<groupId>[\s\S]*?<\/groupId>\s*<artifactId>[\s\S]*?<\/artifactId>[\s\S]*?<\/dependency>/g, (dependencyBlock, offset: number) => {
    const preceding = body.slice(0, offset).trimEnd()
    return preceding.endsWith('<dependency>') ? dependencyBlock : `<dependency>\n        ${dependencyBlock.trim()}`
  })
  return `${before}${repairedBody}${after}`
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
  return parsed.files.map((file) => file.path.replace(/\\/g, '/') === 'pom.xml'
    ? { ...file, content: repairPomDependencyTags(file.content) }
    : file)
}

// ── File I/O helpers ─────────────────────────────────────────────────────────

async function writeGeneratedFiles(projectPath: string, files: GeneratedFile[]): Promise<void> {
  for (const file of files) {
    const destination = path.join(projectPath, ...file.path.split('/'))
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, file.content, 'utf8')
  }
}

async function collectProjectFiles(projectPath: string, current = ''): Promise<GeneratedFile[]> {
  const entries = await fs.readdir(path.join(projectPath, current), { withFileTypes: true })
  const files: GeneratedFile[] = []
  for (const entry of entries) {
    const relativePath = current ? `${current}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...await collectProjectFiles(projectPath, relativePath))
    else files.push({ path: relativePath, content: await fs.readFile(path.join(projectPath, relativePath), 'utf8') })
  }
  return files
}

async function collectProjectDirectories(projectPath: string, current = ''): Promise<string[]> {
  const entries = await fs.readdir(path.join(projectPath, current), { withFileTypes: true })
  const directories: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const relativePath = current ? `${current}/${entry.name}` : entry.name
    directories.push(relativePath, ...await collectProjectDirectories(projectPath, relativePath))
  }
  return directories
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
    candidates.unshift(...stdout.split(/\r?\n/).map((v) => v.trim()).filter(Boolean))
  } catch {
    // Fall back to standard installation paths.
  }
  for (const candidate of [...new Set(candidates)]) {
    try { await fs.access(candidate); return candidate } catch { continue }
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
        const proc = spawn(executable, [projectPath], { detached: true, windowsHide: true, stdio: 'ignore' })
        proc.once('error', reject)
        proc.once('spawn', () => { proc.unref(); resolve() })
      })
    } catch (executableCause) {
      if (!command.toLowerCase().endsWith('.cmd')) throw executableCause
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('cmd.exe', ['/d', '/c', 'call', command, projectPath], { detached: true, windowsHide: true, stdio: 'ignore' })
        proc.once('error', reject)
        proc.once('spawn', () => { proc.unref(); resolve() })
      })
    }
    return { opened: true }
  } catch (cause) {
    return { opened: false, message: `VS Code could not be opened: ${cause instanceof Error ? cause.message : 'unknown launch error'}` }
  }
}

// ─── Per-node segmented generation engine ────────────────────────────────────

/**
 * Generate a single file for one NodeGenerationJob.
 * Makes ONE focused LLM call returning raw Java/text content.
 * Retries once with a simplified prompt if the first attempt fails validation.
 */
async function generateOneNode(
  modelId: ModelId,
  job: import('./n2c-e-gen-core/n2c-e-gen-project-type.js').NodeGenerationJob,
  graph: GenerationGraph,
  files: GeneratedFile[],
  config: { name: string; packageName: string; dependencies: Array<{ groupId: string; artifactId: string; version?: string; scope?: string }> },
  onProgress: (p: GenerationProgress) => void,
  progressPercent: number,
): Promise<GeneratedFile | null> {
  const prompt = springBootProjectType.buildNodePrompt(job, graph, files, config)
  const maxAttempts = 2
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const raw = await streamRawContent(
        modelId,
        [{ role: 'user', content: attempt === 0 ? prompt : `${prompt}\n\nIMPORTANT: Output ONLY the Java source code for ${job.targetPath.split('/').pop()}. Start with "package ".` }],
        onProgress,
        job.progressLabel,
        progressPercent,
      )
      return springBootProjectType.parseNodeResponse(raw, job)
    } catch (cause) {
      if (attempt === maxAttempts - 1) {
        console.warn(`[n2c] Skipping ${job.targetPath}: ${cause instanceof Error ? cause.message : String(cause)}`)
        return null
      }
      // Attempt 2: try without context
    }
  }
  return null
}

/**
 * Generate a full config stage using the batch JSON approach (small output, allowEmpty).
 */
async function generateConfigStage(
  modelId: ModelId,
  graph: GenerationGraph,
  config: { name: string; packageName: string; dependencies: Array<{ groupId: string; artifactId: string; version?: string; scope?: string }> },
  onProgress: (p: GenerationProgress) => void,
  progressRange: { start: number; end: number },
): Promise<GeneratedFile[]> {
  const stage = springBootProjectType.generationStages()[0]  // config stage
  const prompt = springBootProjectType.buildStageFallbackPrompt(stage, graph, config)
  try {
    const raw = await streamJsonGeneration(modelId, [{ role: 'user', content: prompt }], onProgress, progressRange)
    return parseGeneratedFiles(raw, true)
  } catch {
    return []  // config stage is optional
  }
}

/**
 * Main per-node generation loop.
 * For each stage, decomposes it into jobs and calls generateOneNode per job.
 * Progress is updated per-file so the UI shows smooth granular progress.
 */
async function generateProject(
  modelId: ModelId,
  projectName: string,
  graph: GenerationGraph,
  projectPath: string,
  structure: SpringStructureManifest,
  window: BrowserWindow,
): Promise<GenerationResult> {
  modelForTag(modelId)
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Invalid project graph.')
  if (!isSpringProjectPath(projectPath)) throw new Error('Invalid prepared Spring project path.')
  const sendProgress = (p: GenerationProgress) => { if (!window.isDestroyed()) window.webContents.send('project:generation-progress', p) }
  sendProgress({ phase: 'preparing', percent: 5, status: 'Starting per-node segmented generation...' })

  const validatedStructure = validateSpringStructure(structure)
  const config = { name: projectName, packageName: validatedStructure.packageName, dependencies: validatedStructure.dependencies }

  // Pre-warm Spring Boot version cache
  await springBootProjectType.resolvedVersion()

  // Collect Initializr scaffold files
  const starterFiles = await collectProjectFiles(projectPath)
  const protectedPaths = new Set(springBootProjectType.protectedPaths())
  const starterPaths = new Set(starterFiles.map(f => f.path))

  // Accumulated files: start with structure files + scaffold
  const allFiles: GeneratedFile[] = [...validatedStructure.files, ...starterFiles]

  // Build full job list across all stages
  const stages = springBootProjectType.generationStages()
  const allJobs: Array<{ stageIdx: number; stageName: string; job: import('./n2c-e-gen-core/n2c-e-gen-project-type.js').NodeGenerationJob }> = []
  for (const [i, stage] of stages.entries()) {
    if (stage.name === 'application config') continue  // handled separately
    const jobs = springBootProjectType.buildNodeJobs(stage, graph, config)
    for (const job of jobs) allJobs.push({ stageIdx: i, stageName: stage.name, job })
  }

  // Estimate total progress: 10% prepare + 65% generation + 10% config + 15% write+compile
  const totalJobs = allJobs.length || 1

  // Phase 1: config stage (batch, small)
  sendProgress({ phase: 'generating', percent: 10, status: 'Generating application config...' })
  const configFiles = await generateConfigStage(modelId, graph, config, sendProgress, { start: 10, end: 18 })
  for (const f of configFiles) {
    if (!protectedPaths.has(f.path) && !starterPaths.has(f.path)) {
      const idx = allFiles.findIndex(e => e.path === f.path)
      if (idx >= 0) allFiles[idx] = f; else allFiles.push(f)
    }
  }

  // Phase 2: per-node generation
  const generatedFiles: GeneratedFile[] = []
  for (const [jobIdx, { stageName, job }] of allJobs.entries()) {
    const percent = 18 + Math.round((jobIdx / totalJobs) * 57)  // 18% to 75%
    sendProgress({ phase: 'generating', percent, status: `[${jobIdx + 1}/${totalJobs}] ${job.progressLabel}` })
    // Send stage-level event for the IDE progress panel
    if (!window.isDestroyed()) {
      window.webContents.send('project:stage-progress', {
        stageName,
        stageFile: job.targetPath.split('/').pop(),
        jobIndex: jobIdx,
        totalJobs,
      })
    }
    const file = await generateOneNode(modelId, job, graph, allFiles, config, sendProgress, percent)
    if (file) {
      generatedFiles.push(file)
      // Add to context immediately so next jobs can reference this class
      const idx = allFiles.findIndex(e => e.path === file.path)
      if (idx >= 0) allFiles[idx] = file; else allFiles.push(file)
    }
  }

  // Phase 3: validate and sanitise all file paths
  sendProgress({ phase: 'writing', percent: 76, status: 'Writing generated files to disk...' })
  const safeFiles: GeneratedFile[] = []
  const seenPaths = new Set<string>()
  const allToWrite = [...configFiles, ...generatedFiles]
  for (const file of allToWrite) {
    const relativePath = file.path.replace(/\\\\/g, '/')
    if (!relativePath) continue
    if (path.posix.isAbsolute(relativePath) || relativePath.split('/').includes('..') || relativePath.includes(':')) {
      console.warn(`[n2c] Skipping unsafe path: ${relativePath}`); continue
    }
    if (protectedPaths.has(relativePath) || [...protectedPaths].some(p => p.endsWith('/') && relativePath.startsWith(p))) continue
    if (starterPaths.has(relativePath)) continue
    if (seenPaths.has(relativePath)) continue
    seenPaths.add(relativePath)
    const dest = path.join(projectPath, ...relativePath.split('/'))
    if (!dest.toLowerCase().startsWith(`${projectPath.toLowerCase()}${path.sep}`)) {
      console.warn(`[n2c] Skipping path that escapes project root: ${relativePath}`); continue
    }
    safeFiles.push({ path: relativePath, content: file.content })
  }

  await writeGeneratedFiles(projectPath, safeFiles)

  // Persist node structure inside the generated project
  try {
    const metaDir = path.join(projectPath, '.nodetocode')
    await fs.mkdir(metaDir, { recursive: true })
    const structureManifest = {
      projectName,
      packageName: validatedStructure.packageName,
      generatedAt: new Date().toISOString(),
      nodes: graph.nodes,
      edges: graph.edges,
      dependencies: validatedStructure.dependencies,
    }
    await fs.writeFile(path.join(metaDir, 'graph.json'), JSON.stringify(structureManifest, null, 2), 'utf8')
    await fs.writeFile(path.join(projectPath, 'node-structure.json'), JSON.stringify(structureManifest, null, 2), 'utf8')
  } catch (err) {
    console.warn('[n2c] Failed to save node-structure.json:', err)
  }

  sendProgress({ phase: 'writing', percent: 95, status: `Wrote ${safeFiles.length} files to disk.`, totalFiles: safeFiles.length, filesWritten: safeFiles.length })

  // Phase 4: Compilation and repair phase is skipped for now per configuration.
  // All generated files are retained and kept on disk regardless of compilation status.
  const editor = await openInVsCode(projectPath)
  sendProgress({
    phase: 'complete',
    percent: 100,
    status: `Project generated: ${safeFiles.length} files ready.`,
    totalFiles: safeFiles.length,
    filesWritten: safeFiles.length,
  })
  return {
    projectPath,
    files: safeFiles,
    editorOpened: editor.opened,
    editorMessage: editor.message,
  }
}

function registerGenerationHandler(): void {
  ipcMain.handle('project:prepare', async (event, projectName: string, dependencies: SpringDependency[]): Promise<SpringStructurePreview> => {
    if (!Array.isArray(dependencies) || dependencies.some((dependency) => !dependency || typeof dependency.groupId !== 'string' || typeof dependency.artifactId !== 'string')) {
      throw new Error('Invalid Spring Initializr dependencies.')
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('The application window is unavailable.')
    const sendProgress = (progress: GenerationProgress) => {
      if (!window.isDestroyed()) window.webContents.send('project:generation-progress', progress)
    }
    const safeName = sanitizeProjectName(projectName)
    const packageName = `com.nodetocode.${safeName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'app'}`
    const structure = validateSpringStructure({ packageName, directories: [], files: [], dependencies })
    sendProgress({ phase: 'preparing', percent: 20, status: 'Downloading the Spring Initializr starter...' })
    const projectConfig = { name: safeName, packageName: structure.packageName, dependencies: structure.dependencies }
    await springBootProjectType.initializeProject(path.join('C:', 'nodetocode', 'projects', safeName), projectConfig)
    const projectPath = path.join('C:', 'nodetocode', 'projects', safeName)
    const directories = await collectProjectDirectories(projectPath)
    sendProgress({ phase: 'preparing', percent: 100, status: 'Folder structure ready for review.' })
    return { ...structure, directories, projectPath }
  })
  ipcMain.handle('project:generate', (event, modelId: ModelId, projectName: string, graph: GenerationGraph, projectPath: string, structure: SpringStructureManifest) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('The application window is unavailable.')
    return generateProject(modelId, projectName, graph, projectPath, structure, window)
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
  ipcMain.handle('project:load-graph', async (_event, projectPath: string) => {
    if (!path.isAbsolute(projectPath)) throw new Error('Invalid project path.')
    const filePath = path.join(projectPath, 'node-structure.json')
    try {
      const data = await fs.readFile(filePath, 'utf8')
      return JSON.parse(data)
    } catch {
      return null
    }
  })
  ipcMain.handle('project:compile', async (_event, projectPath: string) => {
    if (!path.isAbsolute(projectPath)) throw new Error('Invalid project path.')
    const compilation = await springBootProjectType.compileProject(projectPath)
    const diagnostics = springBootProjectType.parseBuildDiagnostics(compilation.output)
    return {
      success: compilation.success,
      available: compilation.available,
      diagnostics: diagnostics.map(d => ({ file: d.file, line: d.line, message: d.message, severity: 'error' as const })),
      rawOutput: compilation.output,
    }
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
