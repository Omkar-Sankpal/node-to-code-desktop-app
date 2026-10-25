import { useIDE } from './n2c-ui-ide-hooks'

export default function EditorTabs() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useIDE()

  return (
    <div className="ide-editor-tabs">
      {tabs.map(tab => (
        <div key={tab.id} className={`ide-tab ${tab.id === activeTabId ? 'ide-tab-active' : ''}`}>
          <button className="ide-tab-button" onClick={() => setActiveTab(tab.id)} title={tab.label} type="button">
            {tab.dirty && <span className="ide-tab-dirty">●</span>}
            <span className="ide-tab-label">{tab.label}</span>
          </button>
          {tabs.length > 1 && (
            <button className="ide-tab-close" onClick={() => closeTab(tab.id)} title={`Close ${tab.label}`} type="button" aria-label={`Close ${tab.label}`}>×</button>
          )}
        </div>
      ))}
    </div>
  )
}
