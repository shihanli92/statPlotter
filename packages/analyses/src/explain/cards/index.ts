import type { MethodCard } from '@ps/model'
import { COMPARE_GROUP_CARDS } from './compareGroups.ts'
import { COMPARISON_CARDS } from './comparisons.ts'
import { SURVIVAL_AND_COUNT_CARDS } from './counts.ts'
import { DESCRIBE_CARDS } from './describe.ts'
import { FACTORIAL_CARDS } from './factorial.ts'
import { MODEL_CARDS } from './models.ts'
import { RELATIONSHIP_CARDS } from './relationships.ts'
import { TOOL_CARDS } from './tools.ts'

/** Every method card (roadmap 51a), by family, in the order Help lists them. */
export const CARD_FAMILIES: readonly { title: string; cards: readonly MethodCard[] }[] = [
  { title: 'Comparing groups', cards: COMPARE_GROUP_CARDS },
  { title: 'Multiple comparisons', cards: COMPARISON_CARDS },
  { title: 'Several factors, subjects or rows', cards: FACTORIAL_CARDS },
  { title: 'Relationships, regression and curves', cards: RELATIONSHIP_CARDS },
  { title: 'Counts, proportions and survival', cards: SURVIVAL_AND_COUNT_CARDS },
  { title: 'Several variables per subject', cards: MODEL_CARDS },
  { title: 'Describing, checking and planning', cards: DESCRIBE_CARDS },
  { title: 'Tables, simulations and data tools', cards: TOOL_CARDS },
]

/** Every method card by id. */
export const METHOD_CARDS: ReadonlyMap<string, MethodCard> = new Map(
  CARD_FAMILIES.flatMap((f) => f.cards).map((c) => [c.id, c]),
)

/** A card by id (undefined: unknown). */
export const methodCard = (id: string): MethodCard | undefined => METHOD_CARDS.get(id)
