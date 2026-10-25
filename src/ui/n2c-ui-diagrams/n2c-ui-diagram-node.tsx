import { Handle, Position } from '@xyflow/react'
import type { DiagramNodeData } from './n2c-ui-diagram-types'

const styleColors: Record<string, { bg: string; border: string; accent: string }> = {
  class:     { bg: '#1a1f2e', border: '#3b82f6', accent: '#60a5fa' },
  interface: { bg: '#1a1f2e', border: '#8b5cf6', accent: '#a78bfa' },
  enum:      { bg: '#1a1f2e', border: '#f59e0b', accent: '#fbbf24' },
  entity:    { bg: '#1a2218', border: '#22c55e', accent: '#4ade80' },
  actor:     { bg: '#1e1a2e', border: '#a855f7', accent: '#c084fc' },
  usecase:   { bg: '#1e1a2e', border: '#6366f1', accent: '#818cf8' },
  component: { bg: '#1a1f2e', border: '#3b82f6', accent: '#60a5fa' },
  layer:     { bg: '#11151c', border: '#475569', accent: '#94a3b8' },
  process:   { bg: '#1a1f2e', border: '#14b8a6', accent: '#2dd4bf' },
  datastore: { bg: '#1a2218', border: '#22c55e', accent: '#4ade80' },
  external:  { bg: '#1e1718', border: '#f43f5e', accent: '#fb7185' },
  lifeline:  { bg: '#1a1f2e', border: '#6366f1', accent: '#818cf8' },
  server:    { bg: '#1a1f2e', border: '#3b82f6', accent: '#60a5fa' },
  container: { bg: '#1a1f2e', border: '#0ea5e9', accent: '#38bdf8' },
  database:  { bg: '#1a2218', border: '#22c55e', accent: '#4ade80' },
  start:     { bg: '#111', border: '#22c55e', accent: '#4ade80' },
  end:       { bg: '#111', border: '#ef4444', accent: '#f87171' },
  decision:  { bg: '#1e1718', border: '#f59e0b', accent: '#fbbf24' },
  action:    { bg: '#1a1f2e', border: '#6366f1', accent: '#818cf8' },
  message:   { bg: '#1a1f2e', border: '#475569', accent: '#94a3b8' },
}

const defaultColors = { bg: '#1a1f2e', border: '#475569', accent: '#94a3b8' }

export default function DiagramNodeComponent({ data }: { data: DiagramNodeData }) {
  const style = data.nodeStyle ?? 'class'
  const colors = styleColors[style] ?? defaultColors

  // Start/End nodes: small circles
  if (style === 'start' || style === 'end') {
    return (
      <div className="diagram-node-circle" style={{ background: colors.border }}>
        <Handle type="target" position={Position.Top} />
        <span>{data.label}</span>
        <Handle type="source" position={Position.Bottom} />
      </div>
    )
  }

  // Actor: stick figure
  if (style === 'actor') {
    return (
      <div className="diagram-node-actor">
        <Handle type="target" position={Position.Left} />
        <div className="diagram-actor-icon">👤</div>
        <span>{data.label}</span>
        <Handle type="source" position={Position.Right} />
      </div>
    )
  }

  // Use case: oval
  if (style === 'usecase') {
    return (
      <div className="diagram-node-usecase" style={{ borderColor: colors.border }}>
        <Handle type="target" position={Position.Left} />
        <span className="diagram-usecase-label">{data.label}</span>
        {data.description && <small className="diagram-usecase-desc">{data.description}</small>}
        <Handle type="source" position={Position.Right} />
      </div>
    )
  }

  // Decision diamond
  if (style === 'decision') {
    return (
      <div className="diagram-node-decision" style={{ borderColor: colors.border, background: colors.bg }}>
        <Handle type="target" position={Position.Top} />
        <span>{data.label}</span>
        <Handle type="source" position={Position.Bottom} />
      </div>
    )
  }

  // Standard UML-style box
  return (
    <div className="diagram-node-box" style={{ borderColor: colors.border, background: colors.bg }}>
      <Handle type="target" position={Position.Left} />
      {data.stereotype && <div className="diagram-node-stereotype" style={{ color: colors.accent }}>{data.stereotype}</div>}
      <div className="diagram-node-title" style={{ borderBottomColor: colors.border }}>{data.label}</div>
      {data.fields && data.fields.length > 0 && (
        <div className="diagram-node-section" style={{ borderBottomColor: colors.border }}>
          {data.fields.map((f, i) => (
            <div key={i} className="diagram-node-field">
              <span className="diagram-visibility">{f.visibility ?? '+'}</span>{f.name}: <span className="diagram-type">{f.type}</span>
            </div>
          ))}
        </div>
      )}
      {data.methods && data.methods.length > 0 && (
        <div className="diagram-node-section">
          {data.methods.map((m, i) => (
            <div key={i} className="diagram-node-method">
              <span className="diagram-visibility">{m.visibility ?? '+'}</span>{m.name}({m.params ?? ''}): <span className="diagram-type">{m.returnType}</span>
            </div>
          ))}
        </div>
      )}
      {!data.fields?.length && !data.methods?.length && data.description && (
        <div className="diagram-node-desc">{data.description}</div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
