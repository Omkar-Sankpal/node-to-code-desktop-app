import type { Edge, Node } from '@xyflow/react'
import type { ProjectGraph } from '../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'

/* ── Diagram kinds ── */

export type DiagramKind =
  | 'uml-class'
  | 'use-case'
  | 'er-diagram'
  | 'sequence'
  | 'activity'
  | 'component'
  | 'architecture'
  | 'data-flow'
  | 'deployment'
  | 'spring-layers'

export const diagramKindLabels: Record<DiagramKind, string> = {
  'uml-class': 'UML Class Diagram',
  'use-case': 'Use Case Diagram',
  'er-diagram': 'ER Diagram',
  'sequence': 'Sequence Diagram',
  'activity': 'Activity Diagram',
  'component': 'Component Diagram',
  'architecture': 'Architecture Diagram',
  'data-flow': 'Data Flow Diagram',
  'deployment': 'Deployment Diagram',
  'spring-layers': 'Spring Boot Layers',
}

export const diagramKindIcons: Record<DiagramKind, string> = {
  'uml-class': '◆',
  'use-case': '◎',
  'er-diagram': '⬡',
  'sequence': '↕',
  'activity': '▶',
  'component': '⊞',
  'architecture': '⌂',
  'data-flow': '⇶',
  'deployment': '☁',
  'spring-layers': '≡',
}

/* ── Diagram node/edge data ── */

export interface DiagramNodeData extends Record<string, unknown> {
  label: string
  description?: string
  stereotype?: string
  fields?: DiagramField[]
  methods?: DiagramMethod[]
  nodeStyle?: 'class' | 'interface' | 'enum' | 'entity' | 'actor' | 'usecase'
    | 'component' | 'layer' | 'process' | 'datastore' | 'external'
    | 'lifeline' | 'activation' | 'message' | 'server' | 'container' | 'database'
    | 'start' | 'end' | 'decision' | 'action'
}

export interface DiagramField {
  name: string
  type: string
  visibility?: '+' | '-' | '#' | '~'
}

export interface DiagramMethod {
  name: string
  returnType: string
  params?: string
  visibility?: '+' | '-' | '#' | '~'
}

export type DiagramNode = Node<DiagramNodeData>
export type DiagramEdge = Edge & { data?: { label?: string; edgeStyle?: string } }

/* ── Diagram metadata ── */

export interface DiagramMeta {
  id: string
  name: string
  kind: DiagramKind
  projectId: string
  createdAt: string
  updatedAt: string
}

export interface DiagramData {
  meta: DiagramMeta
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}

/* ── Generator interface ── */

export interface DiagramGenerator {
  kind: DiagramKind
  generate: (graph: ProjectGraph, projectName: string) => DiagramData
}

/* ── Persistence helpers ── */

export function loadDiagrams(projectId: string): DiagramData[] {
  try {
    const raw = window.localStorage.getItem(`n2c-diagrams-${projectId}`)
    if (!raw) return []
    return JSON.parse(raw) as DiagramData[]
  } catch {
    return []
  }
}

export function saveDiagrams(projectId: string, diagrams: DiagramData[]): void {
  window.localStorage.setItem(`n2c-diagrams-${projectId}`, JSON.stringify(diagrams))
}

export function createDiagramId(): string {
  return `diagram-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
