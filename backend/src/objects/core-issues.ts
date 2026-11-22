// The list for the builder's half of the Core object (areas/issues, shared/contract/issues.ts): the
// owner's complaints kept for the next building session. A code layer of the one Core class.
import type {
  IssueNoteRequest,
  IssueState,
  PatchIssueRequest,
  PutIssueRequest,
} from '../../../shared/contract/issues.ts';
import * as issues from '../areas/issues/ops';
import { attempt } from '../lib/result';
import type { Caller } from './caller';
import { CoreVoice } from './core-voice';

export abstract class CoreIssues extends CoreVoice {
  issues(state: IssueState | null) {
    return issues.list(this.db, state);
  }

  issue(id: string) {
    return attempt(() => issues.one(this.db, id));
  }

  putIssue(c: Caller, id: string, r: PutIssueRequest, hash: string, release: string | null) {
    return this.run((w) => issues.put(w, c, id, r, hash, release));
  }

  patchIssue(c: Caller, id: string, r: PatchIssueRequest) {
    return this.run((w) => issues.patch(w, c, id, r));
  }

  noteIssue(c: Caller, id: string, r: IssueNoteRequest) {
    return this.run((w) => issues.note(w, c, id, r));
  }
}
