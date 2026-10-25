import { Position } from '@xyflow/react'
import type { ProjectGraph } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'
import type { DiagramData, DiagramGenerator, DiagramNode, DiagramEdge } from '../n2c-ui-diagram-types'
import { createDiagramId } from '../n2c-ui-diagram-types'

/** High-level architecture boxes grouped by subgroups with protocol labels */
export const architectureGenerator: DiagramGenerator = {
  kind: 'architecture',
  generate(graph: ProjectGraph, projectName: string): DiagramData {
    const nodes: DiagramNode[] = []
    const edges: DiagramEdge[] = []
    const subgroups = graph.nodes.filter(n => n.data.kind === 'Subgroup')
    const standalones = graph.nodes.filter(n => n.data.kind !== 'Subgroup' && !n.parentId)
    let x = 80

    for (const sg of subgroups) {
      const children = graph.nodes.filter(n => n.parentId === sg.id)
      nodes.push({
        id: `arch-${sg.id}`, position: { x, y: 120 }, type: 'diagramNode',
        sourcePosition: Position.Right, targetPosition: Position.Left,
        data: { label: sg.data.label, description: `${children.length} internal nodes`, nodeStyle: 'component' },
      })
      x += 320
    }
    for (const node of standalones) {
      const style = node.data.kind === 'Database' ? 'database' : 'external'
      nodes.push({
        id: `arch-${node.id}`, position: { x, y: 120 }, type: 'diagramNode',
        sourcePosition: Position.Right, targetPosition: Position.Left,
        data: { label: node.data.label, nodeStyle: style },
      })
      x += 280
    }

    for (const edge of graph.edges) {
      const src = graph.nodes.find(n => n.id === edge.source)
      const tgt = graph.nodes.find(n => n.id === edge.target)
      const srcId = src?.parentId ? `arch-${src.parentId}` : `arch-${edge.source}`
      const tgtId = tgt?.parentId ? `arch-${tgt.parentId}` : `arch-${edge.target}`
      if (srcId !== tgtId && nodes.some(n => n.id === srcId) && nodes.some(n => n.id === tgtId)) {
        const eid = `arch-e-${srcId}-${tgtId}`
        if (!edges.some(e => e.id === eid)) {
          edges.push({ id: eid, source: srcId, target: tgtId, type: 'smoothstep', data: { label: 'HTTP/JPA' } })
        }
      }
    }

    return {
      meta: { id: createDiagramId(), name: `${projectName} — Architecture`, kind: 'architecture', projectId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      nodes, edges,
    }
  },
}
