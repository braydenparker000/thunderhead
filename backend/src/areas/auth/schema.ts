// Request shapes for /v1/auth (zod/mini), checked against the shared contract with `satisfies`.
// These are shape checks only (422 validation). The password and username rules have their own
// codes and run inside the Auth object, in the order SIGN-IN.md §4.1 gives.
import * as z from 'zod/mini';
import type {
  AgentRole,
  BreakglassCancelRequest,
  BreakglassRequest,
  DeviceHints,
  LoginRequest,
  NewAgentRequest,
  NoticeAckRequest,
  PasswordRequest,
  RecoverRequest,
  RecoveryCodeRequest,
  RecoveryConfirmRequest,
  SessionLabelRequest,
  SetupRequest,
  SignoutRequest,
} from '../../../../shared/contract/api';
import { FINGERPRINT_RE } from './crypto';

const text = (max: number) => z.string().check(z.maxLength(max));
// Free text from the device, kept short and stripped of control characters.
const hint = (max: number) =>
  z.optional(
    z.pipe(
      z.string(),
      z.transform((s: string) => s.replace(/\p{C}/gu, '').trim().slice(0, max)),
    ),
  );

const device = z.object({
  platform: hint(40),
  browser: hint(40),
  model: hint(40),
  standalone: z.optional(z.boolean()),
}) satisfies z.ZodMiniType<DeviceHints>;

// Passwords are capped by the 4 KB body limit and then by 128 characters / 1,024 bytes inside
// Auth (password_too_long); here they only have to be strings.
const password = text(4096);

export const setupBody = z.object({
  setup_code: text(64),
  username: text(64),
  password,
  device,
}) satisfies z.ZodMiniType<SetupRequest>;

export const loginBody = z.object({
  username: text(64),
  password: z.string().check(z.minLength(1), z.maxLength(4096)),
  device,
}) satisfies z.ZodMiniType<LoginRequest>;

export const recoverBody = z.object({
  username: text(64),
  code: text(64),
  new_password: password,
  device,
}) satisfies z.ZodMiniType<RecoverRequest>;

export const signoutBody = z.object({
  scope: z.enum(['this', 'others', 'all']),
}) satisfies z.ZodMiniType<SignoutRequest>;

export const passwordBody = z.object({
  current_password: z.string().check(z.minLength(1), z.maxLength(4096)),
  new_password: password,
  sign_out_others: z.boolean(),
}) satisfies z.ZodMiniType<PasswordRequest>;

export const recoveryCodeBody = z.object({
  current_password: z.string().check(z.minLength(1), z.maxLength(4096)),
}) satisfies z.ZodMiniType<RecoveryCodeRequest>;

export const recoveryConfirmBody = z.object({
  last5: z.string().check(z.minLength(5), z.maxLength(9)),
}) satisfies z.ZodMiniType<RecoveryConfirmRequest>;

export const fingerprintParam = z.optional(z.string().check(z.regex(FINGERPRINT_RE)));

export const stateQuery = z.object({ fp: fingerprintParam, reset_fp: fingerprintParam });

export const breakglassBody = z.object({
  fingerprint: z.string().check(z.regex(FINGERPRINT_RE)),
}) satisfies z.ZodMiniType<BreakglassRequest>;

export const cancelBody = z.object({ ticket_id: z.uuid() }) satisfies z.ZodMiniType<BreakglassCancelRequest>;

export const ackBody = z.object({ answer: z.enum(['me', 'not_me', 'ok']) }) satisfies z.ZodMiniType<NoticeAckRequest>;

export const labelBody = z.object({
  label: z.string().check(z.trim(), z.minLength(1), z.maxLength(40), z.regex(/^[^\p{C}]*$/u)),
}) satisfies z.ZodMiniType<SessionLabelRequest>;

const ROLES = ['mind:chat', 'mind:night', 'mind:reflex', 'muse', 'ci'] as const satisfies readonly AgentRole[];

export const agentBody = z.object({
  name: z.string().check(z.minLength(1), z.maxLength(32), z.regex(/^[A-Za-z0-9._-]+$/)),
  role: z.enum(ROLES),
  current_password: z.string().check(z.minLength(1), z.maxLength(4096)),
}) satisfies z.ZodMiniType<NewAgentRequest>;

export const idParam = z.object({ id: z.uuid() });
