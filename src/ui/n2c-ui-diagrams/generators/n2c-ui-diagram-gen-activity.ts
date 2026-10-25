import { Position } from '@xyflow/react'
import type { ProjectGraph } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'
import type { DiagramData, DiagramGenerator, DiagramNode, DiagramEdge } from '../n2c-ui-diagram-types'
import { createDiagramId } from '../n2c-ui-diagram-types'

/** Activity diagram: start → actions (from nodes) → decision forks → end */
export const activityGenerator: DiagramGenerator = {
  kind: 'activity',
  generate(graph: ProjectGraph, projectName: string): DiagramData {
    const nodes: DiagramNode[] = []
    const edges: DiagramEdge[] = []
    const actionNodes = graph.nodes.filter(n => n.data.kind !== 'Subgroup')

    // Start node
    nodes.push({ id: 'act-start', position: { x: 260, y: 0 }, type: 'diagramNode', sourcePosition: Position.Bottom, targetPosition: Position.Top, data: { label: '●', nodeStyle: 'start' } })

    let y = 90
    let prevId = 'act-start'
    for (const node of actionNodes) {
      const nodeId = `act-${node.id}`
      const hasMultipleOutputs = graph.edges.filter(e => e.source === node.id).length > 1
      nodes.push({
        id: nodeId, position: { x: 200, y }, type: 'diagramNode',
        sourcePosition: Position.Bottom, targetPosition: Position.Top,
        data: { label: node.data.label, description: node.data.description, nodeStyle: hasMultipleOutputs ? 'decision' : 'action' },
      })
      edges.push({ id: `act-e-${prevId}-${nodeId}`, source: prevId, target: nodeId, type: 'smoothstep' })
      prevId = nodeId
      y += 100
    }

    // End node
    nodes.push({ id: 'act-end', position: { x: 260, y }, type: 'diagramNode', sourcePosition: Position.Bottom, targetPosition: Position.Top, data: { label: '◉', nodeStyle: 'end' } })
    edges.push({ id: `act-e-${prevId}-end`, source: prevId, target: 'act-end', type: 'smoothstep' })

    return {
      meta: { id: createDiagramId(), name: `${projectName} — Activity`, kind: 'activity', projectId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      nodes, edges,
    }
  },
}
