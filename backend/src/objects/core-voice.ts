// The voice page's half of the Core object (areas/voice, shared/contract/voice.ts): read by the
// owner and every mind role, written by the owner and the chat mind (whose edit is told in the
// chat, with an undo), an earlier version brought back by the owner. A code layer of the one Core class.
import type { PutVoiceRequest } from '../../../shared/contract/voice.ts';
import * as voice from '../areas/voice/ops';
import { attempt } from '../lib/result';
import type { Caller } from './caller';
import { CoreGuitar } from './core-guitar';

export abstract class CoreVoice extends CoreGuitar {
  voice() {
    return voice.read(this.db);
  }

  voiceVersion(id: string) {
    return attempt(() => voice.version(this.db, id));
  }

  putVoice(c: Caller, r: PutVoiceRequest) {
    return this.run((w) => voice.put(w, c, r, this.tz()));
  }

  restoreVoice(c: Caller, id: string) {
    return this.run((w) => voice.restore(w, c, id));
  }
}
