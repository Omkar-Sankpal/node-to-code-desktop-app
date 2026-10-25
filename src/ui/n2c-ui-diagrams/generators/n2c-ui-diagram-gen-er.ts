import { Position } from '@xyflow/react'
import type { ProjectGraph } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'
import type { DiagramData, DiagramGenerator, DiagramNode, DiagramEdge } from '../n2c-ui-diagram-types'
import { createDiagramId } from '../n2c-ui-diagram-types'

/** Extract entities and relationships from model + database nodes */
export const erDiagramGenerator: DiagramGenerator = {
  kind: 'er-diagram',
  generate(graph: ProjectGraph, projectName: string): DiagramData {
    const nodes: DiagramNode[] = []
    const edges: DiagramEdge[] = []
    let x = 0
    const y = 120

    const dbNodes = graph.nodes.filter(n => n.data.kind === 'Database')
    for (const db of dbNodes) {
      nodes.push({
        id: `er-${db.id}`, position: { x, y: y + 180 }, type: 'diagramNode',
        sourcePosition: Position.Top, targetPosition: Position.Bottom,
        data: { label: db.data.label, stereotype: '«database»', nodeStyle: 'database' },
      })
      x += 280
    }

    const modelNodes = graph.nodes.filter(n => ['Model', 'Demo node'].includes(n.data.kind))
    for (const model of modelNodes) {
      const fields = model.data.description
        ? model.data.description.split(/[,;.]/).filter(Boolean).map((f, i) => ({
          name: f.trim().replace(/\s+/g, '_').slice(0, 30) || `col${i}`,
          type: 'VARCHAR',
          visibility: '+' as const,
        }))
        : [{ name: 'id', type: 'BIGINT', visibility: '+' as const }]

      nodes.push({
        id: `er-${model.id}`, position: { x, y }, type: 'diagramNode',
        sourcePosition: Position.Right, targetPosition: Position.Left,
        data: { label: model.data.label, stereotype: '«entity»', fields, nodeStyle: 'entity' },
      })
      x += 300
    }

    for (const edge of graph.edges) {
      const src = nodes.find(n => n.id === `er-${edge.source}`)
      const tgt = nodes.find(n => n.id === `er-${edge.target}`)
      if (src && tgt) {
        edges.push({
          id: `er-e-${edge.id}`, source: src.id, target: tgt.id, type: 'smoothstep',
          data: { label: '1:N', edgeStyle: 'relationship' },
        })
      }
    }

    return {
      meta: { id: createDiagramId(), name: `${projectName} — ER Diagram`, kind: 'er-diagram', projectId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      nodes, edges,
    }
  },
}
