import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('ollama', {
  getStatus: () => ipcRenderer.invoke('ollama:status'),
  install: () => ipcRenderer.invoke('ollama:install'),
  pullModel: (modelId: string) => ipcRenderer.invoke('ollama:pull-model', modelId),
  cancelSetup: () => ipcRenderer.invoke('ollama:cancel-setup'),
  openDownloadPage: () => ipcRenderer.invoke('ollama:open-download-page'),
  onProgress: (callback: (progress: { phase: string; percent: number; status: string; completed?: number; total?: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { phase: string; percent: number; status: string; completed?: number; total?: number }) => callback(progress)
    ipcRenderer.on('ollama:setup-progress', listener)
    return () => ipcRenderer.removeListener('ollama:setup-progress', listener)
  },
  chat: (modelId: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    ipcRenderer.invoke('ollama:chat', modelId, messages),
  generateProject: (modelId: string, projectName: string, graph: {
    nodes: Array<{ id: string; data?: { label?: string; description?: string; kind?: string; apis?: Array<{ method: string; path: string; description: string }> } }>
    edges: Array<{ source: string; target: string }>
  }) => ipcRenderer.invoke('project:generate', modelId, projectName, graph),
  onGenerationProgress: (callback: (progress: { phase: string; percent: number; status: string; filesWritten?: number; totalFiles?: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { phase: string; percent: number; status: string; filesWritten?: number; totalFiles?: number }) => callback(progress)
    ipcRenderer.on('project:generation-progress', listener)
    return () => ipcRenderer.removeListener('project:generation-progress', listener)
  },
  openProjectFolder: (projectPath: string) => ipcRenderer.invoke('project:open-folder', projectPath),
  exportProjectZip: (projectPath: string) => ipcRenderer.invoke('project:export-zip', projectPath),
})
