import { useEffect, useMemo, useState } from 'react'
import type { ModelId, OllamaStatus, SystemInfo } from './n2c-ui-user-onboarding-types'

export function useOllamaSetup() {
  const [status, setStatus] = useState<OllamaStatus | null>(null)
  const [step, setStep] = useState<'account' | 'ollama' | 'model' | 'complete' | 'dashboard'>('account')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const [selectedModel, setSelectedModel] = useState<ModelId | null>(() => {
    const savedModel = window.localStorage.getItem('n2c-selected-model')
    return savedModel === 'gemma4-e2b' || savedModel === 'gemma4-e4b' || savedModel === 'qwen3-8b' ? savedModel : null
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
    setProgress('')
    try {
      const result = await window.ollama.pullModel(selectedModel)
      if (!result.success) throw new Error(result.error ?? 'Model download failed.')
      window.localStorage.setItem('n2c-selected-model', selectedModel)
      setStep('complete')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Model download failed.')
    } finally {
      setBusy(false)
    }
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
    setSelectedModel,
    enabledModels,
    continueFromAccount,
    install,
    download,
  }
}
