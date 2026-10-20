import fs from 'node:fs/promises'
import path from 'node:path'

export interface SpringStructureFile {
  path: string
  content: string
}

export interface SpringDependency {
  groupId: string
  artifactId: string
  version?: string
  scope?: string
}

export interface SpringStructureManifest {
  packageName: string
  directories: string[]
  files: SpringStructureFile[]
  dependencies: SpringDependency[]
}

export interface SpringStructurePreview extends SpringStructureManifest {
  projectPath: string
}

function isSafeRelativePath(value: string): boolean {
  return Boolean(value)
    && !path.posix.isAbsolute(value)
    && !value.split('/').includes('..')
    && !value.includes('\\')
    && !value.includes(':')
}

export function validateSpringStructure(manifest: SpringStructureManifest): SpringStructureManifest {
  if (typeof manifest.packageName !== 'string' || !manifest.packageName.trim()) {
    throw new Error('The model did not provide a Java package name.')
  }
  if (!Array.isArray(manifest.directories) || !Array.isArray(manifest.files)) {
    throw new Error('The model did not provide a complete folder structure.')
  }
  if (manifest.directories.some((directory) => typeof directory !== 'string' || !isSafeRelativePath(directory))) {
    throw new Error('The model returned an unsafe directory path.')
  }
  if (!Array.isArray(manifest.dependencies) || manifest.dependencies.some((dependency) => (
    !dependency || typeof dependency.groupId !== 'string' || typeof dependency.artifactId !== 'string'
  ))) {
    throw new Error('The model returned invalid dependencies.')
  }
  const files = manifest.files.map((file) => ({ path: file.path.replace(/\/+$/, ''), content: file.content }))
  const uniquePaths = new Set(files.map((file) => file.path))
  if (uniquePaths.size !== files.length) throw new Error('The model returned duplicate project files.')
  return {
    packageName: manifest.packageName.trim(),
    directories: [...new Set(manifest.directories.map((directory) => directory.replace(/\/+$/, '')))],
    files,
    dependencies: manifest.dependencies,
  }
}

export async function writeSpringProject(projectPath: string, manifest: SpringStructureManifest): Promise<SpringStructurePreview> {
  const validated = validateSpringStructure(manifest)
  await fs.mkdir(projectPath, { recursive: true })
  await Promise.all(validated.directories.map((directory) => fs.mkdir(path.join(projectPath, directory), { recursive: true })))
  for (const file of validated.files) {
    const destination = path.join(projectPath, ...file.path.split('/'))
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, file.content, 'utf8')
  }
  return { ...validated, projectPath }
}

export function isSpringProjectPath(projectPath: string): boolean {
  return path.normalize(projectPath).toLowerCase().startsWith(path.normalize(path.join('C:', 'nodetocode', 'projects')).toLowerCase() + path.sep)
}
