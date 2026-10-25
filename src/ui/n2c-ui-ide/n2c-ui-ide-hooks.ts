import { useContext } from 'react'
import { IDEContext } from './n2c-ui-ide-context-value'
import type { IDEContextValue } from './n2c-ui-ide-context-value'

export function useIDE(): IDEContextValue {
  const context = useContext(IDEContext)
  if (!context) throw new Error('useIDE must be used within an IDEProvider')
  return context
}
