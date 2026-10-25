import { useState } from 'react'
import type { ServiceMethod, WorkflowNodeData } from '../n2c-ui-node-handler/n2c-ui-node-handler-types'

interface Props {
  data: WorkflowNodeData
  onUpdate: (key: string, value: unknown) => void
}

export default function ServiceInspector({ data, onUpdate }: Props) {
  const methods = data.serviceMethods ?? []
  const [draftName, setDraftName] = useState('')
  const [draftDesc, setDraftDesc] = useState('')

  const addMethod = () => {
    if (!draftName.trim()) return
    const method: ServiceMethod = { name: draftName.trim(), description: draftDesc.trim() }
    onUpdate('serviceMethods', [...methods, method])
    setDraftName('')
    setDraftDesc('')
  }

  const removeMethod = (index: number) => {
    onUpdate('serviceMethods', methods.filter((_, i) => i !== index))
  }

  const updateMethod = (index: number, key: keyof ServiceMethod, value: unknown) => {
    onUpdate('serviceMethods', methods.map((m, i) => i === index ? { ...m, [key]: value } : m))
  }

  return (
    <div className="inspector-section">
      <div className="inspector-section-title">Service Methods</div>
      {methods.length === 0 && <div className="inspector-empty">No service methods defined.</div>}
      {methods.map((method, index) => (
        <div key={index} className="inspector-field-row">
          <div className="inspector-field-header">
            <input className="inspector-input-sm" value={method.name} onChange={e => updateMethod(index, 'name', e.target.value)} placeholder="methodName" />
            <button className="inspector-remove-btn" type="button" onClick={() => removeMethod(index)} title="Remove">×</button>
          </div>
          <input className="inspector-input-full" value={method.description} onChange={e => updateMethod(index, 'description', e.target.value)} placeholder="What this method does" />
          <div className="inspector-api-details">
            <label>Parameters<input className="inspector-input-sm" value={method.params ?? ''} onChange={e => updateMethod(index, 'params', e.target.value || undefined)} placeholder="Long id, CreateDTO dto" /></label>
            <label>Return type<input className="inspector-input-sm" value={method.returnType ?? ''} onChange={e => updateMethod(index, 'returnType', e.target.value || undefined)} placeholder="e.g. UserDTO" /></label>
          </div>
        </div>
      ))}
      <div className="inspector-add-row">
        <input className="inspector-input-sm" value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="Method name" onKeyDown={e => e.key === 'Enter' && addMethod()} />
        <input className="inspector-input-sm" value={draftDesc} onChange={e => setDraftDesc(e.target.value)} placeholder="Description" />
        <button className="primary-small-button" type="button" onClick={addMethod}>Add</button>
      </div>
    </div>
  )
}
