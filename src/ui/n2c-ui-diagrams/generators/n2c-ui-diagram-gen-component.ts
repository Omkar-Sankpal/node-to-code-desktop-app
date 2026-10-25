import { Position } from '@xyflow/react'
import type { ProjectGraph } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'
import type { DiagramData, DiagramGenerator, DiagramNode, DiagramEdge } from '../n2c-ui-diagram-types'
import { createDiagramId } from '../n2c-ui-diagram-types'

/** Group nodes by subgroups → components, edges → connectors */
export const componentGenerator: DiagramGenerator = {
  kind: 'component',
  generate(graph: ProjectGraph, projectName: string): DiagramData {
    const nodes: DiagramNode[] = []
    const edges: DiagramEdge[] = []

    const subgroups = graph.nodes.filter(n => n.data.kind === 'Subgroup')
    const standaloneNodes = graph.nodes.filter(n => n.data.kind !== 'Subgroup' && !n.parentId)
    let x = 60

    for (const sg of subgroups) {
      nodes.push({
        id: `comp-${sg.id}`, position: { x, y: 60 }, type: 'diagramNode',
        sourcePosition: Position.Right, targetPosition: Position.Left,
        data: { label: sg.data.label, stereotype: '«component»', description: sg.data.description, nodeStyle: 'component' },
      })
      x += 300
    }

    for (const node of standaloneNodes) {
      nodes.push({
        id: `comp-${node.id}`, position: { x, y: 60 }, type: 'diagramNode',
        sourcePosition: Position.Right, targetPosition: Position.Left,
        data: { label: node.data.label, stereotype: `«${node.data.kind.toLowerCase()}»`, nodeStyle: 'component' },
      })
      x += 300
    }

    for (const edge of graph.edges) {
      const sourceNode = graph.nodes.find(n => n.id === edge.source)
      const targetNode = graph.nodes.find(n => n.id === edge.target)
      const sourceComp = sourceNode?.parentId ? `comp-${sourceNode.parentId}` : `comp-${edge.source}`
      const targetComp = targetNode?.parentId ? `comp-${targetNode.parentId}` : `comp-${edge.target}`
      if (sourceComp !== targetComp && nodes.some(n => n.id === sourceComp) && nodes.some(n => n.id === targetComp)) {
        const edgeId = `comp-e-${sourceComp}-${targetComp}`
        if (!edges.some(e => e.id === edgeId)) {
          edges.push({ id: edgeId, source: sourceComp, target: targetComp, type: 'smoothstep', data: { label: 'depends on' } })
        }
      }
    }

    return {
      meta: { id: createDiagramId(), name: `${projectName} — Component Diagram`, kind: 'component', projectId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      nodes, edges,
    }
  },
}
