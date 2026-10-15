export type OnboardingStep = 'account' | 'ollama' | 'model' | 'complete' | 'dashboard'
export type ModelId = 'gemma4-e2b' | 'gemma4-e4b' | 'qwen3-8b'

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
  cancelSetup: () => Promise<boolean>
  openDownloadPage: () => Promise<void>
  onProgress: (callback: (progress: SetupProgress) => void) => () => void
  chat: (modelId: ModelId, messages: ChatMessage[]) => Promise<{ message: ChatMessage }>
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
