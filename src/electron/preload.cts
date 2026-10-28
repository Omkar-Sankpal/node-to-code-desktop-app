import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('ollama', {
  getStatus: () => ipcRenderer.invoke('ollama:status'),
  install: () => ipcRenderer.invoke('ollama:install'),
  pullModel: (modelId: string) => ipcRenderer.invoke('ollama:pull-model', modelId),
  deleteModel: (modelId: string) => ipcRenderer.invoke('ollama:delete-model', modelId),
  getModelLibrary: () => ipcRenderer.invoke('ollama:model-library'),
  cancelSetup: () => ipcRenderer.invoke('ollama:cancel-setup'),
  openDownloadPage: () => ipcRenderer.invoke('ollama:open-download-page'),
  onProgress: (callback: (progress: { phase: string; percent: number; status: string; completed?: number; total?: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { phase: string; percent: number; status: string; completed?: number; total?: number }) => callback(progress)
    ipcRenderer.on('ollama:setup-progress', listener)
    return () => ipcRenderer.removeListener('ollama:setup-progress', listener)
  },
  chat: (modelId: string, messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) =>
    ipcRenderer.invoke('ollama:chat', modelId, messages),
  prepareProject: (projectName: string, dependencies: Array<{ groupId: string; artifactId: string; version?: string; scope?: string }>) =>
    ipcRenderer.invoke('project:prepare', projectName, dependencies),
  generateProject: (modelId: string, projectName: string, graph: {
    nodes: Array<{ id: string; data?: { label?: string; description?: string; kind?: string; apis?: Array<{ method: string; path: string; description: string }> } }>
    edges: Array<{ source: string; target: string }>
  }, projectPath: string, structure: { packageName: string; directories: string[]; files: Array<{ path: string; content: string }>; dependencies: Array<{ groupId: string; artifactId: string; version?: string; scope?: string }> }) => ipcRenderer.invoke('project:generate', modelId, projectName, graph, projectPath, structure),
  onGenerationProgress: (callback: (progress: { phase: string; percent: number; status: string; filesWritten?: number; totalFiles?: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { phase: string; percent: number; status: string; filesWritten?: number; totalFiles?: number }) => callback(progress)
    ipcRenderer.on('project:generation-progress', listener)
    return () => ipcRenderer.removeListener('project:generation-progress', listener)
  },
  openProjectFolder: (projectPath: string) => ipcRenderer.invoke('project:open-folder', projectPath),
  exportProjectZip: (projectPath: string) => ipcRenderer.invoke('project:export-zip', projectPath),
  compileProject: (projectPath: string) => ipcRenderer.invoke('project:compile', projectPath),
  loadProjectGraph: (projectPath: string) => ipcRenderer.invoke('project:load-graph', projectPath),
})

