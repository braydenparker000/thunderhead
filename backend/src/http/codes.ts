// The error table lives in the shared contract (shared/contract/codes.ts); this typed view
// gives Hono its status type.
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ErrorCode } from '../../../shared/contract/api';
import { CODES as SHARED } from '../../../shared/contract/codes.ts';

export const CODES = SHARED as Record<ErrorCode, [ContentfulStatusCode, string]>;
