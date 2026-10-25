import { createContext } from 'react'
import type { ActivityView, BottomPanelTab, EditorTab } from './n2c-ui-ide-types'

export interface IDEContextValue {
  activeView: ActivityView
  setActiveView: (view: ActivityView) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  inspectorCollapsed: boolean
  toggleInspector: () => void
  bottomPanelCollapsed: boolean
  toggleBottomPanel: () => void
  bottomPanelTab: BottomPanelTab
  setBottomPanelTab: (tab: BottomPanelTab) => void
  tabs: EditorTab[]
  activeTabId: string
  openTab: (tab: EditorTab) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  outputLines: string[]
  addOutputLine: (line: string) => void
  clearOutput: () => void
}

export const IDEContext = createContext<IDEContextValue | null>(null)
