import { Position } from '@xyflow/react'
import type { ProjectGraph } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'
import type { DiagramData, DiagramGenerator, DiagramNode, DiagramEdge } from '../n2c-ui-diagram-types'
import { createDiagramId } from '../n2c-ui-diagram-types'

/** Actor → use case per API endpoint from controller nodes */
export const useCaseGenerator: DiagramGenerator = {
  kind: 'use-case',
  generate(graph: ProjectGraph, projectName: string): DiagramData {
    const nodes: DiagramNode[] = []
    const edges: DiagramEdge[] = []

    // Actor node
    nodes.push({
      id: 'uc-actor', position: { x: 40, y: 140 }, type: 'diagramNode',
      sourcePosition: Position.Right, targetPosition: Position.Left,
      data: { label: 'User', nodeStyle: 'actor' },
    })

    const apiNodes = graph.nodes.filter(n => n.data.apis && n.data.apis.length > 0)
    let y = 40
    let ucIndex = 0

    for (const node of apiNodes) {
      for (const api of node.data.apis ?? []) {
        const ucId = `uc-${ucIndex++}`
        nodes.push({
          id: ucId, position: { x: 340, y }, type: 'diagramNode',
          sourcePosition: Position.Right, targetPosition: Position.Left,
          data: { label: `${api.method} ${api.path}`, description: api.description, nodeStyle: 'usecase' },
        })
        edges.push({ id: `uc-e-${ucId}`, source: 'uc-actor', target: ucId, type: 'straight' })
        y += 80
      }
    }

    // If no APIs, generate use cases from all non-subgroup nodes
    if (ucIndex === 0) {
      for (const node of graph.nodes.filter(n => n.data.kind !== 'Subgroup')) {
        const ucId = `uc-${ucIndex++}`
        nodes.push({
          id: ucId, position: { x: 340, y }, type: 'diagramNode',
          sourcePosition: Position.Right, targetPosition: Position.Left,
          data: { label: node.data.label, description: node.data.description, nodeStyle: 'usecase' },
        })
        edges.push({ id: `uc-e-${ucId}`, source: 'uc-actor', target: ucId, type: 'straight' })
        y += 80
      }
    }

    return {
      meta: { id: createDiagramId(), name: `${projectName} — Use Cases`, kind: 'use-case', projectId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      nodes, edges,
    }
  },
}
