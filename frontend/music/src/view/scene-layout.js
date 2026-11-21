// The first frame of a scene transition (MUSIC.md §5.11 "Transitions at the screen's rate"): scene prepare
// lays the target out once. Only the participants whose scene parameters change (layout params, gone or
// not, view parameters) and the views above them up to the scene root take the measure pass; every other
// view keeps its measure, as Android's measure cache does, and a layout already requested is taken in the
// same pass. The restore to the start frames and the end at the target frames measure a participant
// itself again, not its whole subtree. Before, each of the three forced a measure of the whole tree. A
// row's own scenes (the list's) keep the whole subtree's pass.

/** A view and the views above it up to (and with) the scene root are measured again in the next pass. */
export function markForLayout(view, root) {
  for (let p = view; p; p = p.parent) {
    p.forceLayout?.();
    if (p === root) break;
  }
}
