import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { ensureOllamaRunning, getInstalledModels, modelForTag, ollamaApiUrl, registerOllamaOnboardingHandlers, type ModelId } from './n2c-e-user-onboarding/n2c-e-user-onboarding-main.js'
import { isSpringProjectPath, validateSpringStructure, type SpringDependency, type SpringStructureManifest, type SpringStructurePreview } from './n2c-e-gen-spring-structure/n2c-e-gen-spring-structure-main.js'
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

const springBootMetadataUrl = 'https://repo1.maven.org/maven2/org/springframework/boot/spring-boot-starter-parent/maven-metadata.xml'
const fallbackSpringBootVersion = '4.1.1'
const springInitializerUrl = 'https://start.spring.io/starter.zip'
const initializerDependencyIds: Record<string, string> = {
  'org.springframework.boot:spring-boot-starter-web': 'web',
  'org.springframework.boot:spring-boot-starter-webflux': 'webflux',
  'org.springframework.boot:spring-boot-starter-data-jpa': 'data-jpa',
  'org.springframework.boot:spring-boot-starter-validation': 'validation',
  'org.springframework.boot:spring-boot-starter-security': 'security',
  'org.springframework.boot:spring-boot-starter-test': 'test',
  'org.projectlombok:lombok': 'lombok',
  'com.h2database:h2': 'h2',
  'org.postgresql:postgresql': 'postgresql',
  'com.mysql:mysql-connector-j': 'mysql',
  'org.springframework.boot:spring-boot-starter-actuator': 'actuator',
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if ((leftParts[index] ?? 0) !== (rightParts[index] ?? 0)) return (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
  }

  return 0
}

function initializerDependencyIdsFor(structure: SpringStructureManifest): string[] {
  return [...new Set(structure.dependencies
    .map((dependency) => initializerDependencyIds[`${dependency.groupId}:${dependency.artifactId}`])
    .filter((id): id is string => Boolean(id)))]
}

async function initializeWithSpringInitializer(projectPath: string, projectName: string, structure: SpringStructureManifest, springBootVersion: string): Promise<void> {
  const dependencies = initializerDependencyIdsFor(structure)
  const params = new URLSearchParams({
    type: 'maven-project',
    language: 'java',
    bootVersion: springBootVersion,
    baseDir: projectName,
    groupId: structure.packageName,
    artifactId: projectName,
    name: projectName,
    packageName: structure.packageName,
    javaVersion: '21',
    dependencies: dependencies.join(','),
  })
  let response: Response
  try {
    response = await fetch(`${springInitializerUrl}?${params.toString()}`)
  } catch (cause) {
    throw new Error(`Spring Initializr could not be reached. Check your internet connection and try again. ${cause instanceof Error ? cause.message : ''}`, { cause })
  }
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Spring Initializr rejected the starter request (${response.status}). ${detail || 'Check the selected dependencies.'}`)
  }
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'node-to-code-initializr-'))
  const archivePath = path.join(tempRoot, 'starter.zip')
  const extractPath = path.join(tempRoot, 'extracted')
  try {
    const archive = Buffer.from(await response.arrayBuffer())
    if (archive.length < 4 || archive[0] !== 0x50 || archive[1] !== 0x4b) {
      throw new Error('Spring Initializr returned an invalid starter archive. Please try again.')
    }
    await fs.writeFile(archivePath, archive)
    await fs.mkdir(extractPath, { recursive: true })
    const extractionScript = '& { param([string] $archivePath, [string] $destinationPath); Expand-Archive -LiteralPath $archivePath -DestinationPath $destinationPath -Force }'
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', extractionScript, archivePath, extractPath], { windowsHide: true })
    const starterRoot = path.join(extractPath, projectName)
    try {
      await fs.access(starterRoot)
    } catch (cause) {
      throw new Error(`Spring Initializr returned a starter with an unexpected layout. Expected "${projectName}" in the archive.`, { cause })
    }
    await fs.rm(projectPath, { recursive: true, force: true })
    await fs.mkdir(path.dirname(projectPath), { recursive: true })
    await fs.cp(starterRoot, projectPath, { recursive: true })
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
}

async function latestStableSpringBootVersion(): Promise<string> {
  try {
    const response = await fetch(springBootMetadataUrl)
    if (!response.ok) throw new Error(`Maven metadata request failed with status ${response.status}.`)
    const metadata = await response.text()
    const versions = [...metadata.matchAll(/<version>(\d+\.\d+\.\d+)<\/version>/g)].map((match) => match[1])
    return versions.sort(compareVersions).at(-1) ?? fallbackSpringBootVersion
  } catch (cause) {
    console.warn(`Could not resolve the latest Spring Boot release: ${cause instanceof Error ? cause.message : 'unknown error'}`)
    return fallbackSpringBootVersion
  }
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

async function streamGeneration(modelId: ModelId, messages: ChatMessage[], onProgress: (progress: GenerationProgress) => void, progressRange: { start: number; end: number }): Promise<string> {
  await ensureOllamaRunning()
  const model = modelForTag(modelId)
  const installedModels = await getInstalledModels()
  if (!installedModels.includes(model.tag)) throw new Error(`The selected model "${model.tag}" is not installed in Ollama. Download it from the model switcher first.`)
  let response: Response
  try {
    response = await fetch(`${ollamaApiUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.tag, messages, stream: true, format: 'json', think: false, keep_alive: 0, options: { temperature: 0.1, num_ctx: 32768, num_predict: 12000 } }),
    })
  } catch (cause) {
    throw new Error(`Could not connect to Ollama while generating with ${model.tag}. Restart Ollama and try again. ${cause instanceof Error ? cause.message : ''}`, { cause })
  }
  if (!response.ok) {
    const detail = await response.text()
    if (/cuda|shared object initialization|llama-server process has terminated/i.test(detail)) {
      response = await fetch(`${ollamaApiUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.tag, messages, stream: true, format: 'json', think: false, keep_alive: 0, options: { temperature: 0.1, num_ctx: 32768, num_predict: 12000, num_gpu: 0 } }),
      })
      if (!response.ok) {
        const cpuDetail = await response.text()
        throw new Error(`Ollama generation failed with ${model.tag} using GPU or CPU fallback (${response.status}). ${cpuDetail || detail}`)
      }
    } else {
      throw new Error(`Ollama generation failed with ${model.tag} (${response.status}). ${detail || 'The model may be unavailable or still loading.'}`)
    }
  }
  if (!response.body) throw new Error(`Ollama generation returned no response body for ${model.tag}.`)
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
      const progress = progressRange.start + Math.min(progressRange.end - progressRange.start - 1, Math.round(content.length / 500))
      onProgress({ phase: 'generating', percent: progress, status: 'Receiving generated files from the local model…' })
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
  const sanitized = value.trim().replace(/[<>:"/\\|?*]/g, '-').split('').filter((character) => character.charCodeAt(0) >= 32).join('').replace(/[. ]+$/g, '')
  if (!sanitized || sanitized === '.' || sanitized === '..') throw new Error('Project name must contain at least one valid character.')
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

function generationStages(): GenerationStage[] {
  return [
    {
      name: 'project foundation',
      instructions: 'Spring Initializr has already created pom.xml, Maven wrapper files, the application class, and the starter layout. Do not generate, replace, or modify pom.xml, Maven wrapper files, or the application class. Generate only graph-specific application configuration files that are missing from the Initializr starter.',
      allowEmpty: true,
    },
    {
      name: 'models and repositories',
      instructions: 'Generate the model/entity and repository/DAO files required by the graph, using the corresponding directories selected by the structure manifest. Do not generate services, controllers, or files already present in the structure manifest.',
    },
    {
      name: 'service layer',
      instructions: 'Generate the service files required by the graph in the service directory selected by the structure manifest. Services must use the generated model and repository types. Do not generate files already present in the structure manifest.',
    },
    {
      name: 'controller layer',
      instructions: 'Generate the REST controller files required by the graph in the controller directory selected by the structure manifest. Implement every API definition and connect controllers to generated services. Do not generate files already present in the structure manifest.',
    },
  ]
}

function stageContext(files: GeneratedFile[]): string {
  if (!files.length) return 'No files have been generated yet.'
  return files.map((file) => `FILE: ${file.path}\n${file.content}`).join('\n\n').slice(-60_000)
}

function buildContractSection(graph: GenerationGraph): string {
  const lines: string[] = []
  for (const node of graph.nodes) {
    if (!node.data) continue
    const parts: string[] = []
    if (node.data.entityFields?.length) {
      parts.push(`  Entity fields: ${node.data.entityFields.map(f => `${f.name}: ${f.type}${f.constraints?.length ? ` [${f.constraints.join(', ')}]` : ''}${f.relationship ? ` → ${f.relationship.type} ${f.relationship.target}` : ''}`).join('; ')}`)
    }
    if (node.data.apiContracts?.length) {
      parts.push(`  API contracts: ${node.data.apiContracts.map(a => `${a.method} ${a.path}${a.requestBody ? ` body:${a.requestBody}` : ''}${a.responseType ? ` → ${a.responseType}` : ''}`).join('; ')}`)
    }
    if (node.data.serviceMethods?.length) {
      parts.push(`  Service methods: ${node.data.serviceMethods.map(m => `${m.returnType ?? 'void'} ${m.name}(${m.params ?? ''}) — ${m.description}`).join('; ')}`)
    }
    if (node.data.configEntries?.length) {
      parts.push(`  Config: ${node.data.configEntries.map(c => `${c.key}=${c.value ?? '<required>'}`).join('; ')}`)
    }
    if (parts.length > 0) {
      lines.push(`Node "${node.data.label}" (${node.data.kind}):`)
      lines.push(...parts)
    }
  }
  if (lines.length === 0) return ''
  return `\n\nNode contracts (implement these exactly):\n${lines.join('\n')}`
}

function buildStagePrompt(stage: GenerationStage, graph: GenerationGraph, files: GeneratedFile[], structure: SpringStructureManifest, springBootVersion: string): string {
  const contractSection = buildContractSection(graph)
  return `You are generating one stage of a Spring Boot project. This is a fresh context window: do not assume any earlier chat messages.

Stage: ${stage.name}
${stage.instructions}

Project contract:
- Use the package and directories from the structure manifest. Do not invent a different project layout.
- Use the current stable Spring Boot release ${springBootVersion}. Use Java 21 syntax when this release requires it.
- Spring Initializr created the authoritative pom.xml and dependency versions. Never generate or replace pom.xml.
- Spring Initializr created the authoritative folder structure. Add files only inside directories already present or in directories required by the graph.
- Generate graph-specific code only under src/main/java or src/test. Do not create root-level files or replace Initializr files.
- Preserve names and API paths from the visual graph.
- When node contracts specify entity fields, use exactly those field names and types. When API contracts specify request/response types, implement them precisely.
- Return exactly one valid JSON object: {"files":[{"path":"relative/path","content":"file contents"}]}.
- Return only files for this stage. Never return markdown fences, explanations, or text outside the JSON object.
- Paths must be relative and use forward slashes.
${contractSection}

Visual graph:
${JSON.stringify(graph, null, 2)}

Complete structure manifest:
${JSON.stringify(structure, null, 2)}

Files already generated for context:
${stageContext(files)}`
}

async function generateStage(modelId: ModelId, stage: GenerationStage, graph: GenerationGraph, files: GeneratedFile[], onProgress: (progress: GenerationProgress) => void, progressRange: { start: number; end: number }, structure: SpringStructureManifest, springBootVersion: string): Promise<GeneratedFile[]> {
  const prompt = buildStagePrompt(stage, graph, files, structure, springBootVersion)
  let response = ''
  try {
    response = await streamGeneration(modelId, [{ role: 'user', content: prompt }], onProgress, progressRange)
    return parseGeneratedFiles(response, stage.allowEmpty)
  } catch (cause) {
    onProgress({ phase: 'generating', percent: progressRange.end - 1, status: `Repairing ${stage.name} response…` })
    const repairPrompt = `Return only valid JSON in this exact shape: {"files":[{"path":"relative/path","content":"file contents"}]}. Repair the following response for the ${stage.name} stage. Do not add explanations or markdown. Use Spring Boot ${springBootVersion}; do not add explicit versions for dependencies managed by its parent.\n\n${response || (cause instanceof Error ? cause.message : 'The response was empty.')}`
    const repaired = await streamGeneration(modelId, [{ role: 'user', content: repairPrompt }], onProgress, progressRange)
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

async function generateProject(modelId: ModelId, projectName: string, graph: GenerationGraph, projectPath: string, structure: SpringStructureManifest, window: BrowserWindow): Promise<GenerationResult> {
  modelForTag(modelId)
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Invalid project graph.')
  if (!isSpringProjectPath(projectPath)) throw new Error('Invalid prepared Spring project path.')
  const sendProgress = (progress: GenerationProgress) => {
    if (!window.isDestroyed()) window.webContents.send('project:generation-progress', progress)
  }
  sendProgress({ phase: 'preparing', percent: 5, status: 'Preparing segmented Java project generation…' })
  const validatedStructure = validateSpringStructure(structure)
  const files: GeneratedFile[] = [...validatedStructure.files]
  const stages = generationStages()
  const springBootVersion = await latestStableSpringBootVersion()
  const starterFiles = await collectProjectFiles(projectPath)
  files.push(...starterFiles)
  const starterPaths = new Set(starterFiles.map((file) => file.path))
  for (const [index, stage] of stages.entries()) {
    const startPercent = 10 + Math.round((index / stages.length) * 65)
    const endPercent = 10 + Math.round(((index + 1) / stages.length) * 65)
    sendProgress({ phase: 'generating', percent: startPercent, status: `Generating ${stage.name} in a fresh context…` })
    const stageFiles = (await generateStage(modelId, stage, graph, files, sendProgress, { start: startPercent, end: endPercent }, validatedStructure, springBootVersion))
      .filter((file) => !['pom.xml', 'mvnw', 'mvnw.cmd'].includes(file.path) && !file.path.startsWith('.mvn/'))
      .filter((file) => !starterPaths.has(file.path))
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
  sendProgress({ phase: 'writing', percent: 76, status: `Writing ${safeFiles.length} generated files…`, totalFiles: safeFiles.length, filesWritten: 0 })
  await writeGeneratedFiles(projectPath, safeFiles)
  sendProgress({ phase: 'writing', percent: 82, status: 'Compiling generated Java sources…', totalFiles: safeFiles.length, filesWritten: safeFiles.length })
  let compilation = await compileGeneratedProject(projectPath)
  if (!compilation.success && compilation.available) {
    sendProgress({ phase: 'generating', percent: 84, status: 'Repairing generated code from compiler diagnostics…' })
    const repairStage: GenerationStage = {
      name: 'compiler repair',
      instructions: `Fix the existing generated project so Maven compilation succeeds. Return only files that must change. Compiler output:\n${compilation.output}`,
    }
    const repairFiles = await generateStage(modelId, repairStage, graph, safeFiles, sendProgress, { start: 84, end: 96 }, validatedStructure, springBootVersion)
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
    const springBootVersion = await latestStableSpringBootVersion()
    sendProgress({ phase: 'preparing', percent: 20, status: 'Downloading the Spring Initializr starter…' })
    await initializeWithSpringInitializer(path.join('C:', 'nodetocode', 'projects', safeName), safeName, structure, springBootVersion)
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
