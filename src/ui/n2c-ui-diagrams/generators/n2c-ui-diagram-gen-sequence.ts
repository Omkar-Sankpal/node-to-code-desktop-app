import { Position } from '@xyflow/react'
import type { ProjectGraph } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'
import type { DiagramData, DiagramGenerator, DiagramNode, DiagramEdge } from '../n2c-ui-diagram-types'
import { createDiagramId } from '../n2c-ui-diagram-types'

/** Vertical lifeline flows: Controller → Service → Repository chains */
export const sequenceGenerator: DiagramGenerator = {
  kind: 'sequence',
  generate(graph: ProjectGraph, projectName: string): DiagramData {
    const nodes: DiagramNode[] = []
    const edges: DiagramEdge[] = []
    const nonSubgroup = graph.nodes.filter(n => n.data.kind !== 'Subgroup')
    let x = 60

    for (const node of nonSubgroup) {
      nodes.push({
        id: `seq-${node.id}`, position: { x, y: 30 }, type: 'diagramNode',
        sourcePosition: Position.Bottom, targetPosition: Position.Top,
        data: { label: node.data.label, stereotype: `:${node.data.kind}`, nodeStyle: 'lifeline' },
      })
      x += 240
    }

    let msgIndex = 0
    for (const edge of graph.edges) {
      const src = nodes.find(n => n.id === `seq-${edge.source}`)
      const tgt = nodes.find(n => n.id === `seq-${edge.target}`)
      if (src && tgt) {
        const srcNode = graph.nodes.find(n => n.id === edge.source)
        const label = srcNode?.data.apis?.[0]
          ? `${srcNode.data.apis[0].method} ${srcNode.data.apis[0].path}`
          : `call()`
        edges.push({
          id: `seq-e-${msgIndex++}`, source: src.id, target: tgt.id,
          type: 'straight', data: { label, edgeStyle: 'message' },
        })
      }
    }

    return {
      meta: { id: createDiagramId(), name: `${projectName} — Sequence`, kind: 'sequence', projectId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      nodes, edges,
    }
  },
}
