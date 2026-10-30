// The files' half of the Core object (areas/files): a chat file's record, and the check that a
// message's attachments are files its author uploaded (areas/files/ops.ts `attach`, which the
// conversation's putMessage runs inside the message's own commit). A code layer of the one Core
// class.
import type { Attachment } from '../../../shared/contract/api';
import * as files from '../areas/files/ops';
import * as fstore from '../areas/files/store';
import type { Out } from '../lib/result';
import type { Caller } from './caller';
import { CorePredictions } from './core-predictions';

export abstract class CoreFiles extends CorePredictions {
  /** A chat file's row: the route serves its bytes from the bucket by its key. */
  fileRow(id: string): fstore.FileRow | null {
    return fstore.byId(this.db, id);
  }

  /** Records a file whose bytes are already in the bucket (a row never names missing bytes). A
   * device uploads as the owner, the chat mind as the mind. */
  putFile(c: Caller, f: files.NewFile): Out<{ file: Attachment; created: boolean }> {
    if (c.who !== 'D' && c.who !== 'C') return { ok: false, code: 'forbidden' };
    return this.run((w) => files.put(w, c.who === 'D' ? 'owner' : 'mind', f));
  }
}
