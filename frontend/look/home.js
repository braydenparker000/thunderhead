// @ts-check
// Ink and Lamp's behaviour on home: the conversation, the ask bar and the + sheet's keypad: builder A's.
// Each part runs only while the look is on (whileOn) and takes all of itself away when it goes:
//   home-head.js    the header line and the rec switch
//   home-front.js   the frontispiece, its verse and j.j.
//   home-turns.js   the initials that open his messages, the bar's words off the record
//   home-later.js   the decision strip's "later" dial
import { whileOn } from './look.js';
import { head } from './home-head.js';
import { front } from './home-front.js';
import { turns } from './home-turns.js';
import { later } from './home-later.js';

for (const part of [head, front, turns, later]) whileOn(part);
