// @ts-check
// The owner's words for every error the sign-in pages and Settings handle (SIGN-IN.md §5.3,
// §9.2, §11.2, §18). The UI keys on `code`, never on the server's message.

/** @typedef {import('../../shared/contract/api.ts').ErrorCode} ErrorCode */
/** @typedef {import('../../shared/contract/api.ts').RevokeReason} RevokeReason */

export const LINES = {
  wrong_username_or_password: "That username and password don't match.",
  wrong_username_or_code: "That username and code don't match.",
  current_password_wrong: "That's not your current password.",
  setup_code_wrong: "This page's setup code doesn't match the installed fingerprint. Start over.",
  forbidden: "You can't do that from here.",
  origin_not_allowed: "This page isn't allowed to talk to the Thunderhead.",
  setup_fp_missing: 'Waiting for the fingerprint to arrive… (this can take a minute after the workflow finishes)',
  username_invalid: 'Use 3–32 letters, numbers, dots, dashes or underscores.',
  password_too_short: 'Use at least 15 characters.',
  password_too_long: 'Use at most 128 characters.',
  password_guessable: "Don't use your username or the app's name in it.",
  password_breached: 'This password has appeared in a data breach. Choose another.',
  password_same: "That's your current password. Choose a new one.",
  reset_already_pending: 'A reset is already waiting. Cancel it first or wait for it.',
  reset_cancelled: "This reset was cancelled from a signed-in device. If that wasn't you, start again.",
  reset_expired: 'This reset expired. Start a new one.',
  reset_used: 'This reset was already used. Start a new one if you need it.',
  agent_name_taken: 'You already have a key with that name.',
  agent_limit: 'You have 20 keys. Revoke one first.',
  validation: "Something in the form isn't right.",
  too_large: "That's too long.",
  client_outdated: 'A newer version is ready.',
  auth_unavailable: 'Sign-in is having trouble on our side. Try again in a minute.',
  internal: 'Something went wrong on our side.',
  timeout: 'That took too long. Check your connection and try again.',
  network: "Can't reach the Thunderhead right now. Check your connection.",
  offline: "You're offline. Signing in needs a connection.",
  rate_source: 'Too many tries from here. Wait a moment.',
  rate_account: 'Too many tries on this account. Wait a moment.',
};

/** The line above the sign-in form after a device was signed out (§11.2).
 * @type {Record<string, string>} */
export const REASON_LINES = {
  expired: 'You were signed out after 90 days away. Sign in again.',
  signed_out_here: '',
  signed_out_elsewhere: 'This device was signed out from another device.',
  password_changed: "Your password was changed on another device. If that wasn't you, use your recovery code now.",
  recovery_used: "Your password was reset, so every device was signed out. If that wasn't you, use your recovery code now.",
  reset_used: "Your password was reset, so every device was signed out. If that wasn't you, use your recovery code now.",
  device_limit: 'This device was signed out because too many devices were signed in.',
  unauthorized: 'Please sign in.',
};

/**
 * One line for a failed request. `kind` is how it failed: an API error code, or `timeout` /
 * `network` when no answer came. On auth pages a 5xx without a code reads as `auth_unavailable`.
 * @param {{ code?: string | null, status?: number, kind?: 'api' | 'timeout' | 'network' }} err
 * @param {{ auth?: boolean }} [opts]
 */
export function lineFor(err, opts = {}) {
  if (err.kind === 'timeout') return LINES.timeout;
  if (err.kind === 'network') return LINES.network;
  const code = err.code ?? '';
  if (code in LINES) return LINES[/** @type {keyof typeof LINES} */ (code)];
  if (code === 'unavailable' || code === 'upstream' || (err.status ?? 0) >= 500)
    return opts.auth ? LINES.auth_unavailable : LINES.internal;
  return LINES.internal;
}
