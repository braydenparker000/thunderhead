// Law 8 at the verb gate (mind/CONSTITUTION.md; BEHAVIOR.md §9): the mind may read everything, but
// no verb it queues, no plan's step and no scheduled routine acts on prayer and faith, revelation,
// the owner's leaders, health or other people. Memory keeps those to the owner's own words
// (`needs_owner_words`); the gate carries the same list (shared/contract/verb-spec.ts LAW8_TOPICS)
// over a verb's why and the args that say what it is about. A verb that is only the owner's own
// words (`memory.note`, no class) goes through memory's rules instead.
import { law8Topic, verbSpec } from '../../../../shared/contract/verbs.ts';
import { Fail } from '../../lib/result';

export function lawGate(verb: string, why: string, args: unknown, path = 'args'): void {
  if (verbSpec(verb)?.permit == null) return;
  const topic = law8Topic(why, args);
  if (topic) throw new Fail('validation', { reason: 'needs_owner_words', topic, path });
}
