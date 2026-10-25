import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ActivityView, BottomPanelTab, EditorTab } from './n2c-ui-ide-types'
import { IDEContext } from './n2c-ui-ide-context-value'

const defaultTab: EditorTab = { id: 'welcome', label: 'Welcome', kind: 'home' }

export default function IDEProvider({ children }: { children: ReactNode }) {
  const [activeView, setActiveView] = useState<ActivityView>('explorer')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const [bottomPanelCollapsed, setBottomPanelCollapsed] = useState(true)
  const [bottomPanelTab, setBottomPanelTab] = useState<BottomPanelTab>('output')
  const [tabs, setTabs] = useState<EditorTab[]>([defaultTab])
  const [activeTabId, setActiveTabId] = useState(defaultTab.id)
  const [outputLines, setOutputLines] = useState<string[]>([])

  const toggleSidebar = useCallback(() => setSidebarCollapsed(prev => !prev), [])
  const toggleInspector = useCallback(() => setInspectorCollapsed(prev => !prev), [])
  const toggleBottomPanel = useCallback(() => setBottomPanelCollapsed(prev => !prev), [])

  const openTab = useCallback((tab: EditorTab) => {
    setTabs(current => current.some(t => t.id === tab.id) ? current : [...current, tab])
    setActiveTabId(tab.id)
  }, [])

  const closeTab = useCallback((tabId: string) => {
    setTabs(current => {
      const next = current.filter(t => t.id !== tabId)
      return next.length === 0 ? [defaultTab] : next
    })
    setActiveTabId(prev => prev === tabId ? defaultTab.id : prev)
  }, [])

  const addOutputLine = useCallback((line: string) => {
    setOutputLines(current => [...current.slice(-500), line])
  }, [])

  const clearOutput = useCallback(() => setOutputLines([]), [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === 'b') {
        event.preventDefault()
        toggleSidebar()
      }
      if (event.ctrlKey && event.key === 'j') {
        event.preventDefault()
        toggleBottomPanel()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleSidebar, toggleBottomPanel])

  const value = useMemo(() => ({
    activeView, setActiveView,
    sidebarCollapsed, toggleSidebar,
    inspectorCollapsed, toggleInspector,
    bottomPanelCollapsed, toggleBottomPanel,
    bottomPanelTab, setBottomPanelTab,
    tabs, activeTabId, openTab, closeTab, setActiveTab: setActiveTabId,
    outputLines, addOutputLine, clearOutput,
  }), [
    activeView, sidebarCollapsed, inspectorCollapsed, bottomPanelCollapsed,
    bottomPanelTab, tabs, activeTabId, outputLines,
    toggleSidebar, toggleInspector, toggleBottomPanel, openTab, closeTab,
    addOutputLine, clearOutput,
  ])

  return <IDEContext value={value}>{children}</IDEContext>
}
