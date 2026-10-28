import { useIDE } from './n2c-ui-ide-hooks'
import type { BottomPanelTab } from './n2c-ui-ide-types'

const panelTabs: Array<{ id: BottomPanelTab; label: string }> = [
  { id: 'output', label: 'Output' },
  { id: 'problems', label: 'Problems' },
  { id: 'build', label: 'Build' },
]

export default function BottomPanel() {
  const {
    bottomPanelCollapsed, toggleBottomPanel,
    bottomPanelTab, setBottomPanelTab,
    outputLines, clearOutput,
    buildResult, repairingBuild,
  } = useIDE()

  if (bottomPanelCollapsed) return null

  const errorCount = buildResult?.diagnostics.filter(d => d.severity === 'error').length ?? 0
  const warnCount = buildResult?.diagnostics.filter(d => d.severity === 'warning').length ?? 0

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
              {tab.id === 'build' && buildResult && (
                <span className={`ide-build-badge ${buildResult.success ? 'ide-build-badge-pass' : 'ide-build-badge-fail'}`}>
                  {buildResult.success ? '✓' : errorCount}
                </span>
              )}
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
        ) : bottomPanelTab === 'problems' ? (
          <div className="ide-problems-list">
            <span className="ide-output-empty">No problems detected.</span>
          </div>
        ) : (
          <div className="ide-build-panel">
            {!buildResult ? (
              <div className="ide-build-empty">
                <span className="ide-build-empty-icon">⬡</span>
                <strong>No build results yet</strong>
                <p>Generate a project to see compilation status and diagnostics here.</p>
              </div>
            ) : (
              <>
                <div className={`ide-build-status-bar ${buildResult.success ? 'ide-build-status-pass' : 'ide-build-status-fail'}`}>
                  <span className="ide-build-status-icon">{buildResult.success ? '✓' : '✗'}</span>
                  <span>
                    {buildResult.success
                      ? 'Build passed — project compiled successfully'
                      : buildResult.available
                        ? `Build failed — ${errorCount} error${errorCount !== 1 ? 's' : ''}${warnCount > 0 ? `, ${warnCount} warning${warnCount !== 1 ? 's' : ''}` : ''}`
                        : 'Maven not found — compilation could not be verified'}
                  </span>
                  {repairingBuild && <span className="ide-build-repairing">Repairing…</span>}
                </div>

                {buildResult.diagnostics.length > 0 && (
                  <div className="ide-build-diagnostics">
                    {buildResult.diagnostics.map((diag, index) => (
                      <div key={index} className={`ide-build-diagnostic ide-build-diagnostic-${diag.severity}`}>
                        <span className={`ide-build-diag-severity ide-build-diag-${diag.severity}`}>
                          {diag.severity === 'error' ? '✗' : '⚠'}
                        </span>
                        <div className="ide-build-diag-body">
                          <span className="ide-build-diag-file">
                            {diag.file}{diag.line != null ? `:${diag.line}` : ''}
                          </span>
                          <span className="ide-build-diag-message">{diag.message}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {buildResult.rawOutput && !buildResult.success && buildResult.available && (
                  <details className="ide-build-raw">
                    <summary>Raw compiler output</summary>
                    <pre className="ide-build-raw-content">{buildResult.rawOutput}</pre>
                  </details>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
