// Predictions and the meter (P9; EVALS.md M-18; RUNTIME.md §12 step 7b). The night shift says how
// likely something about the owner's day is; a fixed resolver, SQL over what the owner did, says
// whether it happened once the day is over. Skill is the Brier score against a 28-day base rate,
// shown only from 30 resolved predictions in a category.
import type { Day, Id, Ms } from './api';

/** Each category's resolver and its arguments. A day is the conversation's logical day. */
export const PREDICTION_CATEGORIES = {
  /** The owner writes in the chat that day. `{}` */
  'chat.any': 'chat.any',
  /** The owner writes at least `n` messages that day (2–50). `{ n }` */
  'chat.count': 'chat.count',
  /** The owner's first message that day comes before `time` (local `HH:MM`, 05:00–23:59). `{ time }` */
  'chat.before': 'chat.before',
  /** The owner answers this waiting decision card before the day ends. `{ id }` */
  'decision.answered': 'decision.answered',
} as const;
export type PredictionCategory = keyof typeof PREDICTION_CATEGORIES;

export const PREDICTION_LIMITS = {
  /** New predictions a day (DATA.md §8's row budget). */
  per_day: 12,
  why: 200,
  /** Resolved predictions in a category before its skill is shown. */
  shown_from: 30,
  /** The base rate's window, in days before the predicted day. */
  base_days: 28,
} as const;

/** PUT /v1/predictions/:id (the night shift; idempotent on the id). */
export interface PutPredictionRequest {
  category: PredictionCategory;
  args: Record<string, string | number>;
  /** The open day or the next; a chat prediction only before the owner's first message of it. */
  day: Day;
  /** 0.01–0.99, two decimals. */
  p: number;
  why: string;
}

export interface Prediction extends PutPredictionRequest {
  id: Id;
  made_at: Ms;
  made_by: string;
  /** 1 it happened, 0 it didn't, null not yet resolved. */
  outcome: 0 | 1 | null;
  /** The share of the 28 days before (smoothed, (k + 1) / (n + 2)) on which it happened. */
  base: number | null;
  resolved_at: Ms | null;
}

/** One category's skill (EVALS.md M-18). */
export interface CategorySkill {
  category: PredictionCategory;
  open: number;
  resolved: number;
  /** Brier score of the predictions and of the base rate; null with nothing resolved. */
  brier: number | null;
  brier_base: number | null;
  /** 1 − brier / brier_base; null until `shown_from` are resolved. */
  skill: number | null;
  /** Reliability in 5 bins of p (0–0.2 … 0.8–1): how many, their mean p, how often it happened. */
  bins: { n: number; p: number | null; hit: number | null }[];
}

/** GET /v1/predictions/skill */
export interface SkillResponse {
  categories: CategorySkill[];
}

/** GET /v1/predictions */
export interface PredictionsResponse {
  items: Prediction[];
}
