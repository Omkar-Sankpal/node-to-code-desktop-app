import { useEffect, useMemo, useState } from 'react'
import type { ModelId, OllamaStatus, SetupProgress, SystemInfo } from './n2c-ui-user-onboarding-types'

export function useOllamaSetup() {
  const [status, setStatus] = useState<OllamaStatus | null>(null)
  const [step, setStep] = useState<'account' | 'ollama' | 'model' | 'complete' | 'dashboard'>('account')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<SetupProgress>({ phase: 'checking', percent: 0, status: 'Waiting to check this device…' })
  const [selectedModel, setSelectedModel] = useState<ModelId | null>(() => {
    const savedModel = window.localStorage.getItem('n2c-selected-model')
    if (savedModel === 'qwen3:8b-q4_K_M') {
      window.localStorage.setItem('n2c-selected-model', 'qwen3:8b')
      return 'qwen3:8b'
    }
    return savedModel?.trim() || null
  })

  useEffect(() => window.ollama.onProgress(setProgress), [])

  const system: SystemInfo | null = status?.system ?? null
  const continueFromAccount = async () => {
    setBusy(true)
    try {
      const nextStatus = await window.ollama.getStatus()
      setStatus(nextStatus)
      const availableModel = nextStatus.models[0] ?? null
      if (availableModel) setSelectedModel(availableModel)
      setStep(nextStatus.installed && availableModel ? 'dashboard' : nextStatus.installed ? 'model' : 'ollama')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not inspect this device.')
    }
    setBusy(false)
  }

  const install = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await window.ollama.install()
      if (!result.installed) throw new Error('Ollama installation did not complete.')
      setStep('model')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ollama installation failed.')
    } finally {
      setBusy(false)
    }
  }

  const download = async () => {
    if (!selectedModel) return
    setBusy(true)
    setError('')
    setProgress({ phase: 'downloading-model', percent: 0, status: 'Preparing model download…' })
    try {
      const result = await window.ollama.pullModel(selectedModel)
      if (result.cancelled) return
      if (!result.success) throw new Error(result.error ?? 'Model download failed.')
      window.localStorage.setItem('n2c-selected-model', selectedModel)
      setStep('complete')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Model download failed.')
    } finally {
      setBusy(false)
    }

  }

  const selectModel = (model: ModelId) => {
    setSelectedModel(model)
    window.localStorage.setItem('n2c-selected-model', model)
  }

  const cancel = async () => {
    if (!busy) return
    await window.ollama.cancelSetup()
    setBusy(false)
    setError('')
  }

  const enabledModels = useMemo(() => ({
    gemma4e2b: Boolean(system && system.ramGb >= 8 && system.freeStorageGb >= 10),
    gemma4e4b: Boolean(system && system.ramGb >= 16 && system.freeStorageGb >= 10),
    qwen3: Boolean(system && system.ramGb >= 16 && system.freeStorageGb >= 10),
  }), [system])

  return {
    status,
    step,
    setStep,
    busy,
    error,
    progress,
    selectedModel,
    selectModel,
    setSelectedModel,
    enabledModels,
    continueFromAccount,
    install,
    download,
    cancel,
  }
}
