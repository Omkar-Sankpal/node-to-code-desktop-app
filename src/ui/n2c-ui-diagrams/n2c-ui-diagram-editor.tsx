import { useCallback, useMemo, useState } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
} from '@xyflow/react'
import type { DiagramData, DiagramKind, DiagramNode, DiagramEdge } from './n2c-ui-diagram-types'
import { diagramKindLabels, diagramKindIcons, loadDiagrams, saveDiagrams, createDiagramId } from './n2c-ui-diagram-types'
import { getGenerator } from './generators/n2c-ui-diagram-gen-index'
import DiagramNodeComponent from './n2c-ui-diagram-node'
import type { ProjectGraph } from '../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'

const nodeTypes = { diagramNode: DiagramNodeComponent }

const allKinds: DiagramKind[] = [
  'uml-class', 'use-case', 'er-diagram', 'sequence', 'activity',
  'component', 'architecture', 'data-flow', 'deployment', 'spring-layers',
]

interface DiagramEditorProps {
  projectId: string
  projectName: string
  projectGraph: ProjectGraph
}

export default function DiagramEditor({ projectId, projectName, projectGraph }: DiagramEditorProps) {
  const [diagrams, setDiagrams] = useState<DiagramData[]>(() => loadDiagrams(projectId))
  const [activeDiagramId, setActiveDiagramId] = useState<string | null>(diagrams[0]?.meta.id ?? null)
  const [generateMenuOpen, setGenerateMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const activeDiagram = useMemo(() => diagrams.find(d => d.meta.id === activeDiagramId) ?? null, [diagrams, activeDiagramId])

  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramNode>(activeDiagram?.nodes ?? [])
  const [edges, setEdges, onEdgesChange] = useEdgesState<DiagramEdge>(activeDiagram?.edges ?? [])

  const onConnect = useCallback((conn: Connection) => setEdges(eds => addEdge(conn, eds)), [setEdges])

  // Sync nodes/edges when switching diagrams
  const switchDiagram = useCallback((id: string) => {
    // Save current first
    if (activeDiagramId) {
      setDiagrams(prev => {
        const updated = prev.map(d => d.meta.id === activeDiagramId ? { ...d, nodes, edges, meta: { ...d.meta, updatedAt: new Date().toISOString() } } : d)
        saveDiagrams(projectId, updated)
        return updated
      })
    }
    setActiveDiagramId(id)
    const target = diagrams.find(d => d.meta.id === id)
    if (target) {
      setNodes(target.nodes)
      setEdges(target.edges)
    }
  }, [activeDiagramId, diagrams, nodes, edges, projectId, setNodes, setEdges])

  const generateDiagram = useCallback((kind: DiagramKind) => {
    const gen = getGenerator(kind)
    const data = gen.generate(projectGraph, projectName)
    data.meta.projectId = projectId
    setDiagrams(prev => {
      const next = [...prev, data]
      saveDiagrams(projectId, next)
      return next
    })
    setActiveDiagramId(data.meta.id)
    setNodes(data.nodes)
    setEdges(data.edges)
    setGenerateMenuOpen(false)
  }, [projectGraph, projectName, projectId, setNodes, setEdges])

  const deleteDiagram = useCallback((id: string) => {
    setDiagrams(prev => {
      const next = prev.filter(d => d.meta.id !== id)
      saveDiagrams(projectId, next)
      return next
    })
    if (activeDiagramId === id) {
      const remaining = diagrams.filter(d => d.meta.id !== id)
      if (remaining.length > 0) { switchDiagram(remaining[0].meta.id) }
      else { setActiveDiagramId(null); setNodes([]); setEdges([]) }
    }
  }, [activeDiagramId, diagrams, projectId, switchDiagram, setNodes, setEdges])

  const duplicateDiagram = useCallback((id: string) => {
    const src = diagrams.find(d => d.meta.id === id)
    if (!src) return
    const dup: DiagramData = {
      meta: { ...src.meta, id: createDiagramId(), name: `${src.meta.name} (copy)`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      nodes: src.nodes.map(n => ({ ...n })),
      edges: src.edges.map(e => ({ ...e })),
    }
    setDiagrams(prev => {
      const next = [...prev, dup]
      saveDiagrams(projectId, next)
      return next
    })
    switchDiagram(dup.meta.id)
  }, [diagrams, projectId, switchDiagram])

  const startRename = useCallback((id: string) => {
    const d = diagrams.find(d => d.meta.id === id)
    if (d) { setRenaming(id); setRenameValue(d.meta.name) }
  }, [diagrams])

  const confirmRename = useCallback(() => {
    if (!renaming || !renameValue.trim()) { setRenaming(null); return }
    setDiagrams(prev => {
      const next = prev.map(d => d.meta.id === renaming ? { ...d, meta: { ...d.meta, name: renameValue.trim(), updatedAt: new Date().toISOString() } } : d)
      saveDiagrams(projectId, next)
      return next
    })
    setRenaming(null)
  }, [renaming, renameValue, projectId])

  const saveCurrent = useCallback(() => {
    if (!activeDiagramId) return
    setDiagrams(prev => {
      const next = prev.map(d => d.meta.id === activeDiagramId ? { ...d, nodes, edges, meta: { ...d.meta, updatedAt: new Date().toISOString() } } : d)
      saveDiagrams(projectId, next)
      return next
    })
  }, [activeDiagramId, nodes, edges, projectId])

  const regenerateDiagram = useCallback((id: string) => {
    const d = diagrams.find(d => d.meta.id === id)
    if (!d) return
    const gen = getGenerator(d.meta.kind)
    const newData = gen.generate(projectGraph, projectName)
    setDiagrams(prev => {
      const next = prev.map(existing => existing.meta.id === id ? { ...existing, nodes: newData.nodes, edges: newData.edges, meta: { ...existing.meta, updatedAt: new Date().toISOString() } } : existing)
      saveDiagrams(projectId, next)
      return next
    })
    if (activeDiagramId === id) { setNodes(newData.nodes); setEdges(newData.edges) }
  }, [diagrams, projectGraph, projectName, projectId, activeDiagramId, setNodes, setEdges])

  return (
    <div className="diagram-editor">
      <div className="diagram-sidebar">
        <div className="diagram-sidebar-header">
          <span>Diagrams</span>
          <div className="diagram-sidebar-actions">
            <button className="diagram-action-btn" type="button" onClick={saveCurrent} title="Save current diagram">💾</button>
            <button className="diagram-action-btn" type="button" onClick={() => setGenerateMenuOpen(!generateMenuOpen)} title="Generate new diagram">+</button>
          </div>
        </div>
        {generateMenuOpen && (
          <div className="diagram-generate-menu">
            {allKinds.map(kind => (
              <button key={kind} className="diagram-generate-item" type="button" onClick={() => generateDiagram(kind)}>
                <span className="diagram-kind-icon">{diagramKindIcons[kind]}</span>
                <span>{diagramKindLabels[kind]}</span>
              </button>
            ))}
          </div>
        )}
        <div className="diagram-list">
          {diagrams.length === 0 && <div className="diagram-list-empty"><span>No diagrams yet</span><small>Click + to generate from your project graph</small></div>}
          {diagrams.map(d => (
            <div key={d.meta.id} className={`diagram-list-item ${d.meta.id === activeDiagramId ? 'diagram-list-item-active' : ''}`}>
              {renaming === d.meta.id ? (
                <form className="diagram-rename-form" onSubmit={e => { e.preventDefault(); confirmRename() }}>
                  <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)} onBlur={confirmRename} />
                </form>
              ) : (
                <button className="diagram-list-btn" type="button" onClick={() => switchDiagram(d.meta.id)}>
                  <span className="diagram-kind-icon">{diagramKindIcons[d.meta.kind]}</span>
                  <span className="diagram-list-name">{d.meta.name}</span>
                </button>
              )}
              <div className="diagram-item-actions">
                <button type="button" onClick={() => startRename(d.meta.id)} title="Rename">✎</button>
                <button type="button" onClick={() => duplicateDiagram(d.meta.id)} title="Duplicate">⧉</button>
                <button type="button" onClick={() => regenerateDiagram(d.meta.id)} title="Regenerate">↻</button>
                <button type="button" onClick={() => deleteDiagram(d.meta.id)} title="Delete">×</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="diagram-canvas-area">
        {activeDiagram ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} color="#1e2530" gap={20} />
            <Controls />
          </ReactFlow>
        ) : (
          <div className="diagram-empty-state">
            <div className="diagram-empty-icon">⬡</div>
            <strong>No diagram selected</strong>
            <p>Generate a diagram from your project graph using the + button, or select an existing one from the sidebar.</p>
          </div>
        )}
      </div>
    </div>
  )
}
