import { Position } from '@xyflow/react'
import type { ProjectGraph } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'
import type { DiagramData, DiagramGenerator, DiagramNode, DiagramEdge } from '../n2c-ui-diagram-types'
import { createDiagramId } from '../n2c-ui-diagram-types'

const layerOrder = ['Database', 'Model', 'Demo node', 'Service', 'API layer', 'API node', 'Main file']
const layerColors: Record<string, string> = {
  Database: '#3b82f6', Model: '#8b5cf6', 'Demo node': '#8b5cf6',
  Service: '#f59e0b', 'API layer': '#10b981', 'API node': '#10b981', 'Main file': '#ef4444',
}

/** Horizontal layered layout: DB → Model → Service → Controller → Main */
export const springLayersGenerator: DiagramGenerator = {
  kind: 'spring-layers',
  generate(graph: ProjectGraph, projectName: string): DiagramData {
    const nodes: DiagramNode[] = []
    const edges: DiagramEdge[] = []
    const grouped = new Map<string, typeof graph.nodes>()

    for (const node of graph.nodes) {
      if (node.data.kind === 'Subgroup') continue
      const kind = node.data.kind
      if (!grouped.has(kind)) grouped.set(kind, [])
      grouped.get(kind)!.push(node)
    }

    const sorted = [...grouped.entries()].sort(
      ([a], [b]) => (layerOrder.indexOf(a) === -1 ? 99 : layerOrder.indexOf(a)) - (layerOrder.indexOf(b) === -1 ? 99 : layerOrder.indexOf(b))
    )

    let x = 60
    for (const [kind, layerNodes] of sorted) {
      // Layer header
      nodes.push({
        id: `sl-layer-${kind}`, position: { x, y: 20 }, type: 'diagramNode',
        sourcePosition: Position.Right, targetPosition: Position.Left,
        data: { label: kind, stereotype: '«layer»', nodeStyle: 'layer', description: layerColors[kind] ?? '#6b7280' },
      })

      let y = 100
      for (const node of layerNodes) {
        nodes.push({
          id: `sl-${node.id}`, position: { x: x + 20, y }, type: 'diagramNode',
          sourcePosition: Position.Right, targetPosition: Position.Left,
          data: { label: node.data.label, description: node.data.description, nodeStyle: 'class' },
        })
        y += 90
      }
      x += 280
    }

    for (const edge of graph.edges) {
      const src = nodes.find(n => n.id === `sl-${edge.source}`)
      const tgt = nodes.find(n => n.id === `sl-${edge.target}`)
      if (src && tgt) {
        edges.push({ id: `sl-e-${edge.id}`, source: src.id, target: tgt.id, type: 'smoothstep', animated: true })
      }
    }

    return {
      meta: { id: createDiagramId(), name: `${projectName} — Spring Layers`, kind: 'spring-layers', projectId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      nodes, edges,
    }
  },
}
