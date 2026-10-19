import { useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  NodeResizer,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type NodeMouseHandler,
  type OnEdgesChange,
  type OnNodesChange,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { nodeTemplates, subgroupTemplate, type WorkflowNode } from './n2c-ui-node-handler/n2c-ui-node-handler-types'

export type NodeEditorProps = {
  nodes: WorkflowNode[]
  edges: Edge[]
  onNodesChange: OnNodesChange<WorkflowNode>
  onEdgesChange: OnEdgesChange<Edge>
  onConnect: (connection: Connection) => void
  onNodeClick: NodeMouseHandler
  onPaneClick: () => void
  onAddNode: (template: (typeof nodeTemplates)[number], parentId?: string) => void
  onAddSubgroup: (parentId?: string) => void
}

function ResizableGroupNode({ selected, data }: NodeProps<WorkflowNode>) {
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={190} minHeight={150} lineClassName="subgroup-resizer-line" handleClassName="subgroup-resizer-handle" />
      <div className="subgroup-node-label">{data.label}</div>
    </>
  )
}

const nodeTypes = { group: ResizableGroupNode }

export default function NodeEditor({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onPaneClick,
  onAddNode,
  onAddSubgroup,
}: NodeEditorProps) {
  const [showNodeMenu, setShowNodeMenu] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const addNode = (template: (typeof nodeTemplates)[number]) => {
    const selectedNode = nodes.find((node) => node.id === selectedNodeId)
    onAddNode(template, selectedNode?.type === 'group' ? selectedNode.id : undefined)
    setShowNodeMenu(false)
  }

  const addSubgroup = () => {
    const selectedNode = nodes.find((node) => node.id === selectedNodeId)
    onAddSubgroup(selectedNode?.type === 'group' ? selectedNode.id : undefined)
  }

  const handleNodeClick: NodeMouseHandler = (event, node) => {
    setSelectedNodeId(node.id)
    onNodeClick(event, node)
  }

  return (
    <section className={`flow-card ${isExpanded ? 'flow-card-expanded' : ''}`} aria-label="React Flow project editor">
      <div className="flow-toolbar">
        <span><span className="live-dot" /> Editing canvas</span>
        <span className="toolbar-hint">Horizontal subflow · Drag nodes · Connect handles</span>
        <div className="flow-toolbar-actions">
          <button className="secondary-button" type="button" onClick={() => setIsExpanded((current) => !current)} aria-label={isExpanded ? 'Exit fullscreen editor' : 'Expand editor'}>
            {isExpanded ? 'Exit fullscreen' : 'Expand editor'}
          </button>
          <button className="secondary-button" type="button" onClick={addSubgroup}>+ Create subgroup</button>
          <div className="add-node-wrap">
            <button className="secondary-button add-node-button" type="button" onClick={() => setShowNodeMenu((current) => !current)}>+ Add node</button>
            {showNodeMenu && <div className="add-node-menu"><button type="button" onClick={() => { addSubgroup(); setShowNodeMenu(false) }}>{subgroupTemplate.label}<small>Create a resizable group</small></button>{nodeTemplates.map((template) => <button key={template.kind} type="button" onClick={() => addNode(template)}>{template.label}<small>{template.kind}</small></button>)}</div>}
          </div>
        </div>
      </div>
      <div className="flow-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={handleNodeClick}
          onPaneClick={() => { setSelectedNodeId(null); onPaneClick() }}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          colorMode="dark"
        >
          <Background color="#6b4b8f" gap={18} size={1.5} variant={BackgroundVariant.Dots} />
          <Controls />
          <MiniMap nodeColor={(node: Node) => node.type === 'group' ? '#f472b6' : '#a78bfa'} maskColor="rgba(0, 0, 0, 0.78)" />
        </ReactFlow>
      </div>
    </section>
  )
}
