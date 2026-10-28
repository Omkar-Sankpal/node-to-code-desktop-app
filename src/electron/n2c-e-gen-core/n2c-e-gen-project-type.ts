/**
 * n2c-e-gen-project-type.ts
 *
 * Defines the pluggable ProjectType interface that abstracts the code-generation
 * pipeline. Each backend framework (Spring Boot, React, Next.js, etc.) implements
 * this interface so the core generateProject() function stays framework-agnostic.
 *
 * Key design: generation is PER-NODE, not per-stage-batch.
 * Each NodeGenerationJob produces exactly ONE file in one LLM call,
 * preventing the "token repeat limit reached" abort that happens when
 * the model tries to output all files in one giant JSON blob.
 */

export interface GeneratedFile {
  path: string
  content: string
}

export interface GenerationGraph {
  nodes: Array<{
    id: string
    data?: {
      label?: string
      description?: string
      kind?: string
      apis?: Array<{ method: string; path: string; description: string }>
      apiContracts?: Array<{ method: string; path: string; description: string; requestBody?: string; responseType?: string; pathParams?: string[]; queryParams?: string[] }>
      entityFields?: Array<{ name: string; type: string; constraints?: string[]; relationship?: { type: string; target: string; mappedBy?: string } }>
      serviceMethods?: Array<{ name: string; description: string; params?: string; returnType?: string; dependencies?: string[] }>
      configEntries?: Array<{ key: string; value?: string; description?: string }>
      packagePath?: string
    }
  }>
  edges: Array<{ source: string; target: string }>
}

export interface GenerationStage {
  name: string
  instructions: string
  allowEmpty?: boolean
}

export interface CompileResult {
  success: boolean
  available: boolean
  output: string
}

export interface ProjectConfig {
  name: string
  packageName: string
  dependencies: Array<{ groupId: string; artifactId: string; version?: string; scope?: string }>
  [key: string]: unknown
}

/**
 * A single unit of per-node segmented generation.
 * Each job produces exactly ONE file in one focused LLM call.
 * The model is told exactly what class to write and where to put it,
 * so it never needs to output more than ~200 lines.
 */
export interface NodeGenerationJob {
  /** Which graph node this job is for */
  nodeId: string
  /** Human-readable node name, e.g. "UserService" */
  nodeLabel: string
  /** The stage this job belongs to */
  stageName: string
  /**
   * What file to generate, e.g. 'entity', 'dto', 'repository', 'service', 'controller', 'config'
   */
  fileKind: 'entity' | 'dto' | 'repository' | 'service' | 'controller' | 'config'
  /**
   * The exact relative path the file must be written to.
   * Constructed by the host so the model doesn't have to guess.
   * e.g. "src/main/java/com/acme/myapp/model/User.java"
   */
  targetPath: string
  /**
   * Human-readable progress label shown in the UI status bar.
   * e.g. "Generating User entity…"
   */
  progressLabel: string
}

/**
 * A ProjectType encapsulates everything framework-specific about code generation:
 * - How to initialize the project scaffold (e.g. calling Spring Initializr)
 * - Which per-node generation jobs to run and in what order
 * - How to build per-job focused LLM prompts (one file per call)
 * - How to compile and verify the generated project
 */
export interface ProjectType {
  /** Unique identifier for this project type, e.g. 'spring-boot' */
  id: string

  /** Human-readable label shown in the UI, e.g. 'Spring Boot' */
  label: string

  /**
   * Initialize the project scaffold at the given path.
   * For Spring Boot: downloads the Initializr starter zip and extracts it.
   */
  initializeProject(projectPath: string, config: ProjectConfig): Promise<{ directories: string[] }>

  /**
   * Returns the ordered list of generation stages (for progress display only).
   * The actual work is done per-job via buildNodeJobs().
   */
  generationStages(): GenerationStage[]

  /**
   * Decompose a generation stage into individual per-node jobs.
   * Each job will produce exactly one file in one LLM call.
   */
  buildNodeJobs(stage: GenerationStage, graph: GenerationGraph, config: ProjectConfig): NodeGenerationJob[]

  /**
   * Build a focused single-file prompt for one node job.
   * The model is asked to return raw file content only (no JSON wrapper).
   * @param job      - The specific file to generate
   * @param graph    - Full graph for cross-node references
   * @param files    - Previously generated files (for imports/types)
   * @param config   - Project config
   */
  buildNodePrompt(job: NodeGenerationJob, graph: GenerationGraph, files: GeneratedFile[], config: ProjectConfig): string

  /**
   * Parse the raw model output for a single-file node job.
   * Strips markdown fences and validates it looks like the right kind of file.
   */
  parseNodeResponse(response: string, job: NodeGenerationJob): GeneratedFile

  /**
   * Fallback batch prompt for a stage when per-node generation is not possible
   * (e.g. the config stage that has no specific nodes).
   * Returns JSON: {"files": [...]}
   */
  buildStageFallbackPrompt(stage: GenerationStage, graph: GenerationGraph, config: ProjectConfig): string

  /**
   * Compile / verify the generated project.
   * Returns success=true if the project builds without errors.
   * Returns available=false if the required build tool (Maven, npm) is not installed.
   */
  compileProject(projectPath: string): Promise<CompileResult>

  /**
   * Parse build tool output into structured per-file diagnostics.
   */
  parseBuildDiagnostics(output: string): Array<{ file: string; line?: number; message: string }>

  /**
   * Build a repair prompt for a specific broken file.
   * Returns raw file content (not JSON).
   */
  buildFileRepairPrompt(filePath: string, fileContent: string, errors: string[], config: ProjectConfig): string

  /**
   * File paths that should never be replaced by LLM-generated output.
   * E.g. pom.xml, mvnw, .mvn/ for Spring Boot.
   */
  protectedPaths(): string[]
}
