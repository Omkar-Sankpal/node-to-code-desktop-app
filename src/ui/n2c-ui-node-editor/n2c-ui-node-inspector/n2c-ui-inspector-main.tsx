import type { WorkflowNodeData } from '../n2c-ui-node-handler/n2c-ui-node-handler-types'
import EntityInspector from './n2c-ui-inspector-entity'
import ApiInspector from './n2c-ui-inspector-api'
import ServiceInspector from './n2c-ui-inspector-service'
import ConfigInspector from './n2c-ui-inspector-config'

interface Props {
  data: WorkflowNodeData
  onUpdate: (key: string, value: unknown) => void
}

/** Routes to the correct sub-editor based on node kind */
export default function NodeInspectorContracts({ data, onUpdate }: Props) {
  const kind = data.kind.toLowerCase()

  if (kind.includes('model') || kind.includes('entity') || kind === 'demo node') {
    return <EntityInspector data={data} onUpdate={onUpdate} />
  }

  if (kind.includes('api') || kind.includes('controller')) {
    return <ApiInspector data={data} onUpdate={onUpdate} />
  }

  if (kind.includes('service')) {
    return <ServiceInspector data={data} onUpdate={onUpdate} />
  }

  if (kind.includes('config') || kind.includes('database')) {
    return <ConfigInspector data={data} onUpdate={onUpdate} />
  }

  // Subgroup and other nodes: show nothing extra
  return null
}
