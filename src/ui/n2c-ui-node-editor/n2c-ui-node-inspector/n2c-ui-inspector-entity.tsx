import { useState } from 'react'
import type { EntityField, WorkflowNodeData } from '../n2c-ui-node-handler/n2c-ui-node-handler-types'

const javaTypes = ['String', 'Long', 'Integer', 'Double', 'Boolean', 'LocalDate', 'LocalDateTime', 'BigDecimal', 'UUID']
const constraintOptions = ['@NotNull', '@NotBlank', '@Email', '@Size', '@Min', '@Max', '@Column(unique=true)', '@Lob', '@Enumerated']

interface Props {
  data: WorkflowNodeData
  onUpdate: (key: string, value: unknown) => void
}

export default function EntityInspector({ data, onUpdate }: Props) {
  const fields = data.entityFields ?? []
  const [draftName, setDraftName] = useState('')
  const [draftType, setDraftType] = useState('String')

  const addField = () => {
    if (!draftName.trim()) return
    const field: EntityField = { name: draftName.trim(), type: draftType }
    onUpdate('entityFields', [...fields, field])
    setDraftName('')
    setDraftType('String')
  }

  const removeField = (index: number) => {
    onUpdate('entityFields', fields.filter((_, i) => i !== index))
  }

  const updateField = (index: number, key: keyof EntityField, value: unknown) => {
    onUpdate('entityFields', fields.map((f, i) => i === index ? { ...f, [key]: value } : f))
  }

  const toggleConstraint = (index: number, constraint: string) => {
    const field = fields[index]
    const current = field.constraints ?? []
    const next = current.includes(constraint) ? current.filter(c => c !== constraint) : [...current, constraint]
    updateField(index, 'constraints', next)
  }

  return (
    <div className="inspector-section">
      <div className="inspector-section-title">Entity Fields</div>
      {fields.length === 0 && <div className="inspector-empty">No fields defined. Add fields below.</div>}
      {fields.map((field, index) => (
        <div key={index} className="inspector-field-row">
          <div className="inspector-field-header">
            <input className="inspector-input-sm" value={field.name} onChange={e => updateField(index, 'name', e.target.value)} placeholder="name" />
            <select className="inspector-select-sm" value={field.type} onChange={e => updateField(index, 'type', e.target.value)}>
              {javaTypes.map(t => <option key={t}>{t}</option>)}
            </select>
            <button className="inspector-remove-btn" type="button" onClick={() => removeField(index)} title="Remove field">×</button>
          </div>
          <div className="inspector-constraints">
            {constraintOptions.map(c => (
              <label key={c} className={`inspector-chip ${(field.constraints ?? []).includes(c) ? 'inspector-chip-active' : ''}`}>
                <input type="checkbox" checked={(field.constraints ?? []).includes(c)} onChange={() => toggleConstraint(index, c)} />
                {c.replace('@', '')}
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="inspector-add-row">
        <input className="inspector-input-sm" value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="Field name" onKeyDown={e => e.key === 'Enter' && addField()} />
        <select className="inspector-select-sm" value={draftType} onChange={e => setDraftType(e.target.value)}>
          {javaTypes.map(t => <option key={t}>{t}</option>)}
        </select>
        <button className="primary-small-button" type="button" onClick={addField}>Add</button>
      </div>
    </div>
  )
}
