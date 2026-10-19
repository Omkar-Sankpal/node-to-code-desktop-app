import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react'
import type { GeneratedFile, GenerationGraph, GenerationProgress, ModelId } from '../n2c-ui-user-onboarding/n2c-ui-user-onboarding-types'
import NodeEditor from '../../n2c-ui-node-editor/n2c-ui-node-editor-main'
import { createWorkflowNode, createWorkflowSubgroup, normalizeProjectGraph } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-main'
import { nodeTemplates, starterGraph, subgroupTemplate, type ApiDefinition, type ProjectGraph, type WorkflowNode } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'

type Project = {
  id: string
  name: string
  updatedAt: string
}

const initialProjects: Project[] = [
  { id: 'starter-project', name: 'Starter project', updatedAt: 'Just now' },
]

const generationSteps = [
  { label: 'Project foundation', detail: 'pom.xml and application configuration' },
  { label: 'Models and repositories', detail: 'Entities and data access contracts' },
  { label: 'Service layer', detail: 'Business logic connected to models' },
  { label: 'Controller layer', detail: 'REST endpoints connected to services' },
  { label: 'Application entry point', detail: 'Demo.java and Spring Boot startup' },
  { label: 'Compile and verify', detail: 'Maven compilation and repair pass' },
]

function readSavedProjects() {
  const saved = window.localStorage.getItem('n2c-projects')
  if (!saved) return initialProjects
  try {
    const projects = JSON.parse(saved) as Project[]
    return projects.length ? projects : initialProjects
  } catch {
    return initialProjects
  }
}

function projectGraphKey(projectId: string) {
  return `n2c-project-graph-${projectId}`
}

function readGraph(projectId: string): ProjectGraph {
  const saved = window.localStorage.getItem(projectGraphKey(projectId))
  if (!saved) return starterGraph
  try {
    const graph = JSON.parse(saved) as ProjectGraph
    return graph.nodes.some((node) => node.id === 'main-file') ? normalizeProjectGraph(graph) : starterGraph
  } catch {
    return starterGraph
  }
}

export default function UserDashboard({ onOpenChat, modelId }: { onOpenChat?: () => void; modelId?: ModelId }) {
  const [projects, setProjects] = useState(readSavedProjects)
  const [activeProjectId, setActiveProjectId] = useState(projects[0].id)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0]
  const savedGraph = useMemo(() => readGraph(activeProject.id), [activeProject.id])
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>(savedGraph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(savedGraph.edges)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [apiDraft, setApiDraft] = useState<ApiDefinition>({ method: 'GET', path: '/api/items', description: '' })
  const [generationState, setGenerationState] = useState<'idle' | 'working' | 'success' | 'error'>('idle')
  const [generationMessage, setGenerationMessage] = useState('')
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null)
  const [generatedProject, setGeneratedProject] = useState<{ path: string; files: GeneratedFile[] } | null>(null)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState('')
  const nodeSequence = useRef(0)

  useEffect(() => {
    window.localStorage.setItem('n2c-projects', JSON.stringify(projects))
  }, [projects])

  useEffect(() => {
    const graph = readGraph(activeProject.id)
    setNodes(graph.nodes)
    setEdges(graph.edges)
  }, [activeProject.id, setEdges, setNodes])

  useEffect(() => {
    window.localStorage.setItem(projectGraphKey(activeProject.id), JSON.stringify({ nodes, edges }))
  }, [activeProject.id, edges, nodes])

  useEffect(() => window.ollama.onGenerationProgress(setGenerationProgress), [])

  const onConnect = useCallback((connection: Connection) => {
    setEdges((currentEdges: Edge[]) => addEdge({ ...connection, animated: true }, currentEdges))
  }, [setEdges])
  const onNodeClick: NodeMouseHandler = (_, node) => setSelectedNodeId(node.id)
  const addNode = (template: typeof nodeTemplates[number], parentId?: string) => {
    nodeSequence.current += 1
    const childNodeCount = nodes.filter((node) => node.parentId === parentId).length
    const nextNode = createWorkflowNode(template, nodeSequence.current, childNodeCount, parentId)
    setNodes((currentNodes: WorkflowNode[]) => [...currentNodes, nextNode])
    setSelectedNodeId(nextNode.id)
  }

  const addSubgroup = (parentId?: string) => {
    nodeSequence.current += 1
    const subgroupCount = nodes.filter((node) => node.parentId === parentId && node.type === 'group').length
    const nextSubgroup = createWorkflowSubgroup(subgroupTemplate, nodeSequence.current, subgroupCount, parentId)
    setNodes((currentNodes: WorkflowNode[]) => [...currentNodes, nextSubgroup])
    setSelectedNodeId(nextSubgroup.id)
  }

  const updateNode = (field: 'label' | 'description' | 'kind', value: string) => {
    setNodes((currentNodes: WorkflowNode[]) => currentNodes.map((node: WorkflowNode) => (
      node.id === selectedNodeId ? { ...node, data: { ...node.data, [field]: value } } : node
    )))
  }

  const addApi = () => {
    if (!selectedNode || selectedNode.data.kind !== 'API layer' || !apiDraft.path.trim() || !apiDraft.description.trim()) return
    setNodes((currentNodes: WorkflowNode[]) => currentNodes.map((node) => node.id === selectedNode.id
      ? { ...node, data: { ...node.data, apis: [...(node.data.apis ?? []), { ...apiDraft, path: apiDraft.path.trim(), description: apiDraft.description.trim() }] } }
      : node))
    setApiDraft({ method: 'GET', path: '/api/items', description: '' })
  }

  const removeApi = (index: number) => {
    if (!selectedNode) return
    setNodes((currentNodes: WorkflowNode[]) => currentNodes.map((node) => node.id === selectedNode.id
      ? { ...node, data: { ...node.data, apis: (node.data.apis ?? []).filter((_, apiIndex) => apiIndex !== index) } }
      : node))
  }

  const generateCode = async () => {
    if (!modelId) {
      setGenerationState('error')
      setGenerationMessage('Install and select a local model before generating code.')
      return
    }
    setGenerationState('working')
    setGenerationMessage('Generating Java files with your local model…')
    setGenerationProgress({ phase: 'preparing', percent: 0, status: 'Starting generation…' })
    setGeneratedProject(null)
    setPreviewPath(null)
    setExportMessage('')
    try {
      const graph: GenerationGraph = { nodes, edges: edges.map((edge) => ({ source: edge.source, target: edge.target })) }
      const generationName = activeProject.name === 'Starter project' ? 'demo' : activeProject.name
      const result = await window.ollama.generateProject(modelId, generationName, graph)
      setGeneratedProject({ path: result.projectPath, files: result.files })
      setGenerationState('success')
      setGenerationMessage(result.editorOpened
        ? `Created ${result.files.length} files and opened ${generationName} in VS Code.`
        : `Created ${result.files.length} files in ${result.projectPath}. ${result.editorMessage ?? 'Open the folder manually.'}`)
    } catch (cause) {
      setGenerationState('error')
      setGenerationProgress({ phase: 'error', percent: 0, status: 'Generation failed.' })
      setGenerationMessage(cause instanceof Error ? cause.message : 'Code generation failed.')
    }
  }

  const createProject = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = projectName.trim()
    if (!name) return
    const project = { id: `${Date.now()}`, name, updatedAt: 'Just now' }
    setProjects((currentProjects) => [project, ...currentProjects])
    setProjectName('')
    setIsCreatingProject(false)
    setActiveProjectId(project.id)
    window.localStorage.setItem(projectGraphKey(project.id), JSON.stringify(starterGraph))
  }

  const selectedNode = nodes.find((node) => node.id === selectedNodeId)
  const activeGenerationStep = generationProgress
    ? generationProgress.percent >= 84 ? 5 : Math.min(4, Math.max(0, Math.floor((generationProgress.percent - 10) / 13)))
    : 0
  const previewFile = generatedProject?.files.find((file) => file.path === previewPath)
  const exportProject = async () => {
    if (!generatedProject) return
    try {
      const zipPath = await window.ollama.exportProjectZip(generatedProject.path)
      setExportMessage(`ZIP exported to ${zipPath}`)
    } catch (cause) {
      setExportMessage(cause instanceof Error ? cause.message : 'Could not export the project.')
    }
  }

  return (
    <div className="dashboard-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark">N</span><span>node<span className="brand-muted">/</span>code</span></div>
        <div className="topbar-context"><span className="status-dot" /> Local workspace <span className="topbar-divider">/</span> {activeProject.name}</div>
        <div className="topbar-actions">
          {onOpenChat && <button className="quiet-button" type="button" onClick={onOpenChat}>Open assistant</button>}
          <button className="avatar-button" type="button" aria-label="Open account menu">O</button>
        </div>
      </header>

      <div className="dashboard-body">
        <aside className="project-sidebar">
          <div className="sidebar-heading"><span>Projects</span><button className="icon-button" type="button" onClick={() => setIsCreatingProject(true)} aria-label="Create project">+</button></div>
          {isCreatingProject && (
            <form className="new-project-form" onSubmit={createProject}>
              <input autoFocus value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Project name" aria-label="Project name" />
              <div><button className="primary-small-button" type="submit">Create</button><button className="text-button" type="button" onClick={() => setIsCreatingProject(false)}>Cancel</button></div>
            </form>
          )}
          <nav className="project-list" aria-label="Projects">
            {projects.map((project) => <button className={`project-item ${project.id === activeProject.id ? 'project-item-active' : ''}`} key={project.id} type="button" onClick={() => setActiveProjectId(project.id)}><span className="project-icon">{project.name.slice(0, 1).toUpperCase()}</span><span><strong>{project.name}</strong><small>{project.updatedAt}</small></span></button>)}
          </nav>
          <div className="sidebar-footer"><span className="local-badge">●</span><span><strong>Local mode</strong><small>Private by default</small></span></div>
        </aside>

        <main className="workspace">
          <div className="workspace-header">
            <div><span className="eyebrow">Workspace / {activeProject.name}</span><h1>{activeProject.name}</h1><p>Design your app flow with connected, editable nodes.</p></div>
            <div className="workspace-actions"><button className="secondary-button" type="button" onClick={() => { setNodes(starterGraph.nodes); setEdges(starterGraph.edges) }}>Reset template</button><button className="primary-button" type="button" onClick={() => void generateCode()} disabled={generationState === 'working'}>{generationState === 'working' ? 'Generating…' : 'Generate code'}</button></div>
          </div>
          {generationMessage && <div className={`generation-message generation-${generationState}`} role="status">{generationMessage}</div>}
          {generationState === 'working' && generationProgress && <div className="generation-progress"><div className="generation-progress-row"><span>{generationProgress.status}</span><b>{generationProgress.percent}%</b></div><div className="generation-progress-track"><span style={{ width: `${generationProgress.percent}%` }} /></div>{generationProgress.totalFiles && <small>{generationProgress.filesWritten ?? 0} of {generationProgress.totalFiles} files written</small>}</div>}
          {generatedProject && <section className="generated-project-panel"><div className="generated-project-header"><div><span className="eyebrow">Generated project</span><strong>{generatedProject.files.length} files ready</strong></div><div className="generated-project-actions"><button className="secondary-button" type="button" onClick={() => void window.ollama.openProjectFolder(generatedProject.path)}>Open folder</button><button className="secondary-button" type="button" onClick={() => void exportProject()}>Export ZIP</button></div></div><div className="generated-file-list">{generatedProject.files.map((file) => <button className={`generated-file ${file.path === previewPath ? 'generated-file-active' : ''}`} type="button" key={file.path} onClick={() => setPreviewPath(file.path)}><span>◇</span>{file.path}</button>)}</div>{previewFile && <pre className="file-preview"><code>{previewFile.content}</code></pre>}{exportMessage && <p className="export-message">{exportMessage}</p>}</section>}
          <div className={`node-editor-stage ${generationState === 'working' ? 'node-editor-stage-busy' : ''}`}>
            <div className="node-editor-content"><NodeEditor nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={onNodeClick} onPaneClick={() => setSelectedNodeId(null)} onAddNode={addNode} onAddSubgroup={addSubgroup} /></div>
            {generationState === 'working' && generationProgress && <section className="generation-overlay" aria-live="polite" aria-label="Code generation progress">
              <div className="generation-overlay-header"><span className="generation-overlay-kicker">LLM code generation</span><span className="generation-overlay-percent">{generationProgress.percent}%</span></div>
              <h2>{generationProgress.status}</h2>
              <p>Each layer is generated in a fresh context and checked before the next step.</p>
              <ol className="generation-step-list">
                {generationSteps.map((step, index) => <li className={index < activeGenerationStep ? 'generation-step-complete' : index === activeGenerationStep ? 'generation-step-active' : ''} key={step.label}><span className="generation-step-marker">{index < activeGenerationStep ? '✓' : index + 1}</span><span><strong>{step.label}</strong><small>{step.detail}</small></span></li>)}
              </ol>
              <div className="generation-overlay-track"><span style={{ width: `${generationProgress.percent}%` }} /></div>
            </section>}
          </div>
        </main>

        <aside className="properties-panel">
          <div className="panel-heading"><span>Node properties</span><span className="panel-kicker">Inspector</span></div>
          {selectedNode ? (
            <div className="property-form">
              <div className="selected-node-label"><span className="node-type-dot" /> Editing node</div>
              <label>Node name<input value={String(selectedNode.data.label)} onChange={(event) => updateNode('label', event.target.value)} /></label>
              <label>Type<select value={String(selectedNode.data.kind)} onChange={(event) => updateNode('kind', event.target.value)}><option>Input</option><option>Logic</option><option>Output</option><option>API</option></select></label>
              <label>Description<textarea value={String(selectedNode.data.description)} onChange={(event) => updateNode('description', event.target.value)} rows={4} /></label>
              {selectedNode.data.kind === 'API layer' && <div className="api-editor"><div className="api-editor-heading">Controller APIs</div>{(selectedNode.data.apis ?? []).map((api, index) => <div className="api-item" key={`${api.method}-${api.path}-${index}`}><span><b>{api.method}</b> {api.path}<small>{api.description}</small></span><button type="button" onClick={() => removeApi(index)} aria-label={`Remove ${api.path}`}>×</button></div>)}<div className="api-draft"><select value={apiDraft.method} onChange={(event) => setApiDraft({ ...apiDraft, method: event.target.value })}><option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option></select><input value={apiDraft.path} onChange={(event) => setApiDraft({ ...apiDraft, path: event.target.value })} placeholder="/api/items" aria-label="API path" /><input value={apiDraft.description} onChange={(event) => setApiDraft({ ...apiDraft, description: event.target.value })} placeholder="What this API does" aria-label="API description" /><button className="primary-small-button" type="button" onClick={addApi}>Add API</button></div></div>}
              <button className="danger-button" type="button" onClick={() => { setNodes((current: WorkflowNode[]) => current.filter((node) => node.id !== selectedNode.id)); setSelectedNodeId(null) }}>Delete node</button>
            </div>
          ) : (
            <div className="empty-inspector"><div className="empty-icon">⌘</div><strong>Select a node to edit</strong><p>Click any node on the canvas to update its name, type, and description.</p></div>
          )}
          <div className="template-note"><span>✦</span><div><strong>Starter template</strong><p>This MVP flow is ready to customize. Add nodes by duplicating the existing pattern.</p></div></div>
        </aside>
      </div>
    </div>
  )
}
