import { Position, type Edge, type Node } from '@xyflow/react'

export type ApiDefinition = { method: string; path: string; description: string }
export type WorkflowNodeData = { label: string; description: string; kind: string; apis?: ApiDefinition[] }
export type WorkflowNode = Node<WorkflowNodeData>
export type ProjectGraph = { nodes: WorkflowNode[]; edges: Edge[] }
export type NodeTemplate = Pick<WorkflowNodeData, 'kind' | 'label' | 'description'>

export const nodeTemplates: NodeTemplate[] = [
  { kind: 'API layer', label: 'Controller', description: 'Expose REST APIs and route requests' },
  { kind: 'Service', label: 'Service layer', description: 'Keep business logic and application rules' },
  { kind: 'Model', label: 'Model / Repository', description: 'Define entities and repository access' },
  { kind: 'Database', label: 'H2 database', description: 'Connect to the local H2 database' },
]

export const subgroupTemplate: NodeTemplate = { kind: 'Subgroup', label: 'New subgroup', description: 'A reusable group of related nodes' }

export const starterGraph: ProjectGraph = {
  nodes: [
    { id: 'h2-db', position: { x: 30, y: 150 }, sourcePosition: Position.Right, targetPosition: Position.Left, data: { label: 'H2_DB', description: 'Connect to the local H2 database', kind: 'Database' }, type: 'default' },
    { id: 'model-subgroup', type: 'group', position: { x: 300, y: 90 }, sourcePosition: Position.Right, targetPosition: Position.Left, style: { width: 240, height: 220 }, data: { label: 'Repo / model', description: 'Repository and model demo nodes', kind: 'Subgroup' } },
    { id: 'model-demo', position: { x: 20, y: 70 }, parentId: 'model-subgroup', extent: 'parent', sourcePosition: Position.Right, targetPosition: Position.Left, data: { label: 'Demo model', description: 'Example domain model', kind: 'Demo node' }, type: 'default' },
    { id: 'service-subgroup', type: 'group', position: { x: 600, y: 90 }, sourcePosition: Position.Right, targetPosition: Position.Left, style: { width: 240, height: 220 }, data: { label: 'Service layer', description: 'Business logic demo nodes', kind: 'Subgroup' } },
    { id: 'service-demo', position: { x: 20, y: 70 }, parentId: 'service-subgroup', extent: 'parent', sourcePosition: Position.Right, targetPosition: Position.Left, data: { label: 'Demo service', description: 'Example business operation', kind: 'Demo node' }, type: 'default' },
    { id: 'controller-subgroup', type: 'group', position: { x: 900, y: 90 }, sourcePosition: Position.Right, targetPosition: Position.Left, style: { width: 270, height: 220 }, data: { label: 'Controller', description: 'REST API nodes', kind: 'Subgroup' } },
    { id: 'controller-api', position: { x: 20, y: 70 }, parentId: 'controller-subgroup', extent: 'parent', sourcePosition: Position.Right, targetPosition: Position.Left, data: { label: 'GET /api/getall-users', description: 'List all users', kind: 'API node', apis: [{ method: 'GET', path: '/api/getall-users', description: 'List all users' }] }, type: 'default' },
    { id: 'main-file', position: { x: 1240, y: 150 }, sourcePosition: Position.Right, targetPosition: Position.Left, data: { label: 'Demo.java', description: 'Main entry point of project', kind: 'Main file' }, type: 'default' },
  ],
  edges: [
    { id: 'h2-model-demo', source: 'h2-db', target: 'model-demo', animated: true },
    { id: 'model-service-demo', source: 'model-demo', target: 'service-demo', animated: true },
    { id: 'service-controller-api', source: 'service-demo', target: 'controller-api', animated: true },
    { id: 'controller-api-main', source: 'controller-api', target: 'main-file', animated: true },
  ],
}
