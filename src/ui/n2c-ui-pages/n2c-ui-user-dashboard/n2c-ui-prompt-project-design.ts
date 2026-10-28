import { Position, type Edge } from '@xyflow/react'
import type { GenerationGraph, PromptDesignNode, PromptProjectDesign, SpringDependency } from '../n2c-ui-user-onboarding/n2c-ui-user-onboarding-types'
import type { ProjectGraph, WorkflowNode, WorkflowNodeData } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'

export const promptCharacterLimit = 4000

/* ── System prompt: simplified for small local LLMs (gemma3:4b, qwen3:8b) ──
 * Key changes from the previous version:
 * 1. Short, numbered rules instead of wall-of-text paragraphs
 * 2. Concrete 5-node example the LLM can copy-and-modify
 * 3. Contract fields (entityFields, apiContracts, etc.) are optional — small models can skip them
 * 4. Fewer required fields — responsibilities, technology, protocol are all optional now
 * 5. Relaxed ID format — any alphanumeric-dash ID is accepted
 */
export const designSystemPrompt = `You are a Spring Boot architect. Convert the user's description into a structured JSON project design.

RULES:
1. Return ONLY valid JSON. No markdown fences, no explanation, no text outside the JSON object.
2. Every design must have: projectName, summary, architecture, framework, nodes, edges, dependencies.
3. framework is always "spring-boot". architecture is "monolith" unless specified otherwise.
4. Node types:
   - "group": layer containers ("infrastructure-group", "model-group", "service-group", "controller-group")
   - "database": e.g. H2, PostgreSQL, MySQL
   - "entity": JPA entities (e.g. User, Book, Order) with entityFields
   - "service": Business logic services (e.g. UserService, BookService)
   - "controller": REST controllers (e.g. UserController) with apis
5. Always create clean 4-tier architecture:
   - Infrastructure: database nodes inside "infrastructure-group"
   - Models: JPA entity nodes inside "model-group"
   - Services: business logic nodes inside "service-group"
   - Controllers: REST controller nodes inside "controller-group"
6. Connect edges in flow direction:
   - database -> entity
   - entity -> service
   - service -> controller
7. Controller nodes must include an apis array with method, path, and description.
8. Entity nodes should include an entityFields array with name, type (Long, String, Integer, Double, Boolean, LocalDateTime).

JSON EXAMPLE:
{
  "projectName": "book-store-app",
  "summary": "Online book store management system with REST APIs",
  "architecture": "monolith",
  "framework": "spring-boot",
  "packageName": "com.example.bookstore",
  "nodes": [
    {"id": "infrastructure-group", "type": "group", "label": "Infrastructure", "description": "Database and runtime infrastructure"},
    {"id": "h2-db", "type": "database", "label": "H2 Database", "description": "In-memory H2 database", "parentId": "infrastructure-group"},
    {"id": "model-group", "type": "group", "label": "Models & Entities", "description": "JPA Entities and Data Transfer Objects"},
    {"id": "book-entity", "type": "entity", "label": "Book", "description": "Book entity representing books in catalog", "parentId": "model-group", "entityFields": [{"name": "id", "type": "Long"}, {"name": "title", "type": "String"}, {"name": "author", "type": "String"}, {"name": "price", "type": "Double"}]},
    {"id": "service-group", "type": "group", "label": "Services", "description": "Business logic services"},
    {"id": "book-service", "type": "service", "label": "BookService", "description": "Service for catalog and inventory operations", "parentId": "service-group", "serviceMethods": [{"name": "getAllBooks", "returnType": "List<Book>", "description": "Retrieve all books"}, {"name": "createBook", "returnType": "Book", "params": "Book book", "description": "Save new book"}]},
    {"id": "controller-group", "type": "group", "label": "Controllers", "description": "REST API Controllers"},
    {"id": "book-controller", "type": "controller", "label": "BookController", "description": "REST endpoints for books", "parentId": "controller-group", "apis": [{"method": "GET", "path": "/api/books", "description": "Get all books"}, {"method": "POST", "path": "/api/books", "description": "Add new book"}]}
  ],
  "edges": [
    {"source": "h2-db", "target": "book-entity"},
    {"source": "book-entity", "target": "book-service"},
    {"source": "book-service", "target": "book-controller"}
  ],
  "dependencies": [
    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-web"},
    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-data-jpa"},
    {"groupId": "com.h2database", "artifactId": "h2"}
  ],
  "assumptions": ["Using H2 in-memory database for local development"],
  "clarificationQuestions": []
}

OPTIONAL: If you can, also add entityFields to model nodes and apiContracts to controller nodes. But if unsure, skip them — the basic structure above is enough.`

/* ── Validation: much more lenient for small LLMs ── */

const nodeTypes = new Set(['service', 'controller', 'database', 'external-system', 'queue', 'group', 'entity', 'model'])
const architectures = new Set(['monolith', 'modular-monolith', 'microservices'])
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const maxNodes = 80
const maxEdges = 160
const typeAliases: Record<string, PromptDesignNode['type']> = {
  api: 'controller', 'api-layer': 'controller', rest: 'controller', endpoint: 'controller',
  entity: 'entity', model: 'entity', repository: 'entity', repo: 'entity',
  configuration: 'group', config: 'group', infrastructure: 'group', infra: 'group',
  integration: 'group', messaging: 'group', security: 'group',
  middleware: 'service', component: 'service', layer: 'group',
  db: 'database', postgres: 'database', mysql: 'database', h2: 'database', mongo: 'database',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function inferNodeType(node: Record<string, unknown>): PromptDesignNode['type'] {
  const rawType = typeof node.type === 'string' ? node.type.toLowerCase().trim().replace(/\s+/g, '-') : ''
  if (nodeTypes.has(rawType)) return rawType as PromptDesignNode['type']
  if (typeAliases[rawType]) return typeAliases[rawType]
  const text = `${node.id ?? ''} ${node.label ?? ''} ${node.description ?? ''} ${node.type ?? ''}`.toLowerCase()
  if (/(controller|endpoint|api|rest)/.test(text)) return 'controller'
  if (/(database|postgres|mysql|mongo|redis|storage|h2|db)/.test(text)) return 'database'
  if (/(queue|kafka|rabbit|event|message)/.test(text)) return 'queue'
  if (/(external|payment|gateway|provider|third.?party)/.test(text)) return 'external-system'
  if (/(group|layer|module|package|subgroup)/.test(text)) return 'group'
  if (/(entity|model|schema|dto|table|record)/.test(text)) return 'entity'
  return 'service'
}

/** Sanitize a node ID to valid kebab-case, handling common LLM mistakes */
function sanitizeId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')   // replace invalid chars with dash
    .replace(/-{2,}/g, '-')         // collapse multiple dashes
    .replace(/^-|-$/g, '')          // trim leading/trailing dashes
    || `node-${Math.random().toString(36).slice(2, 8)}`
}

/** Safely coerce an unknown value to a string array, defaulting to [] */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** Parse potentially malformed JSON with aggressive recovery */
export function parseDesignResponse(content: string): unknown {
  // Strip markdown fences, thinking tags, and other wrapping
  let cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim()

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The model did not return a JSON project design.')

  cleaned = cleaned.slice(start, end + 1)

  // Try direct parse first
  try {
    return JSON.parse(cleaned) as unknown
  } catch {
    // Common LLM JSON mistakes: trailing commas, single quotes, unquoted keys
  }

  // Attempt to repair common JSON errors
  let repaired = cleaned
    .replace(/,\s*([}\]])/g, '$1')           // trailing commas
    .replace(/'/g, '"')                       // single quotes → double quotes
    .replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":')  // unquoted keys
    .replace(/:\s*'([^']*)'/g, ': "$1"')      // single-quoted values

  try {
    return JSON.parse(repaired) as unknown
  } catch {
    // Last resort: try to extract any JSON object
  }

  // Try extracting balanced braces
  let depth = 0
  let inString = false
  let escaped = false
  let jsonEnd = -1
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) { jsonEnd = i; break }
  }
  if (jsonEnd > 0) {
    repaired = cleaned.slice(0, jsonEnd + 1).replace(/,\s*([}\]])/g, '$1')
    try {
      return JSON.parse(repaired) as unknown
    } catch {
      throw new Error('The model returned malformed JSON for the project design.')
    }
  }

  throw new Error('The model returned malformed JSON for the project design.')
}

/** Normalize the raw LLM response into a shape close to PromptProjectDesign.
 *  This is very forgiving — it fixes missing fields, wrong types, bad IDs, etc. */
export function normalizeDesignResponse(value: unknown): unknown {
  if (!isRecord(value)) return value

  // Fix projectName
  if (typeof value.projectName !== 'string' || !value.projectName.trim()) {
    value.projectName = typeof value.name === 'string' ? value.name : 'spring-app'
  }

  // Fix summary
  if (typeof value.summary !== 'string' || !value.summary.trim()) {
    value.summary = typeof value.description === 'string' ? value.description : 'A Spring Boot application'
  }

  const nodes = Array.isArray(value.nodes) ? value.nodes.map((item) => {
    if (!isRecord(item)) return item
    const sanitizedId = sanitizeId(item.id)
    const normalized: Record<string, unknown> = {
      ...item,
      id: sanitizedId,
      type: inferNodeType(item),
      label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : sanitizedId,
      description: typeof item.description === 'string' && item.description.trim()
        ? item.description.trim()
        : typeof item.label === 'string' ? item.label : 'Spring component',
      responsibilities: toStringArray(item.responsibilities),
    }

    // Fix parentId
    if (item.parentId === null || item.parentId === '' || item.parentId === undefined) {
      delete normalized.parentId
    } else if (typeof item.parentId === 'string') {
      normalized.parentId = sanitizeId(item.parentId)
    }

    // Fix apis — many LLMs put methods in wrong format
    if (Array.isArray(item.apis)) {
      normalized.apis = item.apis.filter(isRecord).map(api => ({
        method: typeof api.method === 'string' && methods.has(api.method.toUpperCase()) ? api.method.toUpperCase() : 'GET',
        path: typeof api.path === 'string' && api.path.trim() ? (api.path.startsWith('/') ? api.path : `/${api.path}`) : '/api/resource',
        description: typeof api.description === 'string' ? api.description : '',
      }))
    } else {
      delete normalized.apis
    }

    // Normalize contract fields gracefully
    if (item.entityFields === null || item.entityFields === undefined || !Array.isArray(item.entityFields)) delete normalized.entityFields
    if (item.apiContracts === null || item.apiContracts === undefined || !Array.isArray(item.apiContracts)) delete normalized.apiContracts
    if (item.serviceMethods === null || item.serviceMethods === undefined || !Array.isArray(item.serviceMethods)) delete normalized.serviceMethods
    if (item.configEntries === null || item.configEntries === undefined || !Array.isArray(item.configEntries)) delete normalized.configEntries

    return normalized
  }) : []

  // Deduplicate node IDs
  const seenIds = new Set<string>()
  for (const node of nodes) {
    if (!isRecord(node)) continue
    let id = String(node.id)
    while (seenIds.has(id)) { id = `${id}-${Math.random().toString(36).slice(2, 5)}` }
    node.id = id
    seenIds.add(id)
  }

  // Fix edges — remove edges referencing non-existent nodes, self-loops, and duplicates
  const nodeIds = new Set(nodes.filter(isRecord).map(n => String(n.id)))
  const seenEdges = new Set<string>()
  const edges = Array.isArray(value.edges) ? value.edges.filter(edge => {
    if (!isRecord(edge)) return false
    const src = typeof edge.source === 'string' ? sanitizeId(edge.source) : ''
    const tgt = typeof edge.target === 'string' ? sanitizeId(edge.target) : ''
    edge.source = src
    edge.target = tgt
    if (!src || !tgt || src === tgt) return false
    if (!nodeIds.has(src) || !nodeIds.has(tgt)) return false
    const key = `${src}->${tgt}`
    if (seenEdges.has(key)) return false
    seenEdges.add(key)
    return true
  }) : []

  // Fix dependencies
  let dependencies = Array.isArray(value.dependencies)
    ? value.dependencies.filter(d => isRecord(d) && typeof d.groupId === 'string' && typeof d.artifactId === 'string')
    : []
  // Always ensure basic Spring Boot starters are present
  const depKeys = new Set(dependencies.map((d: Record<string, unknown>) => `${d.groupId}:${d.artifactId}`))
  const requiredDeps = [
    { groupId: 'org.springframework.boot', artifactId: 'spring-boot-starter-web' },
    { groupId: 'org.springframework.boot', artifactId: 'spring-boot-starter-data-jpa' },
    { groupId: 'com.h2database', artifactId: 'h2' },
    { groupId: 'org.springframework.boot', artifactId: 'spring-boot-starter-test', scope: 'test' },
  ]
  for (const dep of requiredDeps) {
    if (!depKeys.has(`${dep.groupId}:${dep.artifactId}`)) {
      dependencies.push(dep)
    }
  }

  return {
    ...value,
    framework: 'spring-boot',
    architecture: typeof value.architecture === 'string' && architectures.has(value.architecture) ? value.architecture : 'monolith',
    nodes,
    edges,
    dependencies,
    assumptions: toStringArray(value.assumptions),
    clarificationQuestions: toStringArray(value.clarificationQuestions),
  }
}

/** Lenient validation — fixes what it can instead of throwing errors */
export function validatePromptProjectDesign(value: unknown): PromptProjectDesign {
  if (!isRecord(value)) throw new Error('The model response must be a JSON object.')

  const errors: string[] = []

  if (typeof value.projectName !== 'string' || !value.projectName.trim()) errors.push('Missing projectName.')
  if (typeof value.summary !== 'string' || !value.summary.trim()) errors.push('Missing summary.')

  const nodes = Array.isArray(value.nodes) ? value.nodes : []
  if (nodes.length === 0) errors.push('No nodes were generated.')
  if (nodes.length > maxNodes) errors.push(`Too many nodes (${nodes.length}, max ${maxNodes}).`)

  const edges = Array.isArray(value.edges) ? value.edges : []
  if (edges.length > maxEdges) errors.push(`Too many edges (${edges.length}, max ${maxEdges}).`)

  // Validate each node has minimum required fields
  const ids = new Set<string>()
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (!isRecord(node)) { errors.push(`nodes[${i}] is not an object.`); continue }
    if (typeof node.id !== 'string' || !node.id.trim()) errors.push(`nodes[${i}] has no id.`)
    else ids.add(node.id)
    if (typeof node.type !== 'string' || !nodeTypes.has(node.type)) errors.push(`nodes[${i}].type "${node.type}" is not recognized.`)
    if (typeof node.label !== 'string' || !node.label.trim()) errors.push(`nodes[${i}] has no label.`)
  }

  // Validate edges reference existing nodes (warning only, don't fail)
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    if (!isRecord(edge) || typeof edge.source !== 'string' || typeof edge.target !== 'string') {
      errors.push(`edges[${i}] is malformed.`)
    }
  }

  // Dependencies check — lenient
  if (!Array.isArray(value.dependencies)) errors.push('dependencies must be an array.')

  if (errors.length > 5) {
    // Too many problems — this response is fundamentally broken
    throw new Error(`The model returned an invalid project design: ${errors.slice(0, 5).join(' ')} (and ${errors.length - 5} more issues)`)
  }
  if (errors.length > 0 && nodes.length === 0) {
    throw new Error(`The model returned an invalid project design: ${errors.join(' ')}`)
  }

  // If we have at least some valid nodes, accept the design even with warnings
  return value as unknown as PromptProjectDesign
}

/* ── Graph mapping ── */

function visualKind(node: PromptDesignNode): string {
  if (node.type === 'controller') return 'API layer'
  if (node.type === 'database') return 'Database'
  if (node.type === 'service') return 'Service'
  if (node.type === 'entity' || node.type === 'model') return 'Model'
  if (node.type === 'group') return 'Subgroup'
  if (node.type === 'queue') return 'Queue'
  return 'External system'
}

export function mapDesignToGraph(design: PromptProjectDesign): ProjectGraph {
  const existingGroupIds = new Set(design.nodes.filter(n => n.type === 'group').map(n => n.id))
  const existingGroupLabels = new Set(design.nodes.filter(n => n.type === 'group').map(n => n.label.toLowerCase()))

  const hasControllerGroup = [...existingGroupIds, ...existingGroupLabels].some(g => /controller|api/i.test(g))
  const hasServiceGroup = [...existingGroupIds, ...existingGroupLabels].some(g => /service/i.test(g))
  const hasModelGroup = [...existingGroupIds, ...existingGroupLabels].some(g => /model|entit/i.test(g))
  const hasInfraGroup = [...existingGroupIds, ...existingGroupLabels].some(g => /infra|database|db/i.test(g))

  const groupNodes: PromptDesignNode[] = []
  if (!hasInfraGroup) groupNodes.push({ id: 'spring-infrastructure', label: 'Infrastructure', description: 'Databases and external connections', type: 'group', responsibilities: [] })
  if (!hasModelGroup) groupNodes.push({ id: 'spring-model', label: 'Models & Entities', description: 'JPA entities, DTOs, and domain models', type: 'group', responsibilities: [] })
  if (!hasServiceGroup) groupNodes.push({ id: 'spring-service', label: 'Services', description: 'Spring service classes and business logic', type: 'group', responsibilities: [] })
  if (!hasControllerGroup) groupNodes.push({ id: 'spring-controller', label: 'Controllers', description: 'Spring MVC REST controllers', type: 'group', responsibilities: [] })

  const allAvailableGroupIds = [...existingGroupIds, ...groupNodes.map(g => g.id)]
  const findGroupId = (predicate: RegExp, fallback: string) => {
    return allAvailableGroupIds.find(id => predicate.test(id)) || fallback
  }

  const infraGroupId = findGroupId(/infra|database|db/i, 'spring-infrastructure')
  const modelGroupId = findGroupId(/model|entit/i, 'spring-model')
  const serviceGroupId = findGroupId(/service/i, 'spring-service')
  const controllerGroupId = findGroupId(/controller|api/i, 'spring-controller')

  const allDesignNodes = [...groupNodes, ...design.nodes].map((node) => {
    if (node.type === 'group' || node.parentId) return node
    const parentId = node.type === 'controller'
      ? controllerGroupId
      : node.type === 'service'
        ? serviceGroupId
        : node.type === 'entity' || node.type === 'model'
          ? modelGroupId
          : node.type === 'database' || node.type === 'external-system' || node.type === 'queue'
            ? infraGroupId
            : modelGroupId
    return { ...node, parentId }
  })

  // Determine standard 4-column horizontal architecture layout
  function getLayerIndex(g: PromptDesignNode): number {
    const id = g.id.toLowerCase()
    const label = g.label.toLowerCase()
    if (/infra|database|db|queue|external/.test(id) || /infra|database|db|queue|external/.test(label)) return 0
    if (/model|entit|dto|domain/.test(id) || /model|entit|dto|domain/.test(label)) return 1
    if (/service|logic|manager/.test(id) || /service|logic|manager/.test(label)) return 2
    if (/controller|api|web|rest|endpoint/.test(id) || /controller|api|web|rest|endpoint/.test(label)) return 3
    return 1
  }

  const groups = allDesignNodes.filter(n => n.type === 'group')
  groups.sort((a, b) => getLayerIndex(a) - getLayerIndex(b))

  const groupPositions = new Map<string, { x: number; y: number }>()
  groups.forEach((g) => {
    const layer = getLayerIndex(g)
    const x = 50 + layer * 380
    const y = 40
    groupPositions.set(g.id, { x, y })
  })

  const childCounters = new Map<string, number>()

  const nodes: WorkflowNode[] = allDesignNodes.map((node) => {
    if (node.type === 'group') {
      const pos = groupPositions.get(node.id) ?? { x: 50, y: 40 }
      const childCount = allDesignNodes.filter(n => n.parentId === node.id).length
      return {
        id: node.id,
        type: 'group',
        position: pos,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: { width: 330, height: Math.max(240, 75 + childCount * 90) },
        data: { label: node.label, description: node.description, kind: 'Subgroup' },
      }
    }

    // Position children neatly inside their parent group container
    const parentPos = node.parentId ? groupPositions.get(node.parentId) : undefined
    const childIndex = node.parentId ? (childCounters.get(node.parentId) ?? 0) : 0
    if (node.parentId) childCounters.set(node.parentId, childIndex + 1)

    return {
      id: node.id,
      type: 'default',
      position: parentPos
        ? { x: 25, y: 65 + childIndex * 90 }
        : { x: 50 + childIndex * 280, y: 420 },
      ...(node.parentId ? { parentId: node.parentId, extent: 'parent' as const } : {}),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: node.label,
        description: `${node.description}${node.technology ? ` Technology: ${node.technology}.` : ''}`,
        kind: visualKind(node),
        ...(node.apis?.length ? { apis: node.apis } : {}),
        ...(node.entityFields?.length ? { entityFields: node.entityFields as WorkflowNodeData['entityFields'] } : {}),
        ...(node.apiContracts?.length ? { apiContracts: node.apiContracts as WorkflowNodeData['apiContracts'] } : {}),
        ...(node.serviceMethods?.length ? { serviceMethods: node.serviceMethods as WorkflowNodeData['serviceMethods'] } : {}),
        ...(node.configEntries?.length ? { configEntries: node.configEntries as WorkflowNodeData['configEntries'] } : {}),
      },
    }
  })

  const edges: Edge[] = design.edges.map((edge, index) => ({
    id: `prompt-edge-${index + 1}`,
    source: edge.source,
    target: edge.target,
    animated: true,
    label: edge.label,
  }))
  return { nodes, edges }
}

export function designToGenerationGraph(graph: ProjectGraph): GenerationGraph {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      data: {
        label: node.data.label,
        description: node.data.description,
        kind: node.data.kind,
        apis: node.data.apis,
        ...(node.data.apiContracts?.length ? { apiContracts: node.data.apiContracts } : {}),
        ...(node.data.entityFields?.length ? { entityFields: node.data.entityFields } : {}),
        ...(node.data.serviceMethods?.length ? { serviceMethods: node.data.serviceMethods } : {}),
        ...(node.data.configEntries?.length ? { configEntries: node.data.configEntries } : {}),
        ...(node.data.packagePath ? { packagePath: node.data.packagePath } : {}),
      },
    })),
    edges: graph.edges.map((edge) => ({ source: edge.source, target: edge.target })),
  }
}

export function dependencyList(dependencies: SpringDependency[]): SpringDependency[] {
  const seen = new Set<string>()
  return dependencies.filter((dependency) => {
    const key = `${dependency.groupId}:${dependency.artifactId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
