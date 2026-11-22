// When the Claude plan's usage limit stops the mind (RUNTIME.md §9 F4, §11): a `limited` status may
// carry the reset time the platform's error gave, so the chat can say until when.
import type { MindStatusRequest } from './conversation';

export interface LimitedStatusRequest extends MindStatusRequest {
  /** `limited`: the reset time the platform's error gave (epoch ms), when it gave one. */
  resets_at?: number;
}
