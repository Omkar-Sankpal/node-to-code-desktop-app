import { useState } from 'react'
import type { ConfigEntry, WorkflowNodeData } from '../n2c-ui-node-handler/n2c-ui-node-handler-types'

const springPropertySuggestions = [
  'spring.datasource.url', 'spring.datasource.username', 'spring.datasource.password', 'spring.datasource.driver-class-name',
  'spring.jpa.hibernate.ddl-auto', 'spring.jpa.show-sql', 'spring.jpa.properties.hibernate.dialect',
  'server.port', 'server.servlet.context-path',
  'spring.security.user.name', 'spring.security.user.password',
  'logging.level.root', 'logging.level.org.springframework',
]

interface Props {
  data: WorkflowNodeData
  onUpdate: (key: string, value: unknown) => void
}

export default function ConfigInspector({ data, onUpdate }: Props) {
  const entries = data.configEntries ?? []
  const [draftKey, setDraftKey] = useState('')
  const [draftValue, setDraftValue] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)

  const addEntry = () => {
    if (!draftKey.trim()) return
    const entry: ConfigEntry = { key: draftKey.trim(), value: draftValue.trim() || undefined }
    onUpdate('configEntries', [...entries, entry])
    setDraftKey('')
    setDraftValue('')
    setShowSuggestions(false)
  }

  const removeEntry = (index: number) => {
    onUpdate('configEntries', entries.filter((_, i) => i !== index))
  }

  const updateEntry = (index: number, key: keyof ConfigEntry, value: unknown) => {
    onUpdate('configEntries', entries.map((e, i) => i === index ? { ...e, [key]: value } : e))
  }

  const filteredSuggestions = draftKey.trim()
    ? springPropertySuggestions.filter(s => s.includes(draftKey) && !entries.some(e => e.key === s))
    : []

  return (
    <div className="inspector-section">
      <div className="inspector-section-title">Configuration Properties</div>
      {entries.length === 0 && <div className="inspector-empty">No configuration properties defined.</div>}
      {entries.map((entry, index) => (
        <div key={index} className="inspector-config-row">
          <input className="inspector-input-full" value={entry.key} onChange={e => updateEntry(index, 'key', e.target.value)} placeholder="property.key" />
          <input className="inspector-input-full" value={entry.value ?? ''} onChange={e => updateEntry(index, 'value', e.target.value || undefined)} placeholder="value" />
          <button className="inspector-remove-btn" type="button" onClick={() => removeEntry(index)} title="Remove">×</button>
        </div>
      ))}
      <div className="inspector-add-row inspector-add-row-col">
        <div className="inspector-suggest-wrapper">
          <input className="inspector-input-full" value={draftKey} onChange={e => { setDraftKey(e.target.value); setShowSuggestions(true) }} placeholder="property.key" onKeyDown={e => e.key === 'Enter' && addEntry()} onFocus={() => setShowSuggestions(true)} onBlur={() => setTimeout(() => setShowSuggestions(false), 150)} />
          {showSuggestions && filteredSuggestions.length > 0 && (
            <div className="inspector-suggestions">
              {filteredSuggestions.slice(0, 5).map(s => (
                <button key={s} type="button" className="inspector-suggestion-item" onMouseDown={() => { setDraftKey(s); setShowSuggestions(false) }}>{s}</button>
              ))}
            </div>
          )}
        </div>
        <input className="inspector-input-full" value={draftValue} onChange={e => setDraftValue(e.target.value)} placeholder="default value" />
        <button className="primary-small-button" type="button" onClick={addEntry}>Add</button>
      </div>
    </div>
  )
}
