// /v1/reminders (HOME.md §6.2): the owner's reminders, set, listed and taken back.
import { Hono } from 'hono';
import type { AppEnv } from '../../http/auth';

export const remindersRoutes = new Hono<AppEnv>();
