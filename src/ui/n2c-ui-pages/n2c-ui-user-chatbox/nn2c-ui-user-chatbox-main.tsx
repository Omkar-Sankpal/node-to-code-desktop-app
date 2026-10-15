import { useState, type FormEvent } from 'react'
import type { ChatMessage, ModelId } from '../n2c-ui-user-onboarding/n2c-ui-user-onboarding-types'

export default function UserChatbox({ modelId, onClose }: { modelId: ModelId; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = input.trim()
    if (!content || busy) return
    const nextMessages = [...messages, { role: 'user' as const, content }]
    setMessages(nextMessages)
    setInput('')
    setError('')
    setBusy(true)
    try {
      const result = await window.ollama.chat(modelId, nextMessages)
      setMessages([...nextMessages, result.message])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The local model could not respond.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="fixed bottom-5 right-5 z-10 flex h-[min(600px,calc(100vh-40px))] w-[min(420px,calc(100vw-40px))] flex-col rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-2xl">
      <header className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div>
          <h2 className="font-semibold text-slate-950">Local model chat</h2>
          <p className="text-xs text-slate-500">Runs privately through Ollama</p>
        </div>
        <button className="m-0 w-auto rounded-lg px-3 py-1 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close chat">×</button>
      </header>
      <div className="my-3 flex-1 space-y-3 overflow-y-auto rounded-lg bg-slate-50 p-3">
        {messages.length === 0 && <p className="text-sm text-slate-500">Ask the model anything to get started.</p>}
        {messages.map((message, index) => (
          <div className={`rounded-lg p-3 text-sm ${message.role === 'user' ? 'ml-6 bg-emerald-100 text-emerald-950' : 'mr-6 bg-white text-slate-800'}`} key={`${message.role}-${index}`}>
            <strong className="mb-1 block text-xs uppercase tracking-wide opacity-60">{message.role}</strong>
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        ))}
        {busy && <p className="text-sm text-slate-500">Local model is thinking…</p>}
      </div>
      <form className="flex gap-2" onSubmit={sendMessage}>
        <input className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-emerald-500" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Message your model…" disabled={busy} />
        <button className="m-0 w-auto rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-50" type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
      {error && <p className="mt-2 text-xs text-red-700" role="alert">{error}</p>}
    </section>
  )
}
