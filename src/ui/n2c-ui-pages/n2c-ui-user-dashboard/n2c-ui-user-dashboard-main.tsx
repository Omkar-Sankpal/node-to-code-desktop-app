import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react'
import type { GeneratedFile, GenerationGraph, GenerationProgress, ModelId, OllamaModelOption, SetupProgress, SpringDependency, SpringStructurePreview } from '../n2c-ui-user-onboarding/n2c-ui-user-onboarding-types'
import NodeEditor from '../../n2c-ui-node-editor/n2c-ui-node-editor-main'
import { createWorkflowNode, createWorkflowSubgroup, normalizeProjectGraph } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-main'
import { nodeTemplates, starterGraph, subgroupTemplate, type ApiDefinition, type ProjectGraph, type WorkflowNode } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'
import { dependencyList, designToGenerationGraph, designSystemPrompt, mapDesignToGraph, normalizeDesignResponse, parseDesignResponse, promptCharacterLimit, validatePromptProjectDesign } from './n2c-ui-prompt-project-design'
import type { PromptProjectDesign } from '../n2c-ui-user-onboarding/n2c-ui-user-onboarding-types'
import { useIDE } from '../../n2c-ui-ide/n2c-ui-ide-hooks'
import ActivityBar from '../../n2c-ui-ide/n2c-ui-ide-activity-bar'
import EditorTabs from '../../n2c-ui-ide/n2c-ui-ide-editor-tabs'
import BottomPanel from '../../n2c-ui-ide/n2c-ui-ide-bottom-panel'
import StatusBar from '../../n2c-ui-ide/n2c-ui-ide-status-bar'
import DiagramEditor from '../../n2c-ui-diagrams/n2c-ui-diagram-editor'
import NodeInspectorContracts from '../../n2c-ui-node-editor/n2c-ui-node-inspector/n2c-ui-inspector-main'

type Project = {
  id: string
  name: string
  updatedAt: string
}

function ProjectHome({
  projects,
  isCreatingProject,
  projectName,
  onProjectNameChange,
  onCreateProject,
  onCreateFromPrompt,
  onStartCreating,
  onCancelCreating,
  onOpenProject,
}: {
  projects: Project[]
  isCreatingProject: boolean
  projectName: string
  onProjectNameChange: (name: string) => void
  onCreateProject: (event: React.FormEvent<HTMLFormElement>) => void
  onCreateFromPrompt: (prompt: string) => void
  onStartCreating: () => void
  onCancelCreating: () => void
  onOpenProject: (projectId: string) => void
}) {
  const [search, setSearch] = useState('')
  const [homePrompt, setHomePrompt] = useState('')
  const visibleProjects = projects.filter((project) => project.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <main className="projects-home">
      <div className="projects-home-header">
        <div>
          <span className="eyebrow">Your workspace</span>
          <h1>Projects</h1>
          <p>Pick up where you left off or start something new.</p>
        </div>
        <button className="primary-button" type="button" onClick={onStartCreating}>+ New project</button>
      </div>
      <form className="home-prompt-panel" onSubmit={(event) => { event.preventDefault(); if (homePrompt.trim()) onCreateFromPrompt(homePrompt.trim()) }}>
        <div className="home-prompt-heading"><span className="ai-spark">✦</span><div><strong>Start with an idea</strong><span>Describe what you want to build and let local AI shape the first project flow.</span></div></div>
        <textarea value={homePrompt} onChange={(event) => setHomePrompt(event.target.value)} rows={3} placeholder="Example: Build a task management API with users, projects, comments, and PostgreSQL…" aria-label="Describe a new project" />
        <div className="home-prompt-footer"><small>{homePrompt.length}/{promptCharacterLimit} characters</small><button className="primary-button" type="submit" disabled={!homePrompt.trim()}>Create with AI ↗</button></div>
      </form>
      <div className="projects-home-toolbar">
        <label className="project-search">
          <span aria-hidden="true">⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects" aria-label="Search projects" />
        </label>
        <span className="project-count">{visibleProjects.length} {visibleProjects.length === 1 ? 'project' : 'projects'}</span>
      </div>
      {isCreatingProject && (
        <form className="home-new-project-form" onSubmit={onCreateProject}>
          <div><strong>Create a project</strong><span>Give your workspace a name to get started.</span></div>
          <input autoFocus value={projectName} onChange={(event) => onProjectNameChange(event.target.value)} placeholder="Project name" aria-label="Project name" />
          <button className="primary-button" type="submit">Create project</button>
          <button className="text-button" type="button" onClick={onCancelCreating}>Cancel</button>
        </form>
      )}
      {visibleProjects.length > 0 ? (
        <div className="project-card-grid">
          {visibleProjects.map((project, index) => (
            <button className="project-card" key={project.id} type="button" onClick={() => onOpenProject(project.id)}>
              <span className={`project-card-preview project-card-preview-${index % 4}`}><span className="preview-orbit" /><span className="preview-node preview-node-one" /><span className="preview-node preview-node-two" /><span className="preview-node preview-node-three" /></span>
              <span className="project-card-info"><span><strong>{project.name}</strong><small>Updated {project.updatedAt.toLowerCase()}</small></span><span className="project-card-arrow" aria-hidden="true">↗</span></span>
            </button>
          ))}
        </div>
      ) : (
        <div className="projects-empty"><span className="empty-icon">◇</span><strong>No projects found</strong><p>Try a different search or create your first project.</p><button className="secondary-button" type="button" onClick={onStartCreating}>Create a project</button></div>
      )}
    </main>
  )
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

const springInitializerDependencyOptions: SpringDependency[] = [
  { groupId: 'org.springframework.boot', artifactId: 'spring-boot-starter-web', scope: 'compile' },
  { groupId: 'org.springframework.boot', artifactId: 'spring-boot-starter-data-jpa', scope: 'compile' },
  { groupId: 'org.springframework.boot', artifactId: 'spring-boot-starter-validation', scope: 'compile' },
  { groupId: 'org.springframework.boot', artifactId: 'spring-boot-starter-security', scope: 'compile' },
  { groupId: 'org.springframework.boot', artifactId: 'spring-boot-starter-actuator', scope: 'compile' },
  { groupId: 'org.projectlombok', artifactId: 'lombok', scope: 'provided' },
  { groupId: 'com.h2database', artifactId: 'h2', scope: 'runtime' },
  { groupId: 'org.postgresql', artifactId: 'postgresql', scope: 'runtime' },
  { groupId: 'com.mysql', artifactId: 'mysql-connector-j', scope: 'runtime' },
  { groupId: 'org.springframework.boot', artifactId: 'spring-boot-starter-test', scope: 'test' },
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

type StructureTreeNode = { name: string; path: string; children: StructureTreeNode[] }

function buildStructureTree(directories: string[]): StructureTreeNode[] {
  const roots: StructureTreeNode[] = []
  for (const directory of directories) {
    let level = roots
    let currentPath = ''
    for (const name of directory.split('/').filter(Boolean)) {
      currentPath = currentPath ? `${currentPath}/${name}` : name
      let node = level.find((candidate) => candidate.name === name)
      if (!node) {
        node = { name, path: currentPath, children: [] }
        level.push(node)
      }
      level = node.children
    }
  }
  const sortNodes = (nodesToSort: StructureTreeNode[]) => nodesToSort.sort((left, right) => left.name.localeCompare(right.name)).forEach((node) => sortNodes(node.children))
  return sortNodes(roots), roots
}

function StructureTreeItem({ node }: { node: StructureTreeNode }) {
  const [expanded, setExpanded] = useState(true)
  return (
    <li className="structure-tree-item">
      <button type="button" className="structure-tree-row" aria-expanded={node.children.length ? expanded : undefined} onClick={() => node.children.length && setExpanded((current) => !current)}>
        <span className={`structure-tree-chevron ${node.children.length ? '' : 'structure-tree-chevron-empty'}`} aria-hidden="true" />
        <span className="structure-tree-folder" aria-hidden="true" />
        <strong>{node.name}</strong>
      </button>
      {expanded && node.children.length > 0 && <ul>{node.children.map((child) => <StructureTreeItem key={child.path} node={child} />)}</ul>}
    </li>
  )
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

export default function UserDashboard({ onOpenChat, modelId, onModelChange }: { onOpenChat?: () => void; modelId?: ModelId; onModelChange?: (modelId: ModelId) => void }) {
  const [projects, setProjects] = useState(readSavedProjects)
  const [activeProjectId, setActiveProjectId] = useState(projects[0].id)
  const [isProjectOpen, setIsProjectOpen] = useState(false)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0]
  const savedGraph = useMemo(() => readGraph(activeProject.id), [activeProject.id])
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>(savedGraph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(savedGraph.edges)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [designPrompt, setDesignPrompt] = useState('')
  const [promptDesign, setPromptDesign] = useState<PromptProjectDesign | null>(null)
  const [promptState, setPromptState] = useState<'idle' | 'analyzing' | 'error'>('idle')
  const [promptError, setPromptError] = useState('')
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [apiDraft, setApiDraft] = useState<ApiDefinition>({ method: 'GET', path: '/api/items', description: '' })
  const [generationState, setGenerationState] = useState<'idle' | 'working' | 'success' | 'error'>('idle')
  const [generationMessage, setGenerationMessage] = useState('')
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null)
  const [structurePreview, setStructurePreview] = useState<SpringStructurePreview | null>(null)
  const [dependencySetupOpen, setDependencySetupOpen] = useState(false)
  const [initializerDependencies, setInitializerDependencies] = useState<SpringDependency[]>(springInitializerDependencyOptions.slice(0, 3))
  const [generatedProject, setGeneratedProject] = useState<{ path: string; files: GeneratedFile[] } | null>(null)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState('')
  const [modelSwitcherOpen, setModelSwitcherOpen] = useState(false)
  const [modelLibrary, setModelLibrary] = useState<OllamaModelOption[]>([])
  const [modelSearch, setModelSearch] = useState('')
  const [modelDownloadBusy, setModelDownloadBusy] = useState(false)
  const [modelDownloadProgress, setModelDownloadProgress] = useState<SetupProgress | null>(null)
  const [modelDownloadingTag, setModelDownloadingTag] = useState<string | null>(null)
  const [modelError, setModelError] = useState('')
  const nodeSequence = useRef(0)
  const lastGenerationPercent = useRef(0)
  const ide = useIDE()

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

  useEffect(() => window.ollama.onGenerationProgress((progress) => {
    const percent = Math.max(lastGenerationPercent.current, Math.min(100, progress.percent))
    lastGenerationPercent.current = percent
    setGenerationProgress({ ...progress, percent })
  }), [])

  useEffect(() => window.ollama.onProgress((progress) => {
    if (progress.phase === 'downloading-model' || progress.phase === 'ready') setModelDownloadProgress(progress)
  }), [])

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

  const updateNode = (field: string, value: unknown) => {
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

  const toggleInitializerDependency = (dependency: SpringDependency) => {
    setInitializerDependencies((current) => current.some((item) => item.groupId === dependency.groupId && item.artifactId === dependency.artifactId)
      ? current.filter((item) => item.groupId !== dependency.groupId || item.artifactId !== dependency.artifactId)
      : [...current, dependency])
  }

  const analyzePrompt = async (promptOverride?: string) => {
    const prompt = (promptOverride ?? designPrompt).trim()
    if (!prompt) {
      setPromptState('error')
      setPromptError('Describe the project you want to generate first.')
      return
    }

    if (prompt.length > promptCharacterLimit) {
      setPromptState('error')
      setPromptError(`Keep the project description within ${promptCharacterLimit} characters.`)
      return
    }
    if (!modelId) {
      setPromptState('error')
      setPromptError('Install and select a local model before analyzing a prompt.')
      return
    }
    setPromptState('analyzing')
    setPromptError('')
    try {
      const firstResponse = await window.ollama.chat(modelId, [
        { role: 'system', content: designSystemPrompt },
        { role: 'user', content: prompt },
      ])
      let design: PromptProjectDesign
      try {
        design = validatePromptProjectDesign(normalizeDesignResponse(parseDesignResponse(firstResponse.message.content)))
      } catch (validationCause) {
        const validationMessage = validationCause instanceof Error ? validationCause.message : 'The response did not match the design schema.'
        const repairResponse = await window.ollama.chat(modelId, [
          { role: 'system', content: `${designSystemPrompt}\nRepair the supplied response. Return corrected JSON only. The hard limits are at most 80 nodes and 160 edges. Combine related items rather than dropping required Spring Boot layers.` },
          { role: 'user', content: `Invalid response:\n${firstResponse.message.content}\nValidation errors:\n${validationMessage}` },
        ])
        design = validatePromptProjectDesign(normalizeDesignResponse(parseDesignResponse(repairResponse.message.content)))
      }
      const graph = mapDesignToGraph(design)
      setPromptDesign(design)
      setNodes(graph.nodes)
      setEdges(graph.edges)
      const selectedDependencies = dependencyList(design.dependencies)
      if (selectedDependencies.length) setInitializerDependencies(selectedDependencies)
      setPromptState('idle')
      setGenerationState('idle')
      setGenerationMessage(`Design ready: ${graph.nodes.length} nodes and ${graph.edges.length} connections. Review the canvas before generating code.`)
    } catch (cause) {
      setPromptState('error')
      setPromptError(cause instanceof Error ? cause.message : 'The local model could not create a valid project design.')
    }
  }

  const resetPromptDesign = () => {
    setPromptDesign(null)
    setDesignPrompt('')
    setPromptError('')
    setPromptState('idle')
    setGenerationMessage('')
  }

  const generateCode = async () => {
    if (!modelId) {
      setGenerationState('error')
      setGenerationMessage('Install and select a local model before generating code.')
      return
    }
    setDependencySetupOpen(true)
    setGenerationState('idle')
    setGenerationMessage('Choose the dependencies for your Spring Initializr starter.')
  }

  const confirmDependencies = async () => {
    const generationName = promptDesign?.projectName || (activeProject.name === 'Starter project' ? 'demo' : activeProject.name)
    setDependencySetupOpen(false)
    setGenerationState('working')
    lastGenerationPercent.current = 0
    setGenerationProgress({ phase: 'preparing', percent: 0, status: 'Downloading Spring Initializr starter…' })
    try {
      const preview = await window.ollama.prepareProject(generationName, initializerDependencies)
      setStructurePreview(preview)
      setGenerationMessage('Spring Initializr created the starter. Review its directories before generating code.')
    } catch (cause) {
      setGenerationState('error')
      setGenerationMessage(cause instanceof Error ? cause.message : 'Could not create the Spring Initializr project.')
      setDependencySetupOpen(true)
    }
  }

  const confirmStructure = async () => {
    if (!modelId || !structurePreview) return
    setStructurePreview(null)
    setGenerationState('working')
    setGenerationMessage('Generating Java files with your local model…')
    lastGenerationPercent.current = 0
    setGenerationProgress({ phase: 'preparing', percent: 0, status: 'Starting generation…' })
    setGeneratedProject(null)
    setPreviewPath(null)
    setExportMessage('')
    try {
      const graph: GenerationGraph = promptDesign
        ? designToGenerationGraph({ nodes, edges })
        : { nodes, edges: edges.map((edge) => ({ source: edge.source, target: edge.target })) }
      const generationName = promptDesign?.projectName || (activeProject.name === 'Starter project' ? 'demo' : activeProject.name)
      const { projectPath, ...structure } = structurePreview
      const result = await window.ollama.generateProject(modelId, generationName, graph, projectPath, structure)
      setGeneratedProject({ path: result.projectPath, files: result.files })
      setGenerationState('success')
      setGenerationMessage(result.editorOpened
        ? `Created ${result.files.length} files and opened ${generationName} in VS Code.`
        : `Created ${result.files.length} files in ${result.projectPath}. ${result.editorMessage ?? 'Open the folder manually.'}`)
    } catch (cause) {
      setGenerationState('error')
      setGenerationProgress({ phase: 'error', percent: lastGenerationPercent.current, status: 'Generation failed.' })
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
    setIsProjectOpen(true)
    window.localStorage.setItem(projectGraphKey(project.id), JSON.stringify(starterGraph))
  }

  const createProjectFromPrompt = (prompt: string) => {
    const firstLine = prompt.split(/[.!?\n]/)[0].trim()
    const name = (firstLine || `Project ${projects.length + 1}`).slice(0, 38)
    const project = { id: `${Date.now()}`, name, updatedAt: 'Just now' }
    setProjects((currentProjects) => [project, ...currentProjects])
    setProjectName('')
    setIsCreatingProject(false)
    setActiveProjectId(project.id)
    setDesignPrompt(prompt)
    setIsProjectOpen(true)
    if (modelId) void analyzePrompt(prompt)
    window.localStorage.setItem(projectGraphKey(project.id), JSON.stringify(starterGraph))
  }

  const selectedNode = nodes.find((node) => node.id === selectedNodeId)
  const activeGenerationStep = generationProgress
    ? Math.min(5, Math.max(0, Math.floor(((generationProgress.percent - 10) / 65) * generationSteps.length)))
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
  const openModelSwitcher = async () => {
      setModelSwitcherOpen(true)
      setModelError('')
      try {
        setModelLibrary(await window.ollama.getModelLibrary())
      } catch (cause) {
        setModelError(cause instanceof Error ? cause.message : 'Could not load the Ollama model library.')
      }
    }
    const downloadAndSelectModel = async (tag: string) => {
      setModelDownloadBusy(true)
      setModelDownloadingTag(tag)
      setModelDownloadProgress({ phase: 'downloading-model', percent: 0, status: `Preparing ${tag}…` })
      setModelError('')
      try {
        const result = await window.ollama.pullModel(tag)
        if (result.cancelled) return
        if (!result.success) throw new Error(result.error ?? 'Model download failed.')
        onModelChange?.(tag)
        setModelLibrary((current) => current.map((model) => model.tag === tag ? { ...model, installed: true } : model))
      } catch (cause) {
        setModelError(cause instanceof Error ? cause.message : 'Model download failed.')
      } finally {
        setModelDownloadBusy(false)
        setModelDownloadingTag(null)
      }
    }
  const deleteInstalledModel = async (model: OllamaModelOption) => {
    if (!window.confirm(`Delete ${model.tag} from Ollama? You can download it again later.`)) return
    setModelError('')
    try {
      const result = await window.ollama.deleteModel(model.tag)
      if (!result.success) throw new Error(result.error ?? 'Model deletion failed.')
      setModelLibrary((current) => current.map((item) => item.tag === model.tag ? { ...item, installed: false } : item))
      if (model.tag === modelId) setModelError('The active model was deleted. Download or select another installed model before generating code.')
    } catch (cause) {
      setModelError(cause instanceof Error ? cause.message : 'Model deletion failed.')
    }
  }
  const cancelModelDownload = async () => {
    if (!modelDownloadBusy) return
    await window.ollama.cancelSetup()
    setModelError('')
  }
  const visibleModels = modelLibrary.filter((model) => `${model.name} ${model.tag} ${model.description}`.toLowerCase().includes(modelSearch.toLowerCase()))

  return (
    <div className="dashboard-shell">
      <header className="topbar">
        <button className="brand-lockup brand-home-button" type="button" onClick={() => setIsProjectOpen(false)} aria-label="Back to projects home"><span className="brand-mark">N</span><span>node<span className="brand-muted">/</span>code</span></button>
        <div className="topbar-context"><span className="status-dot" /> Local workspace <span className="topbar-divider">/</span> {isProjectOpen ? activeProject.name : 'Projects'}</div>
        <div className="topbar-actions">
          <button className="model-switcher-button" type="button" onClick={() => void openModelSwitcher()}><span className="model-switcher-dot" />{modelId ?? 'No model'}<span className="model-switcher-caret">⌄</span></button>
          {onOpenChat && <button className="quiet-button" type="button" onClick={onOpenChat}>Open assistant</button>}
          <button className="avatar-button" type="button" aria-label="Open account menu">O</button>
        </div>
        {modelSwitcherOpen && <div className="model-switcher-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !modelDownloadBusy && setModelSwitcherOpen(false)}><section className="model-switcher-panel" role="dialog" aria-modal="true" aria-labelledby="model-switcher-title"><div className="model-switcher-header"><div><span className="eyebrow">Local Ollama models</span><h2 id="model-switcher-title">Change model</h2><p>Download one model at a time, then use it for chat and code generation.</p></div><button className="text-button" type="button" onClick={() => !modelDownloadBusy && setModelSwitcherOpen(false)}>Close</button></div><input className="model-search" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search models or enter a tag below" aria-label="Search Ollama models" disabled={modelDownloadBusy} />{modelDownloadBusy && modelDownloadProgress && <div className="model-download-progress"><div className="model-download-progress-row"><span>Downloading {modelDownloadingTag}</span><b>{modelDownloadProgress.percent}%</b></div><div className="generation-progress-track"><span style={{ width: `${modelDownloadProgress.percent}%` }} /></div><small>{modelDownloadProgress.status}{modelDownloadProgress.total ? ` · ${Math.round((modelDownloadProgress.completed ?? 0) / 1024 ** 2)} MB of ${Math.round(modelDownloadProgress.total / 1024 ** 2)} MB` : ''}</small><button className="danger-button" type="button" onClick={() => void cancelModelDownload()}>Cancel download</button></div>}<div className="model-library-list">{visibleModels.map((model) => <div className={        `model-library-item ${model.tag === modelId ? 'model-library-item-active' : ''} ${model.available === false ? 'model-library-item-unavailable' : ''}`} key={model.tag}><div><strong>{model.name}</strong><small>{model.description}</small>        <small>{model.tag} · {model.minimumRamGb} GB RAM · about {model.recommendedStorageGb} GB storage</small>{model.available === false && <small className="model-unavailable-reason">{model.unavailableReason}</small>}</div><div className="model-library-actions">{model.installed ? <><button className="secondary-button" type="button" onClick={() => { onModelChange?.(model.tag); setModelSwitcherOpen(false) }} disabled={modelDownloadBusy || model.available === false}>{model.tag === modelId ? 'Selected' : 'Use model'}</button><button className="danger-button" type="button" onClick={() => void deleteInstalledModel(model)} disabled={modelDownloadBusy}>Delete</button></> : <button className="primary-small-button" type="button" onClick={() => void downloadAndSelectModel(model.tag)} disabled={modelDownloadBusy || model.available === false}>{modelDownloadBusy ? 'Downloading…' : 'Download'}</button>}</div></div>)}</div><form className="custom-model-form" onSubmit={(event) => { event.preventDefault(); const tag = modelSearch.trim(); if (tag) void downloadAndSelectModel(tag) }}><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Any Ollama tag, e.g. qwen3:14b" aria-label="Custom Ollama model tag" disabled={modelDownloadBusy} /><button className="secondary-button" type="submit" disabled={modelDownloadBusy || !modelSearch.trim()}>Download tag</button></form>{modelError && <p className="model-switcher-error" role="alert">{modelError}</p>}</section></div>}
      </header>
      <ActivityBar />

      {dependencySetupOpen && <div className="model-switcher-backdrop"><section className="model-switcher-panel dependency-setup-panel" role="dialog" aria-modal="true" aria-labelledby="initializer-title"><div className="model-switcher-header"><div><span className="eyebrow">Step 1 of 3 · Spring Initializr</span><h2 id="initializer-title">Choose starter dependencies</h2><p>These dependencies are sent directly to start.spring.io.</p></div><button className="text-button" type="button" onClick={() => setDependencySetupOpen(false)}>Cancel</button></div>{generationState === 'error' && <p className="generation-message generation-error" role="alert">{generationMessage}</p>}<div className="initializer-dependency-list">{springInitializerDependencyOptions.map((dependency) => { const selected = initializerDependencies.some((item) => item.groupId === dependency.groupId && item.artifactId === dependency.artifactId); return <label className={`initializer-dependency-option ${selected ? 'initializer-dependency-option-selected' : ''}`} key={`${dependency.groupId}:${dependency.artifactId}`}><input type="checkbox" checked={selected} onChange={() => toggleInitializerDependency(dependency)} /><span><strong>{dependency.artifactId}</strong><small>{dependency.groupId}{dependency.scope ? ` · ${dependency.scope}` : ''}</small></span></label> })}</div><div className="structure-preview-actions"><button className="secondary-button" type="button" onClick={() => setDependencySetupOpen(false)}>Cancel</button><button className="primary-button" type="button" onClick={() => void confirmDependencies()} disabled={!initializerDependencies.length}>Try again</button></div></section></div>}

      {isProjectOpen ? <div className="dashboard-body" style={{ gridTemplateColumns: `${ide.sidebarCollapsed ? '0px' : '218px'} minmax(0, 1fr) ${ide.inspectorCollapsed ? '0px' : '252px'}` }}>
        {!ide.sidebarCollapsed && <aside className="project-sidebar">
          <div className="sidebar-heading"><span>Projects</span><button className="icon-button" type="button" onClick={() => setIsCreatingProject(true)} aria-label="Create project">+</button></div>
          {isCreatingProject && (
            <form className="new-project-form" onSubmit={createProject}>
              <input autoFocus value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Project name" aria-label="Project name" />
              <div><button className="primary-small-button" type="submit">Create</button><button className="text-button" type="button" onClick={() => setIsCreatingProject(false)}>Cancel</button></div>
            </form>
          )}
          <nav className="project-list" aria-label="Projects">
            {projects.map((project) => <button className={`project-item ${project.id === activeProject.id ? 'project-item-active' : ''}`} key={project.id} type="button" onClick={() => { setActiveProjectId(project.id); setIsProjectOpen(true) }}><span className="project-icon">{project.name.slice(0, 1).toUpperCase()}</span><span><strong>{project.name}</strong><small>{project.updatedAt}</small></span></button>)}
          </nav>
          <div className="sidebar-footer"><span className="local-badge">●</span><span><strong>Local mode</strong><small>Private by default</small></span></div>
        </aside>}

        <main className="workspace">
          <EditorTabs />
          {ide.activeView === 'diagrams' ? (
            <DiagramEditor projectId={activeProject.id} projectName={activeProject.name} projectGraph={{ nodes, edges }} />
          ) : (
          <div className="workspace-scroll">
          <div className="workspace-header">
            <div><span className="eyebrow">Workspace / {activeProject.name}</span><h1>{activeProject.name}</h1><p>Design your app flow with connected, editable nodes.</p></div>
            <div className="workspace-actions"><button className="secondary-button" type="button" onClick={() => setIsProjectOpen(false)}>← All projects</button><button className="secondary-button" type="button" onClick={() => { setNodes(starterGraph.nodes); setEdges(starterGraph.edges) }}>Reset template</button><button className="primary-button" type="button" onClick={() => void generateCode()} disabled={generationState === 'working' || Boolean(structurePreview)}>{generationState === 'working' ? 'Generating…' : 'Generate code'}</button></div>
          </div>
          <section className="prompt-generator-panel" aria-labelledby="prompt-generator-title">
            <div className="prompt-generator-header"><div><span className="eyebrow">Step 1 · Spring Boot project design</span><h2 id="prompt-generator-title">Generate from a prompt</h2><p>Describe the application and let your local model create an editable Spring Boot layer and subgroup structure.</p></div>{promptDesign && <button className="text-button" type="button" onClick={resetPromptDesign}>Reset design</button>}</div>
            <textarea value={designPrompt} onChange={(event) => { setDesignPrompt(event.target.value); if (promptState === 'error') setPromptState('idle') }} maxLength={promptCharacterLimit} rows={3} placeholder="Example: Create an e-commerce backend with users, products, orders, PostgreSQL, authentication, and REST APIs." aria-label="Project description" disabled={promptState === 'analyzing'} />
            <div className="prompt-generator-actions"><small>{designPrompt.length}/{promptCharacterLimit} characters</small><div><button className="secondary-button" type="button" onClick={() => setDesignPrompt('Create an e-commerce backend with user authentication, product management, shopping cart, order processing, PostgreSQL, and REST APIs.')} disabled={promptState === 'analyzing'}>Use example</button><button className="primary-button" type="button" onClick={() => void analyzePrompt()} disabled={promptState === 'analyzing' || !designPrompt.trim()}>{promptState === 'analyzing' ? 'Analyzing…' : 'Analyze prompt'}</button></div></div>
            <AnimatePresence>
              {promptState === 'analyzing' && <motion.div className="ai-thinking-panel" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: .25 }}><div className="ai-thinking-orbit"><span /><span /><span /></div><div><strong>Local AI is mapping your idea</strong><p>Reviewing architecture, dependencies, and connections<span className="thinking-dots">...</span></p></div></motion.div>}
            </AnimatePresence>
            {promptError && <p className="generation-message generation-error" role="alert">{promptError}</p>}
            {promptDesign && <div className="prompt-design-summary"><strong>{promptDesign.projectName}</strong><span>Spring Boot · {promptDesign.architecture} · {promptDesign.nodes.length} analyzed nodes · {promptDesign.edges.length} connections</span><p>{promptDesign.summary}</p>{promptDesign.assumptions.length > 0 && <small>Assumptions: {promptDesign.assumptions.join(' ')}</small>}{promptDesign.clarificationQuestions.length > 0 && <small className="prompt-clarifications">Questions to review: {promptDesign.clarificationQuestions.join(' ')}</small>}</div>}
          </section>
          {generationMessage && <div className={`generation-message generation-${generationState}`} role="status">{generationMessage}</div>}
          {generationState === 'working' && generationProgress && !structurePreview && <div className="generation-progress"><div className="generation-progress-row"><span>{generationProgress.status}</span><b>{generationProgress.percent}%</b></div><div className="generation-progress-track"><span style={{ width: `${generationProgress.percent}%` }} /></div>{generationProgress.totalFiles && <small>{generationProgress.filesWritten ?? 0} of {generationProgress.totalFiles} files written</small>}</div>}
          {generatedProject && <section className="generated-project-panel"><div className="generated-project-header"><div><span className="eyebrow">Generated project</span><strong>{generatedProject.files.length} files ready</strong></div><div className="generated-project-actions"><button className="secondary-button" type="button" onClick={() => void window.ollama.openProjectFolder(generatedProject.path)}>Open folder</button><button className="secondary-button" type="button" onClick={() => void exportProject()}>Export ZIP</button></div></div><div className="generated-file-list">{generatedProject.files.map((file) => <button className={`generated-file ${file.path === previewPath ? 'generated-file-active' : ''}`} type="button" key={file.path} onClick={() => setPreviewPath(file.path)}><span>◇</span>{file.path}</button>)}</div>{previewFile && <pre className="file-preview"><code>{previewFile.content}</code></pre>}{exportMessage && <p className="export-message">{exportMessage}</p>}</section>}
          <div className={`node-editor-stage ${generationState === 'working' ? 'node-editor-stage-busy' : ''}`}>
            <div className="node-editor-content"><NodeEditor nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={onNodeClick} onPaneClick={() => setSelectedNodeId(null)} onAddNode={addNode} onAddSubgroup={addSubgroup} /></div>
            {structurePreview && <section className="generation-overlay structure-preview-overlay" role="dialog" aria-labelledby="structure-preview-title"><div className="structure-preview-header"><div>            <span className="eyebrow">Step 2 of 3 · Spring Initializr</span><h2 id="structure-preview-title">Review generated starter</h2><p>This directory tree comes from Spring Initializr. Confirm it before the LLM generates graph-specific files.</p></div><button className="text-button" type="button" onClick={() => { setStructurePreview(null); setGenerationState('idle'); setGenerationProgress(null) }}>Cancel</button></div><div className="structure-preview-path">{structurePreview.projectPath}<br /><span>Package: {structurePreview.packageName}</span></div><ul className="structure-preview-tree">{buildStructureTree(structurePreview.directories).map((node) => <StructureTreeItem key={node.path} node={node} />)}</ul>            <div className="dependency-editor"><strong>Dependencies installed by Spring Initializr</strong>{structurePreview.dependencies.map((dependency) => <div className="dependency-row" key={`${dependency.groupId}:${dependency.artifactId}`}><span>{dependency.groupId}:{dependency.artifactId}{dependency.scope ? ` (${dependency.scope})` : ''}</span></div>)}</div><div className="structure-preview-actions"><button className="secondary-button" type="button" onClick={() => { setStructurePreview(null); setGenerationState('idle'); setGenerationProgress(null) }}>Cancel</button><button className="primary-button" type="button" onClick={() => void confirmStructure()}>Confirm and continue</button></div></section>}
            {generationState === 'working' && generationProgress && !structurePreview && <section className="generation-overlay" aria-live="polite" aria-label="Code generation progress">
              <div className="generation-overlay-header"><span className="generation-overlay-kicker">LLM code generation</span><span className="generation-overlay-percent">{generationProgress.percent}%</span></div>
              <h2>{generationProgress.status}</h2>
              <p>Each layer is generated in a fresh context and checked before the next step.</p>
              <ol className="generation-step-list">
                {generationSteps.map((step, index) => <li className={index < activeGenerationStep ? 'generation-step-complete' : index === activeGenerationStep ? 'generation-step-active' : ''} key={step.label}><span className="generation-step-marker">{index < activeGenerationStep ? '✓' : index + 1}</span><span><strong>{step.label}</strong><small>{step.detail}</small></span></li>)}
              </ol>
              <div className="generation-overlay-track"><span style={{ width: `${generationProgress.percent}%` }} /></div>
            </section>}
          </div>
          </div>
          )}
          <BottomPanel />
        </main>

        {!ide.inspectorCollapsed && <aside className="properties-panel">
          <div className="panel-heading"><span>Node properties</span><span className="panel-kicker">Inspector</span></div>
          {selectedNode ? (
            <div className="property-form">
              <div className="selected-node-label"><span className="node-type-dot" /> Editing node</div>
              <label>Node name<input value={String(selectedNode.data.label)} onChange={(event) => updateNode('label', event.target.value)} /></label>
              <label>Type<select value={String(selectedNode.data.kind)} onChange={(event) => updateNode('kind', event.target.value)}><option>Input</option><option>Logic</option><option>Output</option><option>API</option></select></label>
              <label>Description<textarea value={String(selectedNode.data.description)} onChange={(event) => updateNode('description', event.target.value)} rows={4} /></label>
              {selectedNode.data.kind === 'API layer' && <div className="api-editor"><div className="api-editor-heading">Controller APIs</div>{(selectedNode.data.apis ?? []).map((api, index) => <div className="api-item" key={`${api.method}-${api.path}-${index}`}><span><b>{api.method}</b> {api.path}<small>{api.description}</small></span><button type="button" onClick={() => removeApi(index)} aria-label={`Remove ${api.path}`}>×</button></div>)}<div className="api-draft"><select value={apiDraft.method} onChange={(event) => setApiDraft({ ...apiDraft, method: event.target.value })}><option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option></select><input value={apiDraft.path} onChange={(event) => setApiDraft({ ...apiDraft, path: event.target.value })} placeholder="/api/items" aria-label="API path" /><input value={apiDraft.description} onChange={(event) => setApiDraft({ ...apiDraft, description: event.target.value })} placeholder="What this API does" aria-label="API description" /><button className="primary-small-button" type="button" onClick={addApi}>Add API</button></div></div>}
              <NodeInspectorContracts data={selectedNode.data} onUpdate={(key, value) => updateNode(key, value)} />
              <button className="danger-button" type="button" onClick={() => { setNodes((current: WorkflowNode[]) => current.filter((node) => node.id !== selectedNode.id)); setSelectedNodeId(null) }}>Delete node</button>
            </div>
          ) : (
            <div className="empty-inspector"><div className="empty-icon">⌘</div><strong>Select a node to edit</strong><p>Click any node on the canvas to update its name, type, and description.</p></div>
          )}
          <div className="template-note"><span>✦</span><div><strong>Starter template</strong><p>This MVP flow is ready to customize. Add nodes by duplicating the existing pattern.</p></div></div>
        </aside>}
      </div> : <div className="ide-home-wrapper"><EditorTabs /><ProjectHome projects={projects} isCreatingProject={isCreatingProject} projectName={projectName} onProjectNameChange={setProjectName} onCreateProject={createProject} onCreateFromPrompt={createProjectFromPrompt} onStartCreating={() => setIsCreatingProject(true)} onCancelCreating={() => setIsCreatingProject(false)} onOpenProject={(projectId) => { setActiveProjectId(projectId); setIsProjectOpen(true) }} /><BottomPanel /></div>}
      <StatusBar modelId={modelId} projectName={isProjectOpen ? activeProject.name : undefined} />
    </div>
  )
}
