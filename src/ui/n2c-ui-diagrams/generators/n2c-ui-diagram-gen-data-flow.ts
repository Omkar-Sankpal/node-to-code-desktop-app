import { Position } from '@xyflow/react'
import type { ProjectGraph } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'
import type { DiagramData, DiagramGenerator, DiagramNode, DiagramEdge } from '../n2c-ui-diagram-types'
import { createDiagramId } from '../n2c-ui-diagram-types'

/** Data Flow Diagram: sources → processes → data stores → sinks */
export const dataFlowGenerator: DiagramGenerator = {
  kind: 'data-flow',
  generate(graph: ProjectGraph, projectName: string): DiagramData {
    const nodes: DiagramNode[] = []
    const edges: DiagramEdge[] = []
    let x = 60

    for (const node of graph.nodes) {
      if (node.data.kind === 'Subgroup') continue
      const style = node.data.kind === 'Database' ? 'datastore'
        : (node.data.kind === 'API layer' || node.data.kind === 'API node') ? 'external'
          : 'process'
      nodes.push({
        id: `df-${node.id}`, position: { x, y: 120 }, type: 'diagramNode',
        sourcePosition: Position.Right, targetPosition: Position.Left,
        data: { label: node.data.label, nodeStyle: style },
      })
      x += 280
    }

    for (const edge of graph.edges) {
      const src = nodes.find(n => n.id === `df-${edge.source}`)
      const tgt = nodes.find(n => n.id === `df-${edge.target}`)
      if (src && tgt) {
        edges.push({ id: `df-e-${edge.id}`, source: src.id, target: tgt.id, type: 'smoothstep', data: { label: 'data' } })
      }
    }

    return {
      meta: { id: createDiagramId(), name: `${projectName} — Data Flow`, kind: 'data-flow', projectId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      nodes, edges,
    }
  },
}
