import { useIDE } from './n2c-ui-ide-hooks'

interface StatusBarProps {
  modelId?: string
  projectName?: string
}

export default function StatusBar({ modelId, projectName }: StatusBarProps) {
  const { toggleBottomPanel, bottomPanelCollapsed, toggleSidebar, toggleInspector } = useIDE()

  return (
    <footer className="ide-statusbar">
      <div className="ide-statusbar-left">
        <button className="ide-statusbar-item" type="button" onClick={toggleSidebar} title="Toggle sidebar (Ctrl+B)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h12" /></svg>
        </button>
        {projectName && (
          <span className="ide-statusbar-item ide-statusbar-project">
            <span className="ide-statusbar-dot" />
            {projectName}
          </span>
        )}
      </div>
      <div className="ide-statusbar-center">
        <button className="ide-statusbar-item" type="button" onClick={toggleBottomPanel} title="Toggle panel (Ctrl+J)">
          {bottomPanelCollapsed ? '◫ Panel' : '◫ Hide Panel'}
        </button>
      </div>
      <div className="ide-statusbar-right">
        <button className="ide-statusbar-item" type="button" onClick={toggleInspector} title="Toggle inspector">
          ⊞ Inspector
        </button>
        {modelId && (
          <span className="ide-statusbar-item ide-statusbar-model">
            <span className="ide-statusbar-model-dot" />
            {modelId}
          </span>
        )}
      </div>
    </footer>
  )
}
