import { useState } from 'react'
import type { ApiContract, WorkflowNodeData } from '../n2c-ui-node-handler/n2c-ui-node-handler-types'

const httpMethods: ApiContract['method'][] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

interface Props {
  data: WorkflowNodeData
  onUpdate: (key: string, value: unknown) => void
}

export default function ApiInspector({ data, onUpdate }: Props) {
  const contracts = data.apiContracts ?? []
  const [draftMethod, setDraftMethod] = useState<ApiContract['method']>('GET')
  const [draftPath, setDraftPath] = useState('')
  const [draftDesc, setDraftDesc] = useState('')

  const addContract = () => {
    if (!draftPath.trim()) return
    const contract: ApiContract = { method: draftMethod, path: draftPath.trim(), description: draftDesc.trim() }
    onUpdate('apiContracts', [...contracts, contract])
    // Also update legacy apis field for backward compatibility
    const legacyApis = data.apis ?? []
    onUpdate('apis', [...legacyApis, { method: draftMethod, path: draftPath.trim(), description: draftDesc.trim() }])
    setDraftPath('')
    setDraftDesc('')
  }

  const removeContract = (index: number) => {
    onUpdate('apiContracts', contracts.filter((_, i) => i !== index))
    const legacyApis = data.apis ?? []
    onUpdate('apis', legacyApis.filter((_, i) => i !== index))
  }

  const updateContract = (index: number, key: keyof ApiContract, value: unknown) => {
    onUpdate('apiContracts', contracts.map((c, i) => i === index ? { ...c, [key]: value } : c))
  }

  return (
    <div className="inspector-section">
      <div className="inspector-section-title">API Contracts</div>
      {contracts.length === 0 && <div className="inspector-empty">No API endpoints defined.</div>}
      {contracts.map((contract, index) => (
        <div key={index} className="inspector-api-row">
          <div className="inspector-field-header">
            <span className={`inspector-method inspector-method-${contract.method.toLowerCase()}`}>{contract.method}</span>
            <input className="inspector-input-sm" value={contract.path} onChange={e => updateContract(index, 'path', e.target.value)} placeholder="/api/..." />
            <button className="inspector-remove-btn" type="button" onClick={() => removeContract(index)} title="Remove">×</button>
          </div>
          <input className="inspector-input-full" value={contract.description} onChange={e => updateContract(index, 'description', e.target.value)} placeholder="What this endpoint does" />
          <div className="inspector-api-details">
            <label>Request body<input className="inspector-input-sm" value={contract.requestBody ?? ''} onChange={e => updateContract(index, 'requestBody', e.target.value || undefined)} placeholder="DTO class or none" /></label>
            <label>Response type<input className="inspector-input-sm" value={contract.responseType ?? ''} onChange={e => updateContract(index, 'responseType', e.target.value || undefined)} placeholder="e.g. List<UserDTO>" /></label>
          </div>
        </div>
      ))}
      <div className="inspector-add-row">
        <select className="inspector-select-sm" value={draftMethod} onChange={e => setDraftMethod(e.target.value as ApiContract['method'])}>
          {httpMethods.map(m => <option key={m}>{m}</option>)}
        </select>
        <input className="inspector-input-sm" value={draftPath} onChange={e => setDraftPath(e.target.value)} placeholder="/api/path" onKeyDown={e => e.key === 'Enter' && addContract()} />
        <input className="inspector-input-sm" value={draftDesc} onChange={e => setDraftDesc(e.target.value)} placeholder="Description" />
        <button className="primary-small-button" type="button" onClick={addContract}>Add</button>
      </div>
    </div>
  )
}
