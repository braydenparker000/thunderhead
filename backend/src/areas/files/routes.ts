// /v1/files (HOME.md §4.6, API.md §11.7): a chat file's upload and its bytes.
import { Hono } from 'hono';
import type { AppEnv } from '../../http/auth';

export const filesRoutes = new Hono<AppEnv>();
