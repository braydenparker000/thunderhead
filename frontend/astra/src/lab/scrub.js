// Text made safe to paste into a chat or a report (docs/product/apps/ASTRA.md §5.2 rule 3). The scrubber and the
// server group live with the player's playback report (player/playback-report.js), so the player can make the same
// report without loading the lab; the lab's reports take them from here.

export {scrubSecrets, serverGroup} from '../player/playback-report.js';
