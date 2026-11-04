// Photos' stored inverses for the ledger's undo (ledger/ops.ts): a recipe put (recipe.ts) and a paste
// onto many photos (paste.ts).
import type { Writer } from '../../objects/commit';
import * as paste from './paste';
import * as recipe from './recipe';

export const PHOTO_UNDO_OPS = ['photo.recipe', 'photo.paste'];

export function undo(w: Writer, op: string, args: Record<string, unknown>): void {
  if (op === 'photo.paste') paste.undo(w, args);
  else recipe.undo(w, op, args);
}
