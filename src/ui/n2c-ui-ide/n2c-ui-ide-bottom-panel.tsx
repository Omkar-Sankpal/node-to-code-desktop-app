import { useIDE } from './n2c-ui-ide-hooks'
import type { BottomPanelTab } from './n2c-ui-ide-types'

const panelTabs: Array<{ id: BottomPanelTab; label: string }> = [
  { id: 'output', label: 'Output' },
  { id: 'problems', label: 'Problems' },
]

export default function BottomPanel() {
  const { bottomPanelCollapsed, toggleBottomPanel, bottomPanelTab, setBottomPanelTab, outputLines, clearOutput } = useIDE()

  if (bottomPanelCollapsed) return null

  return (
    <div className="ide-bottom-panel">
      <div className="ide-bottom-panel-header">
        <div className="ide-bottom-panel-tabs">
          {panelTabs.map(tab => (
            <button
              key={tab.id}
              className={`ide-bottom-tab ${tab.id === bottomPanelTab ? 'ide-bottom-tab-active' : ''}`}
              onClick={() => setBottomPanelTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="ide-bottom-panel-actions">
          {bottomPanelTab === 'output' && (
            <button className="ide-panel-action" onClick={clearOutput} type="button" title="Clear output" aria-label="Clear output">⌧</button>
          )}
          <button className="ide-panel-action" onClick={toggleBottomPanel} type="button" title="Close panel (Ctrl+J)" aria-label="Close panel">×</button>
        </div>
      </div>
      <div className="ide-bottom-panel-content">
        {bottomPanelTab === 'output' ? (
          <div className="ide-output-log">
            {outputLines.length === 0 ? (
              <span className="ide-output-empty">No output yet. Generation logs will appear here.</span>
            ) : (
              outputLines.map((line, index) => <div key={index} className="ide-output-line">{line}</div>)
            )}
          </div>
        ) : (
          <div className="ide-problems-list">
            <span className="ide-output-empty">No problems detected.</span>
          </div>
        )}
      </div>
    </div>
  )
}
