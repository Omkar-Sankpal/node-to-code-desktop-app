export type ActivityView = 'explorer' | 'graph' | 'diagrams' | 'settings'

export type BottomPanelTab = 'output' | 'problems' | 'build'

export interface EditorTab {
  id: string
  label: string
  kind: 'home' | 'graph' | 'diagram' | 'code-preview'
  dirty?: boolean
}

export interface BuildDiagnostic {
  file: string
  line?: number
  message: string
  severity: 'error' | 'warning'
}

export interface BuildResult {
  success: boolean
  available: boolean
  diagnostics: BuildDiagnostic[]
  rawOutput: string
}
