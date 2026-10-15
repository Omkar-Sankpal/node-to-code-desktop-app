import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('ollama', {
  getStatus: () => ipcRenderer.invoke('ollama:status'),
  install: () => ipcRenderer.invoke('ollama:install'),
  pullModel: (modelId: string) => ipcRenderer.invoke('ollama:pull-model', modelId),
  openDownloadPage: () => ipcRenderer.invoke('ollama:open-download-page'),
  onProgress: (callback: (message: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
    ipcRenderer.on('ollama:model-progress', listener)
    return () => ipcRenderer.removeListener('ollama:model-progress', listener)
  },
  chat: (modelId: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    ipcRenderer.invoke('ollama:chat', modelId, messages),
})
