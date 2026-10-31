// The threads' half of the Core object (areas/conversation): a thread's title (the mind's, or the
// owner's name, which the mind never changes after) and "Continue this", which links a filed
// thread to today's. A code layer of the one Core class.
import * as convo from '../areas/conversation/ops';
import { CoreReminders } from './core-reminders';

export abstract class CoreThreads extends CoreReminders {
  patchThread(id: string, title: string | undefined, summary: string | undefined) {
    return this.run((w) => convo.patchThread(w, id, title, summary));
  }

  nameThread(id: string, title: string) {
    return this.run((w) => convo.nameThread(w, id, title));
  }

  continueThread(id: string) {
    return this.run((w) => convo.continueThread(w, id, this.tz()));
  }
}
