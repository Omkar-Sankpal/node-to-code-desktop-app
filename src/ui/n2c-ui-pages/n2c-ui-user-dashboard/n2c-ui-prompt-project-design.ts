import { Position, type Edge } from '@xyflow/react'
import type { GenerationGraph, PromptDesignApi, PromptDesignNode, PromptProjectDesign, SpringDependency } from '../n2c-ui-user-onboarding/n2c-ui-user-onboarding-types'
import type { ProjectGraph, WorkflowNode, WorkflowNodeData } from '../../n2c-ui-node-editor/n2c-ui-node-handler/n2c-ui-node-handler-types'

export const promptCharacterLimit = 4000
export const designSystemPrompt = `You convert a user's project description into a project design.
Return JSON only, with no Markdown fences or text outside JSON.
The JSON shape is:
{"projectName":"string","summary":"string","architecture":"monolith|modular-monolith|microservices","framework":"spring-boot","packageName":"optional reverse-domain Java package","nodes":[{"id":"stable-kebab-case-id","type":"service|controller|database|external-system|queue|group","label":"string","description":"string","responsibilities":["string"],"technology":"optional string","apis":[{"method":"GET|POST|PUT|PATCH|DELETE","path":"string","description":"string"}],"parentId":"required for non-group nodes","entityFields":[{"name":"string","type":"String|Long|Integer|Double|Boolean|LocalDate|LocalDateTime|BigDecimal|UUID","constraints":["@NotNull","@NotBlank","@Email","@Size","@Column(unique=true)"],"relationship":{"type":"OneToOne|OneToMany|ManyToOne|ManyToMany","target":"node-id"}}],"apiContracts":[{"method":"GET|POST|PUT|PATCH|DELETE","path":"string","description":"string","requestBody":"DTO class name or omit","responseType":"e.g. List<UserDTO>","pathParams":["id"],"queryParams":["page","size"]}],"serviceMethods":[{"name":"string","description":"string","params":"Long id, CreateDTO dto","returnType":"UserDTO","dependencies":["node-id"]}],"configEntries":[{"key":"spring.property.key","value":"default-value","description":"string"}]}],"edges":[{"source":"node id","target":"node id","label":"optional string","protocol":"optional string"}],"dependencies":[{"groupId":"string","artifactId":"string","version":"optional string","scope":"optional string"}],"assumptions":["string"],"clarificationQuestions":["string"]}
Every design is a Spring Boot project. Create subgroup nodes for the Spring Boot layers required by the prompt. At minimum include configuration, controller, service, repository, model, and infrastructure subgroups; add integration, messaging, security, or other subgroups when required. Use ids such as spring-configuration, user-controller, user-service, user-repository, user-model. Every non-group node must have parentId pointing to a group node. Put controllers under controller groups, business logic under service groups, repositories under repository groups, entities under model groups, databases and external systems under infrastructure or integration groups. Use spring-boot-starter dependencies where appropriate.
For model/entity nodes, always include entityFields with field names, Java types, and JPA constraints. For controller nodes, include apiContracts with method, path, requestBody, and responseType. For service nodes, include serviceMethods with name, params, returnType, and which repository/service dependencies they call. For database/config nodes, include configEntries with Spring property keys and default values.
Keep the response compact: return no more than 80 nodes and 160 edges, combining related responsibilities into one node instead of creating one node per method or field.
Use empty arrays instead of null. Use unique node IDs and valid edge references. Produce a useful best-effort design even when clarification questions are needed. Do not include source code or file paths.`

const nodeTypes = new Set(['service', 'controller', 'database', 'external-system', 'queue', 'group'])
const architectures = new Set(['monolith', 'modular-monolith', 'microservices'])
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const maxNodes = 80
const maxEdges = 160
const typeAliases: Record<string, PromptDesignNode['type']> = {
  api: 'controller',
  'api-layer': 'controller',
  entity: 'service',
  model: 'service',
  repository: 'service',
  configuration: 'group',
  config: 'group',
  infrastructure: 'group',
  integration: 'group',
  messaging: 'group',
  security: 'group',
  middleware: 'service',
  component: 'service',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown, field: string, errors: string[]): value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    errors.push(`${field} must be an array of strings.`)
    return false
  }
  return true
}

function validateApi(value: unknown, field: string, errors: string[]): value is PromptDesignApi {
  if (!isRecord(value) || typeof value.method !== 'string' || !methods.has(value.method) || typeof value.path !== 'string' || !value.path.startsWith('/') || typeof value.description !== 'string' || !value.description.trim()) {
    errors.push(`${field} must contain a valid HTTP method, slash-prefixed path, and description.`)
    return false
  }
  return true
}

export function validatePromptProjectDesign(value: unknown): PromptProjectDesign {
  const errors: string[] = []
  if (!isRecord(value)) throw new Error('The model response must be a JSON object.')
  if (typeof value.projectName !== 'string' || !value.projectName.trim()) errors.push('projectName must be a non-empty string.')
  if (typeof value.summary !== 'string' || !value.summary.trim()) errors.push('summary must be a non-empty string.')
  if (typeof value.architecture !== 'string' || !architectures.has(value.architecture)) errors.push('architecture is unsupported.')
  if (value.framework !== 'spring-boot') errors.push('framework must be spring-boot.')
  if (value.packageName !== undefined && (typeof value.packageName !== 'string' || !/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(value.packageName))) errors.push('packageName must be a valid Java package.')
  if (!Array.isArray(value.nodes) || value.nodes.length > maxNodes) errors.push(`nodes must contain between 0 and ${maxNodes} items.`)
  if (!Array.isArray(value.edges) || value.edges.length > maxEdges) errors.push(`edges must contain between 0 and ${maxEdges} items.`)
  const nodes = Array.isArray(value.nodes) ? value.nodes : []
  const ids = new Set<string>()
  nodes.forEach((node, index) => {
    const field = `nodes[${index}]`
    if (!isRecord(node) || typeof node.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(node.id)) errors.push(`${field}.id must be kebab-case.`)
    else if (ids.has(node.id)) errors.push(`${field}.id is duplicated.`)
    else ids.add(node.id)
    if (!isRecord(node) || typeof node.type !== 'string' || !nodeTypes.has(node.type)) errors.push(`${field}.type is unsupported.`)
    if (!isRecord(node) || typeof node.label !== 'string' || !node.label.trim()) errors.push(`${field}.label is required.`)
    if (!isRecord(node) || typeof node.description !== 'string' || !node.description.trim()) errors.push(`${field}.description is required.`)
    if (!isRecord(node) || !stringArray(node.responsibilities, `${field}.responsibilities`, errors)) return
    if (isRecord(node) && node.technology !== undefined && typeof node.technology !== 'string') errors.push(`${field}.technology must be a string.`)
    if (isRecord(node) && node.parentId !== undefined && typeof node.parentId !== 'string') errors.push(`${field}.parentId must be a string.`)
    if (isRecord(node) && node.apis !== undefined) {
      if (!Array.isArray(node.apis)) errors.push(`${field}.apis must be an array.`)
      else node.apis.forEach((api, apiIndex) => validateApi(api, `${field}.apis[${apiIndex}]`, errors))
    }
  })
  const edges = Array.isArray(value.edges) ? value.edges : []
  nodes.forEach((node, index) => {
    if (isRecord(node) && typeof node.parentId === 'string') {
      const parent = nodes.find((candidate) => isRecord(candidate) && candidate.id === node.parentId)
      if (parent && parent.type !== 'group') errors.push(`nodes[${index}].parentId must reference a group node.`)
    }
  })
  edges.forEach((edge, index) => {
    if (!isRecord(edge) || typeof edge.source !== 'string' || typeof edge.target !== 'string' || !ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) errors.push(`edges[${index}] must reference two different existing nodes.`)
  })
  if (!Array.isArray(value.dependencies) || value.dependencies.some((dependency) => !isRecord(dependency) || typeof dependency.groupId !== 'string' || !dependency.groupId.trim() || typeof dependency.artifactId !== 'string' || !dependency.artifactId.trim())) errors.push('dependencies must contain valid groupId and artifactId values.')
  if (!stringArray(value.assumptions, 'assumptions', errors)) errors.push('assumptions are required.')
  if (!stringArray(value.clarificationQuestions, 'clarificationQuestions', errors)) errors.push('clarificationQuestions are required.')
  if (errors.length) throw new Error(`The model returned an invalid project design: ${errors.join(' ')}`)
  return value as unknown as PromptProjectDesign
}

export function parseDesignResponse(content: string): unknown {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The model did not return a JSON project design.')
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as unknown
  } catch {
    throw new Error('The model returned malformed JSON for the project design.')
  }
}

function inferNodeType(node: Record<string, unknown>): PromptDesignNode['type'] {
    const rawType = typeof node.type === 'string' ? node.type.toLowerCase().trim() : ''
    if (nodeTypes.has(rawType)) return rawType as PromptDesignNode['type']
    if (typeAliases[rawType]) return typeAliases[rawType]
    const text = `${node.id ?? ''} ${node.label ?? ''} ${node.description ?? ''}`.toLowerCase()
    if (/(controller|endpoint|api|rest)/.test(text)) return 'controller'
    if (/(database|postgres|mysql|mongo|redis|storage)/.test(text)) return 'database'
    if (/(queue|kafka|rabbit|event|message)/.test(text)) return 'queue'
    if (/(external|payment|gateway|provider|integration)/.test(text)) return 'external-system'
    return 'service'
  }

export function normalizeDesignResponse(value: unknown): unknown {
    if (!isRecord(value)) return value
    const nodes = Array.isArray(value.nodes) ? value.nodes.map((item) => {
      if (!isRecord(item)) return item
      const normalized: Record<string, unknown> = {
        ...item,
        type: inferNodeType(item),
        responsibilities: Array.isArray(item.responsibilities) ? item.responsibilities : [],
      }
      if (item.apis === null || item.apis === undefined) delete normalized.apis
      if (item.parentId === null || item.parentId === '') delete normalized.parentId
      // Normalize contract fields: null → undefined (omit), keep arrays as-is
      if (item.entityFields === null || item.entityFields === undefined) delete normalized.entityFields
      if (item.apiContracts === null || item.apiContracts === undefined) delete normalized.apiContracts
      if (item.serviceMethods === null || item.serviceMethods === undefined) delete normalized.serviceMethods
      if (item.configEntries === null || item.configEntries === undefined) delete normalized.configEntries
      return normalized
    }) : value.nodes
    return {
      ...value,
      framework: value.framework ?? 'spring-boot',
      architecture: value.architecture ?? 'monolith',
      nodes,
      edges: Array.isArray(value.edges) ? value.edges : [],
      dependencies: Array.isArray(value.dependencies) ? value.dependencies : [],
      assumptions: Array.isArray(value.assumptions) ? value.assumptions : [],
      clarificationQuestions: Array.isArray(value.clarificationQuestions) ? value.clarificationQuestions : [],
    }
  }

function visualKind(node: PromptDesignNode): string {
  if (node.type === 'controller') return 'API layer'
  if (node.type === 'database') return 'Database'
  if (node.type === 'service') return 'Service'
  if (node.type === 'group') return 'Subgroup'
  if (node.type === 'queue') return 'Queue'
  return 'External system'
}

export function mapDesignToGraph(design: PromptProjectDesign): ProjectGraph {
  const requiredGroups: Array<{ id: string; label: string; description: string }> = [
    { id: 'spring-configuration', label: 'Configuration', description: 'Spring Boot configuration, properties, and application setup' },
    { id: 'spring-controller', label: 'Controllers', description: 'Spring MVC REST controllers and request mapping' },
    { id: 'spring-service', label: 'Services', description: 'Spring service classes and business logic' },
    { id: 'spring-repository', label: 'Repositories', description: 'Spring Data repositories and persistence access' },
    { id: 'spring-model', label: 'Models', description: 'JPA entities, DTOs, and domain models' },
    { id: 'spring-infrastructure', label: 'Infrastructure', description: 'Databases, external systems, and application infrastructure' },
  ]
  const existingIds = new Set(design.nodes.map((node) => node.id))
  const groupNodes: PromptDesignNode[] = requiredGroups
    .filter((group) => !existingIds.has(group.id))
    .map((group) => ({ ...group, type: 'group', responsibilities: [] }))
  const allDesignNodes = [...groupNodes, ...design.nodes].map((node) => {
    if (node.type === 'group' || node.parentId) return node
    const parentId = node.type === 'controller'
      ? 'spring-controller'
      : node.type === 'service'
        ? 'spring-service'
        : node.type === 'database' || node.type === 'external-system' || node.type === 'queue'
          ? 'spring-infrastructure'
          : 'spring-model'
    return { ...node, parentId }
  })
  const nodes: WorkflowNode[] = allDesignNodes.map((node, index) => ({
    id: node.id,
    type: node.type === 'group' ? 'group' : 'default',
    position: { x: 36 + (index % 5) * 264, y: 80 + Math.floor(index / 5) * 145 },
    ...(node.parentId ? { parentId: node.parentId, extent: 'parent' as const } : {}),
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    ...(node.type === 'group' ? { style: { width: 230, height: 190 } } : {}),
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
  }))
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
