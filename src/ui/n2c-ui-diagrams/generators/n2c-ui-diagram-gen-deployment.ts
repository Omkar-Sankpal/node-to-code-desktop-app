import { Position } from '@xyflow/react'
import type { ProjectGraph } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'
import type { DiagramData, DiagramGenerator, DiagramNode, DiagramEdge } from '../n2c-ui-diagram-types'
import { createDiagramId } from '../n2c-ui-diagram-types'

/** Deployment: server/container/DB boxes from infrastructure nodes */
export const deploymentGenerator: DiagramGenerator = {
  kind: 'deployment',
  generate(graph: ProjectGraph, projectName: string): DiagramData {
    const nodes: DiagramNode[] = []
    const edges: DiagramEdge[] = []

    // Client node
    nodes.push({
      id: 'dep-client', position: { x: 40, y: 160 }, type: 'diagramNode',
      sourcePosition: Position.Right, targetPosition: Position.Left,
      data: { label: 'Client / Browser', nodeStyle: 'external' },
    })

    // Application server
    nodes.push({
      id: 'dep-server', position: { x: 340, y: 80 }, type: 'diagramNode',
      sourcePosition: Position.Right, targetPosition: Position.Left,
      data: { label: `${projectName} Server`, stereotype: '«Spring Boot»', nodeStyle: 'server', description: `Hosts ${graph.nodes.filter(n => n.data.kind !== 'Subgroup' && n.data.kind !== 'Database').length} components` },
    })

    edges.push({ id: 'dep-e-client-server', source: 'dep-client', target: 'dep-server', type: 'smoothstep', data: { label: 'HTTPS' } })

    // Database nodes
    const dbNodes = graph.nodes.filter(n => n.data.kind === 'Database')
    let y = 80
    for (const db of dbNodes) {
      nodes.push({
        id: `dep-${db.id}`, position: { x: 680, y }, type: 'diagramNode',
        sourcePosition: Position.Right, targetPosition: Position.Left,
        data: { label: db.data.label, stereotype: '«database»', nodeStyle: 'database' },
      })
      edges.push({ id: `dep-e-server-${db.id}`, source: 'dep-server', target: `dep-${db.id}`, type: 'smoothstep', data: { label: 'JDBC' } })
      y += 140
    }

    if (dbNodes.length === 0) {
      nodes.push({
        id: 'dep-db', position: { x: 680, y: 160 }, type: 'diagramNode',
        sourcePosition: Position.Right, targetPosition: Position.Left,
        data: { label: 'Database', stereotype: '«H2/PostgreSQL»', nodeStyle: 'database' },
      })
      edges.push({ id: 'dep-e-server-db', source: 'dep-server', target: 'dep-db', type: 'smoothstep', data: { label: 'JDBC' } })
    }

    return {
      meta: { id: createDiagramId(), name: `${projectName} — Deployment`, kind: 'deployment', projectId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      nodes, edges,
    }
  },
}
