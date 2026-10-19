import { Position, type Node } from '@xyflow/react'
import { starterGraph, type NodeTemplate, type ProjectGraph, type WorkflowNode } from './n2c-ui-node-handler-types'

export function createWorkflowNode(template: NodeTemplate, sequence: number, existingNodeCount: number, parentId?: string): WorkflowNode {
  const id = `${template.kind.toLowerCase().replaceAll(' ', '-')}-${sequence}`
  const column = existingNodeCount % 5
  const row = Math.floor(existingNodeCount / 5)

  return {
    id,
    position: { x: 36 + column * 264, y: 86 + row * 112 },
    ...(parentId ? { parentId, extent: 'parent' as const } : {}),
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: { ...template },
    type: 'default',
  }
}

export function createWorkflowSubgroup(template: NodeTemplate, sequence: number, existingGroupCount: number, parentId?: string): WorkflowNode {
  return {
    id: `${template.kind.toLowerCase()}-${sequence}`,
    position: { x: 40 + (existingGroupCount % 4) * 280, y: 70 + Math.floor(existingGroupCount / 4) * 220 },
    ...(parentId ? { parentId, extent: 'parent' as const } : {}),
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    style: { width: 230, height: 190 },
    data: { ...template },
    type: 'group',
  }
}

export function isGroupNode(node: Node): boolean {
  return node.type === 'group'
}

export function normalizeProjectGraph(graph: ProjectGraph): ProjectGraph {
  if (graph.nodes.some((node) => node.id === 'application-flow')) return starterGraph
  if (graph.nodes.some((node) => node.type === 'group')) return graph

  const rootNodes = graph.nodes.filter((node) => !node.parentId)
  if (rootNodes.length === graph.nodes.length) return graph

  const childNodes = graph.nodes.filter((node) => node.id !== 'application-flow').map((node, index) => ({
    ...node,
    position: { x: 36 + index * 264, y: 86 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }))

  return {
    nodes: childNodes,
    edges: graph.edges,
  }
}
