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
})
