// The owner's calendars (BRIEFING.md "Today"): schema step 31. Steps 29 and 30 are taken by
// branches in flight; steps run in number order and one below an applied step never runs, so this
// one ships after them. `calendar_events` holds the next 14 days of each link's events, normalised
// (calendar.ts), replaced whole when a fetch brings something different; `calendar_feeds` holds each
// link's last try, by `feed`, the first 16 hex characters of the SHA-256 of its address: the
// address itself is only in the setting `briefing.calendars`, never in these rows.
import type { Migration, TableInfo } from '../../objects/base';
import { pruneEvents, pruneFeeds } from './calendar-store';
import { pruneReports } from './report-store';

export const BRIEFING_MIGRATIONS: Migration[] = [
  {
    version: 31,
    name: 'calendar_events, calendar_feeds',
    kind: 'expand',
    sql: [
      `CREATE TABLE calendar_events (
        feed TEXT NOT NULL,
        uid TEXT NOT NULL,
        start INTEGER NOT NULL,
        end INTEGER NOT NULL,
        all_day INTEGER NOT NULL,
        title TEXT NOT NULL,
        location TEXT,
        source TEXT NOT NULL,
        PRIMARY KEY (feed, uid, start)
      ) WITHOUT ROWID`,
      'CREATE INDEX calendar_events_start ON calendar_events (start)',
      `CREATE TABLE calendar_feeds (
        feed TEXT PRIMARY KEY,
        checked_at INTEGER NOT NULL,
        ok_at INTEGER,
        failing_since INTEGER,
        error TEXT,
        hash TEXT,
        n INTEGER NOT NULL DEFAULT 0
      ) WITHOUT ROWID`,
    ],
  },
  // The night's report (BRIEFING.md "The report card"): one row per closed day, kept 30 days.
  {
    version: 36,
    name: 'night_reports',
    kind: 'expand',
    sql: [
      `CREATE TABLE night_reports (
        day TEXT PRIMARY KEY,
        written_at INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        headline TEXT NOT NULL,
        lines_json TEXT NOT NULL,
        counts_json TEXT NOT NULL,
        req_sha256 TEXT NOT NULL,
        ledger_id TEXT NOT NULL,
        message_id TEXT
      ) WITHOUT ROWID`,
    ],
  },
];

export const BRIEFING_TABLES: Record<string, TableInfo> = {
  calendar_events: {
    retention:
      "the next 14 days of each calendar link, replaced at each fetch; a failing link's kept 48 hours; past events and a removed link's deleted by the daily prune",
    // Fetched again on the next roll or open, so the backup leaves them out; the owner's export has them.
    backup: false,
    export: true,
    prune: pruneEvents,
  },
  calendar_feeds: {
    retention: 'one row per calendar link while it is set; a removed link deleted by the daily prune',
    backup: false,
    export: false,
    prune: pruneFeeds,
  },
  night_reports: {
    retention: "one row per closed day, the night's report; deleted by the daily prune after 30 days",
    backup: true,
    export: true,
    prune: pruneReports,
  },
};
