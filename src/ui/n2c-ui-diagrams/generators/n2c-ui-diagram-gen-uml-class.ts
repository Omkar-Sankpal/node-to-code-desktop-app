import { Position } from '@xyflow/react'
import type { ProjectGraph } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'
import type { DiagramData, DiagramGenerator, DiagramNode, DiagramEdge } from '../n2c-ui-diagram-types'
import { createDiagramId } from '../n2c-ui-diagram-types'

/** Extract model/entity nodes and generate UML class boxes with fields and relationships */
export const umlClassGenerator: DiagramGenerator = {
  kind: 'uml-class',
  generate(graph: ProjectGraph, projectName: string): DiagramData {
    const nodes: DiagramNode[] = []
    const edges: DiagramEdge[] = []
    let x = 0

    const classNodes = graph.nodes.filter(n => !['Subgroup', 'Database', 'Main file'].includes(n.data.kind))
    for (const node of classNodes) {
      const stereotype = node.data.kind === 'API layer' || node.data.kind === 'API node'
        ? '«controller»' : node.data.kind === 'Service'
          ? '«service»' : node.data.kind === 'Model'
            ? '«entity»' : `«${node.data.kind.toLowerCase()}»`

      const fields = node.data.description
        ? node.data.description.split(/[,;.]/).filter(Boolean).map((f, i) => ({
          name: f.trim().replace(/\s+/g, '_').slice(0, 30) || `field${i}`,
          type: 'String',
          visibility: '-' as const,
        }))
        : []

      const methods = (node.data.apis ?? []).map(api => ({
        name: `${api.method.toLowerCase()}${api.path.split('/').pop()?.replace(/[^a-zA-Z]/g, '') ?? ''}`,
        returnType: 'ResponseEntity',
        params: api.method === 'GET' ? '' : 'body: RequestBody',
        visibility: '+' as const,
      }))

      nodes.push({
        id: `uml-${node.id}`,
        position: { x, y: 60 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        type: 'diagramNode',
        data: {
          label: node.data.label,
          stereotype,
          fields,
          methods,
          nodeStyle: node.data.kind === 'Model' ? 'entity' : 'class',
        },
      })
      x += 320
    }

    for (const edge of graph.edges) {
      const sourceExists = nodes.some(n => n.id === `uml-${edge.source}`)
      const targetExists = nodes.some(n => n.id === `uml-${edge.target}`)
      if (sourceExists && targetExists) {
        edges.push({
          id: `uml-e-${edge.id}`,
          source: `uml-${edge.source}`,
          target: `uml-${edge.target}`,
          type: 'smoothstep',
          data: { label: 'uses', edgeStyle: 'dependency' },
        })
      }
    }

    return {
      meta: {
        id: createDiagramId(),
        name: `${projectName} — Class Diagram`,
        kind: 'uml-class',
        projectId: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      nodes,
      edges,
    }
  },
}
