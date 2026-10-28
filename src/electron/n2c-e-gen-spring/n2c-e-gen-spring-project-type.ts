/**
 * n2c-e-gen-spring-project-type.ts
 *
 * Spring Boot implementation of the ProjectType interface.
 *
 * Key features:
 * 1. Segmented per-node generation: one file per LLM call, raw Java output (no giant JSON).
 * 2. Robust Maven detection: prioritizes project-level wrapper (`mvnw.cmd` on Windows, `./mvnw` on Unix),
 *    detects installed JDK / JAVA_HOME automatically, and falls back to global Maven.
 * 3. Intelligent node-to-code mapping: accurately recognizes entities, repositories, services,
 *    and controllers even when LLM labels or kinds vary.
 * 4. Structured prompt guidance: generates explicit import statements and annotations
 *    to maximize first-attempt compile success.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  CompileResult,
  GeneratedFile,
  GenerationGraph,
  GenerationStage,
  NodeGenerationJob,
  ProjectConfig,
  ProjectType,
} from '../n2c-e-gen-core/n2c-e-gen-project-type.js'

const execFileAsync = promisify(execFile)

// ─── Spring Initializr constants ──────────────────────────────────────────────

const springInitializrUrl = 'https://start.spring.io/starter.zip'
const springBootMetadataUrl = 'https://repo1.maven.org/maven2/org/springframework/boot/spring-boot-starter-parent/maven-metadata.xml'
const fallbackSpringBootVersion = '3.3.0'

const initializerDependencyIds: Record<string, string> = {
  'org.springframework.boot:spring-boot-starter-web': 'web',
  'org.springframework.boot:spring-boot-starter-webflux': 'webflux',
  'org.springframework.boot:spring-boot-starter-data-jpa': 'data-jpa',
  'org.springframework.boot:spring-boot-starter-validation': 'validation',
  'org.springframework.boot:spring-boot-starter-security': 'security',
  'org.springframework.boot:spring-boot-starter-test': 'test',
  'org.projectlombok:lombok': 'lombok',
  'com.h2database:h2': 'h2',
  'org.postgresql:postgresql': 'postgresql',
  'com.mysql:mysql-connector-j': 'mysql',
  'org.springframework.boot:spring-boot-starter-actuator': 'actuator',
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  return 0
}

export async function latestStableSpringBootVersion(): Promise<string> {
  try {
    const res = await fetch(springBootMetadataUrl)
    if (!res.ok) throw new Error(`${res.status}`)
    const xml = await res.text()
    const versions = [...xml.matchAll(/<version>(\d+\.\d+\.\d+)<\/version>/g)]
      .map(m => m[1])
      .filter(v => !v.includes('-'))
    return versions.sort(compareVersions).at(-1) ?? fallbackSpringBootVersion
  } catch {
    return fallbackSpringBootVersion
  }
}

/** Derive a Java class name from a node label, e.g. "user service" → "UserService" */
function toClassName(label: string): string {
  const cleaned = label
    .replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, '')
    .replace(/^\/?api\/?/i, '')
    .replace(/\b(demo|subgroup)\b/gi, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
  return cleaned || 'Item'
}

/** Derive a package sub-path from a package name, e.g. "com.myapp.demo" → "com/myapp/demo" */
function packageToPath(pkg: string): string {
  return pkg.replace(/\./g, '/')
}

/** Check if a graph node represents an Entity/Model */
function isEntityNode(node: GenerationGraph['nodes'][number]): boolean {
  if (!node.data) return false
  const kind = (node.data.kind ?? '').toLowerCase()
  const label = (node.data.label ?? '').toLowerCase()
  const id = node.id.toLowerCase()

  if (kind === 'subgroup' || kind === 'group' || /group|layer/.test(id)) return false
  if (kind === 'database' || /database|postgres|mysql|mongo|h2|redis|storage/.test(id) || /database|h2_db|postgres|mysql/.test(label)) return false
  if (kind === 'model' || kind === 'entity') return true
  if (node.data.entityFields && node.data.entityFields.length > 0) return true
  if (/^model-|^entity-/.test(id)) return true
  if (/entity|model|item|user|book|order|customer|product|account|record|table/i.test(label) && !/service|controller|repo/i.test(label)) return true

  return false
}

/** Check if a graph node represents a Controller */
function isControllerNode(node: GenerationGraph['nodes'][number]): boolean {
  if (!node.data) return false
  const kind = (node.data.kind ?? '').toLowerCase()
  const label = (node.data.label ?? '').toLowerCase()
  const id = node.id.toLowerCase()

  if (kind === 'subgroup' || kind === 'group' || /group|layer/.test(id)) return false
  if (kind === 'api layer' || kind === 'controller' || kind === 'api') return true
  if (node.data.apis?.length || node.data.apiContracts?.length) return true
  if (/controller|api|endpoint|rest/i.test(label) || /controller|api/i.test(id)) return true

  return false
}

/** Check if a graph node represents a Service */
function isServiceNode(node: GenerationGraph['nodes'][number]): boolean {
  if (!node.data) return false
  const kind = (node.data.kind ?? '').toLowerCase()
  const label = (node.data.label ?? '').toLowerCase()
  const id = node.id.toLowerCase()

  if (kind === 'subgroup' || kind === 'group' || /group|layer/.test(id)) return false
  if (isEntityNode(node) || isControllerNode(node)) return false
  if (kind === 'service' || node.data.serviceMethods?.length) return true
  if (/service|logic|manager/i.test(label) || /service/i.test(id)) return true

  return false
}

/**
 * Automatically locate installed JDK on Windows / Unix to populate JAVA_HOME
 * so maven wrapper (`mvnw.cmd`) can execute reliably without PATH issues.
 */
async function detectJavaEnvironment(): Promise<Record<string, string>> {
  const env: Record<string, string> = { ...process.env as Record<string, string> }

  if (env.JAVA_HOME) {
    try {
      await fs.access(env.JAVA_HOME)
      return env
    } catch { /* invalid JAVA_HOME, try detecting below */ }
  }

  if (process.platform === 'win32') {
    const searchBases = [
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft',
      'C:\\Program Files\\Amazon Corretto',
      'C:\\Program Files\\Zulu',
      'C:\\Program Files\\BellSoft',
      'C:\\Program Files (x86)\\Java',
    ]
    for (const base of searchBases) {
      try {
        const entries = await fs.readdir(base, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory() && (/jdk/i.test(entry.name) || /jre/i.test(entry.name))) {
            const candidate = path.join(base, entry.name)
            const javaExe = path.join(candidate, 'bin', 'java.exe')
            try {
              await fs.access(javaExe)
              env.JAVA_HOME = candidate
              env.PATH = `${path.join(candidate, 'bin')};${env.PATH ?? ''}`
              return env
            } catch { /* continue */ }
          }
        }
      } catch { /* continue */ }
    }
  } else {
    const searchBases = [
      '/usr/lib/jvm',
      '/Library/Java/JavaVirtualMachines',
      '/usr/local/opt/openjdk',
      '/opt/homebrew/opt/openjdk',
    ]
    for (const base of searchBases) {
      try {
        const entries = await fs.readdir(base, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const candidate = path.join(base, entry.name, entry.name.endsWith('.jdk') ? 'Contents/Home' : '')
            const javaBin = path.join(candidate, 'bin', 'java')
            try {
              await fs.access(javaBin)
              env.JAVA_HOME = candidate
              env.PATH = `${path.join(candidate, 'bin')}:${env.PATH ?? ''}`
              return env
            } catch { /* continue */ }
          }
        }
      } catch { /* continue */ }
    }
  }

  return env
}

/**
 * Compress a Java file to its class signatures only (no bodies).
 * This dramatically reduces context tokens when feeding prior files to the model.
 */
function compressToSignature(file: GeneratedFile): string {
  const lines = file.content.split('\n')
  const sig: string[] = []
  let inBody = 0
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('package ') || t.startsWith('import ')) { sig.push(t); continue }
    if (/^(@\w|public\s+(class|interface|enum|record)|abstract\s+class)/.test(t)) { sig.push(t.replace(/\{\s*$/, '{')); continue }
    if (inBody === 0 && t.endsWith(';') && !t.startsWith('//') && !t.startsWith('*')) { sig.push('  ' + t); continue }
    if (inBody === 0 && /^\s*(public|protected|private)\s+\S+\s+\w+\s*\(/.test(line)) {
      sig.push('  ' + t.replace(/\{\s*$/, '').trim() + ';')
    }
    for (const ch of t) {
      if (ch === '{') inBody++
      else if (ch === '}') inBody = Math.max(0, inBody - 1)
    }
  }
  return sig.join('\n')
}

/**
 * Build a brief context block from previously generated Java files.
 */
function buildPriorFilesContext(files: GeneratedFile[]): string {
  const javaFiles = files.filter(f => f.path.endsWith('.java'))
  if (!javaFiles.length) return ''
  const parts = javaFiles.map(f => `// ${f.path}\n${compressToSignature(f)}`).join('\n\n')
  const capped = parts.length > 5000 ? parts.slice(0, 5000) + '\n// ... (more files truncated)' : parts
  return `\n\n// Previously generated class signatures for reference:\n${capped}`
}

/**
 * Derive the node contract for one specific node, formatted as comments.
 */
function buildNodeContract(node: GenerationGraph['nodes'][number]): string {
  if (!node.data) return ''
  const lines: string[] = []
  if (node.data.description) lines.push(`// Description: ${node.data.description}`)
  if (node.data.entityFields?.length) {
    lines.push('// Fields:')
    for (const f of node.data.entityFields) {
      const rel = f.relationship ? ` [${f.relationship.type} -> ${f.relationship.target}]` : ''
      const con = f.constraints?.length ? ` [${f.constraints.join(', ')}]` : ''
      lines.push(`//   ${f.name}: ${f.type}${con}${rel}`)
    }
  }
  if (node.data.apiContracts?.length) {
    lines.push('// API contracts:')
    for (const a of node.data.apiContracts) {
      const body = a.requestBody ? ` body:${a.requestBody}` : ''
      const resp = a.responseType ? ` -> ${a.responseType}` : ''
      lines.push(`//   ${a.method} ${a.path}${body}${resp}`)
    }
  }
  if (node.data.serviceMethods?.length) {
    lines.push('// Service methods:')
    for (const m of node.data.serviceMethods) {
      lines.push(`//   ${m.returnType ?? 'void'} ${m.name}(${m.params ?? ''}) - ${m.description}`)
    }
  }
  if (node.data.configEntries?.length) {
    lines.push('// Config entries:')
    for (const c of node.data.configEntries) {
      lines.push(`//   ${c.key} = ${c.value ?? '<required>'}${c.description ? ' // ' + c.description : ''}`)
    }
  }
  if (node.data.apis?.length && !node.data.apiContracts?.length) {
    lines.push('// APIs:')
    for (const a of node.data.apis) {
      lines.push(`//   ${a.method} ${a.path} - ${a.description}`)
    }
  }
  return lines.join('\n')
}

// ─── SpringBootProjectType ────────────────────────────────────────────────────

export class SpringBootProjectType implements ProjectType {
  readonly id = 'spring-boot'
  readonly label = 'Spring Boot'

  private cachedVersion: string | null = null

  async resolvedVersion(): Promise<string> {
    if (!this.cachedVersion) this.cachedVersion = await latestStableSpringBootVersion()
    return this.cachedVersion
  }

  // ── initializeProject ────────────────────────────────────────────────────────

  async initializeProject(projectPath: string, config: ProjectConfig): Promise<{ directories: string[] }> {
    const version = await this.resolvedVersion()
    const depIds = [...new Set(
      config.dependencies
        .map(d => initializerDependencyIds[`${d.groupId}:${d.artifactId}`])
        .filter((id): id is string => Boolean(id))
    )]
    // Sanitize artifactId and baseDir for Spring Initializr (no spaces, valid maven identifier)
    const safeArtifactId = config.name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'app'

    const params = new URLSearchParams({
      type: 'maven-project',
      language: 'java',
      bootVersion: version,
      baseDir: safeArtifactId,
      groupId: config.packageName,
      artifactId: safeArtifactId,
      name: config.name,
      packageName: config.packageName,
      javaVersion: '21',
      dependencies: depIds.join(','),
    })

    let response: Response
    try {
      response = await fetch(`${springInitializrUrl}?${params.toString()}`)
    } catch (cause) {
      throw new Error(`Spring Initializr could not be reached. Check your internet connection. ${cause instanceof Error ? cause.message : ''}`, { cause })
    }
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`Spring Initializr rejected the request (${response.status}). ${detail || 'Check selected dependencies.'}`)
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'n2c-initializr-'))
    const archivePath = path.join(tempRoot, 'starter.zip')
    const extractPath = path.join(tempRoot, 'extracted')

    try {
      const archive = Buffer.from(await response.arrayBuffer())
      if (archive.length < 4 || archive[0] !== 0x50 || archive[1] !== 0x4b) {
        throw new Error('Spring Initializr returned an invalid archive. Please try again.')
      }
      await fs.writeFile(archivePath, archive)
      await fs.mkdir(extractPath, { recursive: true })

      const extractScript = '& { param([string] $a, [string] $d); Expand-Archive -LiteralPath $a -DestinationPath $d -Force }'
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', extractScript, archivePath, extractPath], { windowsHide: true })

      // Locate starter root dynamically by checking for pom.xml
      const extractedEntries = await fs.readdir(extractPath, { withFileTypes: true })
      let starterRoot = extractPath

      const directPom = path.join(extractPath, 'pom.xml')
      const hasDirectPom = await fs.access(directPom).then(() => true).catch(() => false)

      if (!hasDirectPom) {
        const subdirs = extractedEntries.filter(e => e.isDirectory())
        let pomDir: string | null = null

        for (const dir of subdirs) {
          const candidate = path.join(extractPath, dir.name)
          const pomPath = path.join(candidate, 'pom.xml')
          if (await fs.access(pomPath).then(() => true).catch(() => false)) {
            pomDir = candidate
            break
          }
        }

        if (pomDir) {
          starterRoot = pomDir
        } else if (subdirs.length === 1) {
          starterRoot = path.join(extractPath, subdirs[0].name)
        } else {
          const match = subdirs.find(d =>
            d.name.toLowerCase() === safeArtifactId.toLowerCase() ||
            d.name.toLowerCase() === config.name.toLowerCase()
          )
          starterRoot = match ? path.join(extractPath, match.name) : (subdirs[0] ? path.join(extractPath, subdirs[0].name) : extractPath)
        }
      }

      await fs.rm(projectPath, { recursive: true, force: true })
      await fs.mkdir(path.dirname(projectPath), { recursive: true })
      await fs.cp(starterRoot, projectPath, { recursive: true })
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }

    const directories = await this._collectDirectories(projectPath)
    return { directories }
  }

  // ── generationStages ─────────────────────────────────────────────────────────

  generationStages(): GenerationStage[] {
    return [
      {
        name: 'application config',
        instructions: 'Generate application.properties or application.yml ONLY if custom settings are needed. Do NOT generate pom.xml or Java files.',
        allowEmpty: true,
      },
      {
        name: 'entities and DTOs',
        instructions: 'Generate JPA @Entity classes and DTOs. One file per node.',
      },
      {
        name: 'repositories',
        instructions: 'Generate Spring Data JPA repository interfaces for each entity.',
      },
      {
        name: 'service layer',
        instructions: 'Generate @Service classes with constructor-injected repositories.',
      },
      {
        name: 'controller layer',
        instructions: 'Generate @RestController classes for every API in the graph.',
      },
    ]
  }

  // ── buildNodeJobs ─────────────────────────────────────────────────────────────

  buildNodeJobs(stage: GenerationStage, graph: GenerationGraph, config: ProjectConfig): NodeGenerationJob[] {
    const pkg = packageToPath(config.packageName)
    const basePath = `src/main/java/${pkg}`
    const jobs: NodeGenerationJob[] = []

    if (stage.name === 'application config') {
      jobs.push({
        nodeId: '__config__',
        nodeLabel: 'Application Config',
        stageName: stage.name,
        fileKind: 'config',
        targetPath: 'src/main/resources/application.properties',
        progressLabel: 'Generating application config…',
      })
      return jobs
    }

    // Identify all entity nodes (or extract from services/controllers if no explicit entity exists)
    const rawEntityNodes = graph.nodes.filter(isEntityNode)
    let entityClassNames: string[] = []

    if (rawEntityNodes.length > 0) {
      entityClassNames = rawEntityNodes.map(n => {
        const raw = (n.data?.label ?? 'Entity').replace(/\s*(Entity|Model|Repo|Repository|Service|Controller)\s*/gi, '').trim()
        return toClassName(raw || 'Item')
      })
    } else {
      // Derive entity from services / controllers so we always have a working model layer
      const serviceOrControllerNodes = graph.nodes.filter(n => isServiceNode(n) || isControllerNode(n))
      entityClassNames = [...new Set(serviceOrControllerNodes.map(n => {
        const raw = (n.data?.label ?? 'Item').replace(/\s*(Service|Controller|Api)\s*/gi, '').trim()
        return toClassName(raw || 'Item')
      }))]
      if (entityClassNames.length === 0) {
        entityClassNames = ['Item']
      }
    }
    // Deduplicate class names
    entityClassNames = [...new Set(entityClassNames)]

    if (stage.name === 'entities and DTOs') {
      for (const className of entityClassNames) {
        const matchingNode = rawEntityNodes.find(n => (n.data?.label ?? '').includes(className)) ?? graph.nodes[0]
        jobs.push({
          nodeId: matchingNode?.id ?? `entity-${className.toLowerCase()}`,
          nodeLabel: className,
          stageName: stage.name,
          fileKind: 'entity',
          targetPath: `${basePath}/model/${className}.java`,
          progressLabel: `Generating ${className} entity…`,
        })
        jobs.push({
          nodeId: matchingNode?.id ?? `dto-${className.toLowerCase()}`,
          nodeLabel: `${className}DTO`,
          stageName: stage.name,
          fileKind: 'dto',
          targetPath: `${basePath}/dto/${className}DTO.java`,
          progressLabel: `Generating ${className}DTO…`,
        })
      }
      return jobs
    }

    if (stage.name === 'repositories') {
      for (const className of entityClassNames) {
        const matchingNode = rawEntityNodes.find(n => (n.data?.label ?? '').includes(className)) ?? graph.nodes[0]
        jobs.push({
          nodeId: matchingNode?.id ?? `repo-${className.toLowerCase()}`,
          nodeLabel: `${className}Repository`,
          stageName: stage.name,
          fileKind: 'repository',
          targetPath: `${basePath}/repository/${className}Repository.java`,
          progressLabel: `Generating ${className}Repository…`,
        })
      }
      return jobs
    }

    if (stage.name === 'service layer') {
      const serviceNodes = graph.nodes.filter(isServiceNode)
      if (serviceNodes.length > 0) {
        for (const node of serviceNodes) {
          const raw = (node.data?.label ?? 'Service').replace(/\s*Service\s*/gi, '').trim()
          const baseName = toClassName(raw || 'App')
          const safeName = baseName.endsWith('Service') ? baseName : `${baseName}Service`
          jobs.push({
            nodeId: node.id,
            nodeLabel: safeName,
            stageName: stage.name,
            fileKind: 'service',
            targetPath: `${basePath}/service/${safeName}.java`,
            progressLabel: `Generating ${safeName}…`,
          })
        }
      } else {
        // Generate one service per entity
        for (const className of entityClassNames) {
          const safeName = `${className}Service`
          jobs.push({
            nodeId: `service-${className.toLowerCase()}`,
            nodeLabel: safeName,
            stageName: stage.name,
            fileKind: 'service',
            targetPath: `${basePath}/service/${safeName}.java`,
            progressLabel: `Generating ${safeName}…`,
          })
        }
      }
      return jobs
    }

    if (stage.name === 'controller layer') {
      const controllerNodes = graph.nodes.filter(isControllerNode)
      if (controllerNodes.length > 0) {
        for (const node of controllerNodes) {
          const raw = (node.data?.label ?? 'Controller').replace(/\s*Controller\s*/gi, '').trim()
          const baseName = toClassName(raw || 'App')
          const safeName = baseName.endsWith('Controller') ? baseName : `${baseName}Controller`
          jobs.push({
            nodeId: node.id,
            nodeLabel: safeName,
            stageName: stage.name,
            fileKind: 'controller',
            targetPath: `${basePath}/controller/${safeName}.java`,
            progressLabel: `Generating ${safeName}…`,
          })
        }
      } else {
        // Generate one controller per entity
        for (const className of entityClassNames) {
          const safeName = `${className}Controller`
          jobs.push({
            nodeId: `controller-${className.toLowerCase()}`,
            nodeLabel: safeName,
            stageName: stage.name,
            fileKind: 'controller',
            targetPath: `${basePath}/controller/${safeName}.java`,
            progressLabel: `Generating ${safeName}…`,
          })
        }
      }
      return jobs
    }

    return jobs
  }

  // ── buildNodePrompt ───────────────────────────────────────────────────────────

  buildNodePrompt(job: NodeGenerationJob, graph: GenerationGraph, files: GeneratedFile[], config: ProjectConfig): string {
    const version = this.cachedVersion ?? fallbackSpringBootVersion
    const node = graph.nodes.find(n => n.id === job.nodeId)
    const contract = node ? buildNodeContract(node) : ''
    const context = buildPriorFilesContext(files)
    const targetFile = job.targetPath.split('/').pop() ?? ''

    // Derive root entity name from job target or label
    const baseEntity = job.nodeLabel.replace(/\s*(Repository|Service|Controller|DTO|Entity)\s*/gi, '').trim() || 'Item'

    const instructions: Record<NodeGenerationJob['fileKind'], string> = {
      entity: `Write a JPA @Entity class for "${job.nodeLabel}".
Package: package ${config.packageName}.model;
Required imports:
  import jakarta.persistence.*;
  import java.time.LocalDateTime;

Annotations:
  @Entity
  @Table(name = "${baseEntity.toLowerCase()}s")
Fields:
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;
  // Include all additional fields from the contract or defaults (name, description, createdAt, updatedAt)
Methods:
  Provide a default no-args constructor, an all-args constructor, and standard public getters and setters for all fields.`,

      dto: `Write a plain Java DTO class for "${job.nodeLabel}".
Package: package ${config.packageName}.dto;
Required imports:
  import java.time.LocalDateTime;

Fields:
  private Long id;
  // Include matching fields from the entity
Methods:
  Provide no-args constructor, all-args constructor, and standard public getters and setters. No JPA annotations.`,

      repository: `Write a Spring Data JPA repository interface for "${job.nodeLabel}".
Package: package ${config.packageName}.repository;
Required imports:
  import org.springframework.data.jpa.repository.JpaRepository;
  import org.springframework.stereotype.Repository;
  import ${config.packageName}.model.${baseEntity};

Definition:
  @Repository
  public interface ${baseEntity}Repository extends JpaRepository<${baseEntity}, Long> {
      // Add custom finder methods if described in contract
  }`,

      service: `Write a Spring @Service class for "${job.nodeLabel}".
Package: package ${config.packageName}.service;
Required imports:
  import org.springframework.stereotype.Service;
  import org.springframework.beans.factory.annotation.Autowired;
  import java.util.List;
  import java.util.Optional;
  import ${config.packageName}.model.${baseEntity};
  import ${config.packageName}.repository.${baseEntity}Repository;
  import ${config.packageName}.dto.${baseEntity}DTO;

Requirements:
  - Annotate with @Service
  - Inject ${baseEntity}Repository using constructor injection
  - Implement CRUD methods: findAll(), findById(Long id), save(${baseEntity} entity), deleteById(Long id)
  - Implement any additional methods from the contract`,

      controller: `Write a Spring @RestController class for "${job.nodeLabel}".
Package: package ${config.packageName}.controller;
Required imports:
  import org.springframework.web.bind.annotation.*;
  import org.springframework.http.ResponseEntity;
  import org.springframework.http.HttpStatus;
  import java.util.List;
  import ${config.packageName}.model.${baseEntity};
  import ${config.packageName}.service.${baseEntity}Service;
  import ${config.packageName}.dto.${baseEntity}DTO;

Requirements:
  - Annotate with @RestController and @RequestMapping("/api/${baseEntity.toLowerCase()}s")
  - Inject ${baseEntity}Service via constructor injection
  - Implement standard REST endpoints:
      @GetMapping -> List<${baseEntity}>
      @GetMapping("/{id}") -> ResponseEntity<${baseEntity}>
      @PostMapping -> ResponseEntity<${baseEntity}> with @RequestBody
      @PutMapping("/{id}") -> ResponseEntity<${baseEntity}> with @PathVariable and @RequestBody
      @DeleteMapping("/{id}") -> ResponseEntity<Void> with @PathVariable`,

      config: `Write an application.properties file for Spring Boot ${version}.
Include:
  spring.application.name=${config.name}
  server.port=8080
  spring.datasource.url=jdbc:h2:mem:${config.name}db;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE
  spring.datasource.driverClassName=org.h2.Driver
  spring.datasource.username=sa
  spring.datasource.password=
  spring.jpa.database-platform=org.hibernate.dialect.H2Dialect
  spring.jpa.hibernate.ddl-auto=update
  spring.jpa.show-sql=true
  spring.h2.console.enabled=true
  spring.h2.console.path=/h2-console`,
    }

    return `You are writing a single Java file for a Spring Boot ${version} project.

TARGET FILE: ${targetFile}
PACKAGE: ${config.packageName}

TASK: ${instructions[job.fileKind]}

${contract ? `CONTRACT FOR THIS NODE:\n${contract}` : ''}

RULES:
- Output ONLY the raw Java source code for ${targetFile}. No JSON, no markdown fences, no explanations.
- Start directly with the package declaration (e.g. package ${config.packageName}...).
- Use Java 21 syntax.
- Ensure all required imports are present and types match.
${context}`
  }

  // ── parseNodeResponse ─────────────────────────────────────────────────────────

  parseNodeResponse(response: string, job: NodeGenerationJob): GeneratedFile {
    let content = response.trim()

    // 1. If wrapped in markdown code fence anywhere in the response, extract it
    const fenceMatch = /```(?:java|properties|yaml|yml)?\s*([\s\S]*?)```/i.exec(content)
    if (fenceMatch && fenceMatch[1].trim()) {
      content = fenceMatch[1].trim()
    } else {
      content = content.replace(/^```[a-z]*\s*/im, '').replace(/\s*```\s*$/im, '').trim()
    }

    if (job.fileKind === 'config') {
      return { path: job.targetPath, content }
    }

    // 2. If preceded by conversational introductory text before 'package ', slice from 'package '
    const packageIdx = content.indexOf('package ')
    if (packageIdx > 0) {
      const before = content.slice(0, packageIdx).trim()
      if (!before.startsWith('/*') && !before.startsWith('//')) {
        content = content.slice(packageIdx).trim()
      }
    }

    if (!content.includes('package ') && !content.includes('class ') && !content.includes('interface ') && !content.includes('record ')) {
      throw new Error(`Model did not return valid Java content for ${job.targetPath}. Got: ${content.slice(0, 200)}`)
    }

    return { path: job.targetPath, content }
  }

  // ── buildStageFallbackPrompt ──────────────────────────────────────────────────

  buildStageFallbackPrompt(stage: GenerationStage, graph: GenerationGraph, config: ProjectConfig): string {
    const version = this.cachedVersion ?? fallbackSpringBootVersion
    return `Generate Spring Boot ${version} configuration for "${config.name}".
Package: ${config.packageName}
Target: src/main/resources/application.properties

Return ONLY valid JSON: {"files":[{"path":"src/main/resources/application.properties","content":"..."}]}`
  }

  // ── compileProject ────────────────────────────────────────────────────────────

  async compileProject(projectPath: string): Promise<CompileResult> {
    const isWin = process.platform === 'win32'
    const env = await detectJavaEnvironment()

    // 1. Check for the local Maven wrapper in the project directory
    const wrapperName = isWin ? 'mvnw.cmd' : 'mvnw'
    const wrapperPath = path.join(projectPath, wrapperName)
    let hasWrapper = false
    try {
      await fs.access(wrapperPath)
      hasWrapper = true
    } catch {
      hasWrapper = false
    }

    const commands: Array<{ executable: string; args: string[]; label: string }> = []

    if (hasWrapper) {
      if (isWin) {
        commands.push({
          executable: 'cmd.exe',
          args: ['/d', '/s', '/c', 'mvnw.cmd compile -DskipTests'],
          label: 'mvnw.cmd (Maven Wrapper)',
        })
      } else {
        try { await fs.chmod(wrapperPath, 0o755) } catch { /* ignore */ }
        commands.push({
          executable: wrapperPath,
          args: ['compile', '-DskipTests'],
          label: './mvnw (Maven Wrapper)',
        })
        commands.push({
          executable: 'sh',
          args: ['mvnw', 'compile', '-DskipTests'],
          label: 'sh mvnw (Maven Wrapper)',
        })
      }
    }

    // 2. Global / System Maven commands
    if (isWin) {
      commands.push({ executable: 'cmd.exe', args: ['/d', '/s', '/c', 'mvn.cmd compile -DskipTests'], label: 'mvn.cmd (Global)' })
      commands.push({ executable: 'cmd.exe', args: ['/d', '/s', '/c', 'mvn compile -DskipTests'], label: 'mvn (Global)' })
    } else {
      commands.push({ executable: 'mvn', args: ['compile', '-DskipTests'], label: 'mvn (Global)' })
    }

    // 3. Check MAVEN_HOME / M2_HOME
    const mHome = env.MAVEN_HOME || env.M2_HOME
    if (mHome) {
      const mvnBin = path.join(mHome, 'bin', isWin ? 'mvn.cmd' : 'mvn')
      try {
        await fs.access(mvnBin)
        commands.push({
          executable: isWin ? 'cmd.exe' : mvnBin,
          args: isWin ? ['/d', '/s', '/c', `"${mvnBin}" compile -DskipTests`] : ['compile', '-DskipTests'],
          label: `${mvnBin}`,
        })
      } catch { /* ignore */ }
    }

    let lastError = 'Maven was not found. Please install Maven or verify project has mvnw.'
    for (const cmd of commands) {
      try {
        const result = await execFileAsync(cmd.executable, cmd.args, {
          cwd: projectPath,
          timeout: 240_000,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
          env,
        })
        return { success: true, available: true, output: `${result.stdout}\n${result.stderr}`.trim() }
      } catch (cause) {
        const err = cause as { code?: string | number; stdout?: string; stderr?: string; message?: string }
        if (err.code === 'ENOENT') {
          lastError = `${cmd.label} was not found on PATH.`
          continue
        }
        const output = `${err.stdout ?? ''}\n${err.stderr ?? err.message ?? 'Maven compilation failed.'}`.trim()
        if (/not recognized as an internal or external command|could not find or load|cannot find the path/i.test(output)) {
          lastError = `${cmd.label} failed to execute.`
          continue
        }
        return { success: false, available: true, output }
      }
    }

    return { success: false, available: false, output: lastError }
  }

  // ── parseBuildDiagnostics ─────────────────────────────────────────────────────

  parseBuildDiagnostics(output: string): Array<{ file: string; line?: number; message: string }> {
    const result: Array<{ file: string; line?: number; message: string }> = []
    const regex = /\[ERROR\]\s+(?:[^\n]*?[/\\])?(?:src[/\\])?([\w/\\]+\.java)(?::\[(\d+),\d+\])?\s*(.*)/g
    let m: RegExpExecArray | null
    while ((m = regex.exec(output)) !== null) {
      result.push({
        file: 'src/' + m[1].replace(/\\/g, '/'),
        line: m[2] ? parseInt(m[2], 10) : undefined,
        message: m[3].trim(),
      })
    }
    return result
  }

  // ── buildFileRepairPrompt ─────────────────────────────────────────────────────

  buildFileRepairPrompt(filePath: string, fileContent: string, errors: string[], config: ProjectConfig): string {
    const version = this.cachedVersion ?? fallbackSpringBootVersion
    const fileName = filePath.split('/').pop() ?? filePath
    return `Fix the following Java file so it compiles without errors.
Spring Boot ${version}, Java 21, package ${config.packageName}.

Output ONLY the corrected Java source for ${fileName}. No markdown fences, no JSON, no explanation.
Start directly with "package ".

FILE: ${filePath}
ERRORS:
${errors.join('\n')}

CURRENT CONTENT:
${fileContent}`
  }

  // ── protectedPaths ────────────────────────────────────────────────────────────

  protectedPaths(): string[] {
    return ['pom.xml', 'mvnw', 'mvnw.cmd', '.mvn/', '.gitignore', 'HELP.md']
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private async _collectDirectories(rootPath: string, current = ''): Promise<string[]> {
    const entries = await fs.readdir(path.join(rootPath, current), { withFileTypes: true })
    const dirs: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const rel = current ? `${current}/${entry.name}` : entry.name
      dirs.push(rel, ...await this._collectDirectories(rootPath, rel))
    }
    return dirs
  }
}

/** Singleton instance used by main.ts */
export const springBootProjectType = new SpringBootProjectType()
