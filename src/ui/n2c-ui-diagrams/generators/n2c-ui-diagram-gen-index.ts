import type { DiagramKind, DiagramGenerator } from '../n2c-ui-diagram-types'
import { umlClassGenerator } from './n2c-ui-diagram-gen-uml-class'
import { erDiagramGenerator } from './n2c-ui-diagram-gen-er'
import { componentGenerator } from './n2c-ui-diagram-gen-component'
import { architectureGenerator } from './n2c-ui-diagram-gen-architecture'
import { springLayersGenerator } from './n2c-ui-diagram-gen-spring-layers'
import { useCaseGenerator } from './n2c-ui-diagram-gen-use-case'
import { sequenceGenerator } from './n2c-ui-diagram-gen-sequence'
import { activityGenerator } from './n2c-ui-diagram-gen-activity'
import { dataFlowGenerator } from './n2c-ui-diagram-gen-data-flow'
import { deploymentGenerator } from './n2c-ui-diagram-gen-deployment'

const generators: DiagramGenerator[] = [
  umlClassGenerator,
  erDiagramGenerator,
  componentGenerator,
  architectureGenerator,
  springLayersGenerator,
  useCaseGenerator,
  sequenceGenerator,
  activityGenerator,
  dataFlowGenerator,
  deploymentGenerator,
]

const generatorMap = new Map<DiagramKind, DiagramGenerator>(
  generators.map(g => [g.kind, g])
)

export function getGenerator(kind: DiagramKind): DiagramGenerator {
  const gen = generatorMap.get(kind)
  if (!gen) throw new Error(`No generator registered for diagram kind: ${kind}`)
  return gen
}

export function getAllGenerators(): DiagramGenerator[] {
  return generators
}

export { generators }
