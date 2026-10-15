import { useState, type FormEvent } from 'react'
import type { ModelOption } from './n2c-ui-user-onboarding-types'
import { useOllamaSetup } from './n2c-ui-user-onboarding-hooks'
import UserChatbox from '../n2c-ui-user-chatbox/n2c-ui-user-chatbox-main'

const modelOptions: ModelOption[] = [
  { id: 'gemma4-e2b', name: 'Gemma 4 E2B', description: 'Fast local coding assistant', minimumRamGb: 8, quantization: 'Non-quantized' },
  { id: 'gemma4-e4b', name: 'Gemma 4 E4B', description: 'Higher quality responses', minimumRamGb: 16, quantization: 'Non-quantized' },
  { id: 'qwen3-8b', name: 'Qwen3 8B', description: 'Strong general-purpose model', minimumRamGb: 16, quantization: 'Q4_K_M' },
]

function AccountStep({ onContinue, busy }: { onContinue: (nickname: string) => void; busy: boolean }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const nickname = String(form.get('nickname') ?? '').trim()
    if (nickname) {
      window.localStorage.setItem('n2c-user-session', JSON.stringify({ nickname, createdAt: new Date().toISOString() }))
      void onContinue(nickname)
    }
  }
  return (
    <form onSubmit={submit}>
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-600">Welcome to Node to Code</p>
      <h1 className="my-3 text-4xl font-medium tracking-tight text-slate-950 sm:text-5xl">Build privately with local AI.</h1>
      <p className="text-slate-600">Choose how you want to start. A guest session is stored only on this computer.</p>
      <label className="mt-7 grid gap-2 font-semibold text-slate-800">Nickname<input className="rounded-lg border border-slate-200 bg-white px-3 py-3 font-normal outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" name="nickname" placeholder="Your nickname" required /></label>
      <button className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={busy}>{busy ? 'Checking device…' : 'Continue as guest'}</button>
      <button className="mt-3 w-full rounded-lg border border-slate-200 bg-transparent px-4 py-3 font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled>Sign up with Google (coming soon)</button>
    </form>
  )
}

export default function UserOnboarding() {
  const setup = useOllamaSetup()
  const [chatOpen, setChatOpen] = useState(false)
  if (setup.step === 'account') return <main className="m-auto w-[min(680px,calc(100%-48px))] rounded-2xl border border-slate-200 bg-white p-12 text-left shadow-2xl shadow-slate-900/15"><AccountStep onContinue={() => void setup.continueFromAccount()} busy={setup.busy} /></main>
  if (setup.step === 'complete') return <main className="m-auto w-[min(680px,calc(100%-48px))] rounded-2xl border border-slate-200 bg-white p-12 text-left shadow-2xl shadow-slate-900/15"><p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-600">All set</p><h1 className="my-3 text-4xl font-medium tracking-tight text-slate-950">Your local workspace is ready.</h1><p className="text-slate-600">Ollama and your selected model are installed. You can start building now.</p><button className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white" onClick={() => setup.setStep('dashboard')}>Open dashboard</button></main>
  if (setup.step === 'dashboard') return <main className="m-auto w-[min(680px,calc(100%-48px))] rounded-2xl border border-slate-200 bg-white p-12 text-left shadow-2xl shadow-slate-900/15"><p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-600">Dashboard</p><h1 className="my-3 text-4xl font-medium tracking-tight text-slate-950">Ready to build.</h1><p className="text-slate-600">Your local model is ready to use.</p>{setup.selectedModel && <button className="ml-auto mt-8 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-xl text-white shadow-lg hover:bg-emerald-700" onClick={() => setChatOpen(true)} aria-label="Open local model chat">💬</button>}{chatOpen && setup.selectedModel && <UserChatbox modelId={setup.selectedModel} onClose={() => setChatOpen(false)} />}</main>

  const system = setup.status?.system
  return (
    <main className="m-auto w-[min(680px,calc(100%-48px))] rounded-2xl border border-slate-200 bg-white p-12 text-left shadow-2xl shadow-slate-900/15">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-600">Local AI setup</p>
      {setup.step === 'ollama' ? (
        <>
          <h1 className="my-3 text-4xl font-medium tracking-tight text-slate-950">Install Ollama</h1>
          <p className="text-slate-600">Ollama runs the models locally, so your code and prompts stay on your device.</p>
          <div className="my-6 flex justify-between rounded-lg bg-slate-50 p-3 text-slate-600"><span>Ollama installation</span><span>{setup.busy ? 'Installing…' : 'Ready to install'}</span></div>
          <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full bg-emerald-600 ${setup.busy ? 'w-2/3 animate-pulse' : 'w-0'}`} /></div>
          <button className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white disabled:opacity-50" onClick={() => void setup.install()} disabled={setup.busy}>{setup.busy ? 'Installing Ollama…' : 'Install Ollama'}</button>
          <button className="mt-3 w-full rounded-lg border border-slate-200 bg-transparent px-4 py-3 font-bold text-slate-700 disabled:opacity-50" onClick={() => void window.ollama.openDownloadPage()} disabled={setup.busy}>Open official download page</button>
        </>
      ) : (
        <>
          <h1 className="my-3 text-4xl font-medium tracking-tight text-slate-950">Choose your model</h1>
          <p className="text-slate-600">Models are downloaded directly by Ollama. Gemma 4 options are explicitly non-quantized.</p>
          {system && <div className="my-6 rounded-lg bg-slate-50 p-3 text-slate-600">RAM {system.ramGb.toFixed(1)} GB · Free storage {system.freeStorageGb.toFixed(1)} GB</div>}
          <div className="my-5 grid gap-2.5">
            {modelOptions.map((model) => {
              const enabled = model.id === 'gemma4-e2b' ? setup.enabledModels.gemma4e2b : model.id === 'gemma4-e4b' ? setup.enabledModels.gemma4e4b : setup.enabledModels.qwen3
              return <button className={`m-0 grid gap-1 rounded-lg border p-3 text-left ${setup.selectedModel === model.id ? 'border-emerald-600 ring-2 ring-emerald-100' : 'border-slate-200'} bg-slate-50 text-slate-800 disabled:cursor-not-allowed disabled:opacity-50`} key={model.id} onClick={() => enabled && setup.setSelectedModel(model.id)} disabled={!enabled || setup.busy}><strong>{model.name}</strong><span className="text-slate-600">{model.description}</span><small className="text-slate-500">{model.quantization} · {model.minimumRamGb} GB RAM minimum{!enabled ? ' · Does not meet device requirements' : ''}</small></button>
            })}
          </div>
          {setup.busy && <div className="mt-4"><span>Downloading model…</span><pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-2.5 font-mono text-xs text-emerald-200">{setup.progress || 'Contacting Ollama…'}</pre></div>}
          <div className="my-4 h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full bg-emerald-600" /></div>
          <button className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white disabled:opacity-50" onClick={() => void setup.download()} disabled={!setup.selectedModel || setup.busy}>{setup.busy ? 'Downloading…' : 'Download selected model'}</button>
        </>
      )}
      {setup.error && <p className="mt-4 text-red-700" role="alert">{setup.error}</p>}
    </main>
  )
}
