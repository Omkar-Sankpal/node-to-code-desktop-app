export type OnboardingStep = 'account' | 'ollama' | 'model' | 'complete' | 'dashboard'
export type ModelId = string

export interface SystemInfo {
  ramGb: number
  freeStorageGb: number
}

export interface OllamaStatus {
  installed: boolean
  running: boolean
  models: ModelId[]
  system: SystemInfo
}

export interface OllamaApi {
  getStatus: () => Promise<OllamaStatus>
  install: () => Promise<{ installed: boolean }>
  pullModel: (modelId: ModelId) => Promise<{ success: boolean; cancelled?: boolean; error?: string }>
  deleteModel: (modelId: ModelId) => Promise<{ success: boolean; error?: string }>
  getModelLibrary: () => Promise<OllamaModelOption[]>
  cancelSetup: () => Promise<boolean>
  openDownloadPage: () => Promise<void>
  onProgress: (callback: (progress: SetupProgress) => void) => () => void
  chat: (modelId: ModelId, messages: ChatMessage[]) => Promise<{ message: ChatMessage }>
  prepareProject: (projectName: string, dependencies: SpringDependency[]) => Promise<SpringStructurePreview>
  generateProject: (modelId: ModelId, projectName: string, graph: GenerationGraph, projectPath: string, structure: Omit<SpringStructurePreview, 'projectPath'>) => Promise<{ projectPath: string; files: GeneratedFile[]; editorOpened: boolean; editorMessage?: string }>
  onGenerationProgress: (callback: (progress: GenerationProgress) => void) => () => void
  openProjectFolder: (projectPath: string) => Promise<void>
  exportProjectZip: (projectPath: string) => Promise<string>
}

export interface OllamaModelOption {
  id: string
  name: string
  tag: string
  description: string
  minimumRamGb: number
  recommendedStorageGb: number
  installed: boolean
  available?: boolean
  unavailableReason?: string
}

export interface SpringStructurePreview {
  projectPath: string
  packageName: string
  files: Array<{ path: string; content: string }>
  directories: string[]
  dependencies: SpringDependency[]
}

export interface SpringDependency {
  groupId: string
  artifactId: string
  version?: string
  scope?: string
}

export interface GenerationGraph {
  nodes: Array<{
    id: string
    data?: {
      label?: string
      description?: string
      kind?: string
      apis?: Array<{ method: string; path: string; description: string }>
    }
  }>
  edges: Array<{ source: string; target: string }>
}

export interface GeneratedFile {
  path: string
  content: string
}

export interface GenerationProgress {
  phase: string
  percent: number
  status: string
  filesWritten?: number
  totalFiles?: number
}

export interface SetupProgress {
  phase: 'checking' | 'not-installed' | 'installing-ollama' | 'starting-ollama' | 'downloading-model' | 'ready' | 'error'
  percent: number
  status: string
  completed?: number
  total?: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ModelOption {
  id: ModelId
  name: string
  description: string
  minimumRamGb: number
  quantization: string
}

declare global {
  interface Window {
    ollama: OllamaApi
  }
}
