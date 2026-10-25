export type ActivityView = 'explorer' | 'graph' | 'diagrams' | 'settings'

export type BottomPanelTab = 'output' | 'problems'

export interface EditorTab {
  id: string
  label: string
  kind: 'home' | 'graph' | 'diagram' | 'code-preview'
  dirty?: boolean
}
