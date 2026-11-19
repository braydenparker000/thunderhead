// Settings › Motion and touch (FEEL.md rule 8 and "Haptics"): how much Astra moves, and how it
// answers a finger. Both are this phone's own ('device'): a slow phone may want less.

import {define} from './registry.js';
import {setMotionChoice, setHaptics} from '../ui/motion.js';

define([
  {id: 'motion', area: 'motion', title: 'Motion', kind: 'choice', where: 'device', default: 'system',
    detail: 'System follows your phone’s own setting. Reduced swaps travel and slides for short fades; Off changes things with no animation at all.',
    options: [['system', 'System'], ['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']],
    apply: value => setMotionChoice(value)},
  {id: 'haptics', area: 'motion', title: 'Haptics', kind: 'choice', where: 'device', default: 'subtle',
    detail: 'A light tick when you choose, switch or lift something. Full adds ticks as a row settles and as a sheet passes the point where it closes.',
    options: [['off', 'Off'], ['subtle', 'Subtle'], ['full', 'Full']],
    apply: value => setHaptics(value)},
]);
