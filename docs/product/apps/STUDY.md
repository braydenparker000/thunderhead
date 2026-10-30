# Study

Study is the owner's private library: their own PDF books, a reader that opens at any page,
search across every page, a scripture-reference parser, and answers about a verse that cite the
owner's own books page by page. It is the only app built new (no old code to carry).
Ring colour `#2e9e5b`, icon Phosphor `book-bookmark`, route `/study/`, phase **P7** ([ROADMAP](../../process/ROADMAP.md)).

## Rules at a glance

1. **Private, always.** PDFs live only in the R2 bucket `thunderhead-private` under `books/`. They are
   never in the repo, never in GitHub Actions, never public. The phone reads them through presigned
   URLs that expire after 3 h ([decisions](../../process/decisions.md), "Private media").
2. **Text work happens in the mind's own session**, never in public Actions: text extraction, OCR,
   block splitting, reference finding. Book text is never printed to any log.
3. **Two page numbers per page:** the PDF page number (`pdf_page`, 1-based, used to open the page)
   and the printed label (`page_label`, what the owner sees, e.g. "212" or "xiv").
4. **Verse text comes from the owner's licensed copies, stored privately.** Owner ruling
   (2026-10-27): the owner has copies of all canon scriptures they may use in this project. The text
   lives only in `thunderhead-private` behind sign-in, never in the repo, logs or Actions. Talks and
   other published source material are not stored: answers cite the paragraph and link to the source.
5. **Every claim in an answer carries a page-block citation.** A sentence without a valid citation is
   dropped before the owner sees it. A quote from a book is at most one sentence.
6. **Answers report what the books say; they never decide.** The mind never rules on prayer,
   revelation or the owner's leaders' decisions (Law 8, [CONSTITUTION](../../mind/CONSTITUTION.md)).
7. **Book text is outside content.** It can be cited in an answer but can never become a fact, a rule
   or a memory ([MEMORY](../../mind/MEMORY.md), taint rule).
8. **Study days are information, never pressure.** No streaks or consecutive-day counters (GROW-1, [IDEAS](../../process/IDEAS.md) A1), no pushes about studying, a missed
   day resets silently.
9. **Offline works for kept books.** A book kept on the phone (OPFS) opens, scrolls, highlights and
   searches its own pages with no network.
10. **Nothing in Study is deleted without the owner's approval (a tap or their own words).** Deleting a book is an ask-first proposal.

---

## 1. What exists in Study

| Thing | Where it lives | Notes |
|---|---|---|
| Book file (PDF) | R2 `thunderhead-private/books/<book_id>.pdf` | `book_id` is a UUIDv7. Never overwritten. |
| Book record, pages, page text, blocks, search index, verse refs | `Library` Durable Object (instance `owner`) | Arrives in P7 in its own deploy ([decisions](../../process/decisions.md)). |
| Highlights, notes, reading positions | `Library` DO, cached on the phone in IndexedDB `th-study` | Local-first, synced through the outbox. |
| Offline copy of a book | OPFS `study/<book_id>.pdf` on the phone | Only when the owner taps **Keep on this phone**. |
| Reading events | `Senses` (events) | `study.*` types, §9. |
| Cited answers about verses | `Core` messages (the conversation) plus a surface per verse | §8. |
| Scripture book table (names, abbreviations, chapter and verse counts, deep-link template) | `thunderhead-private`, loaded after sign-in and cached on the phone | Owner ruling 2026-10-28: kept privately. Only the generic parser code (`frontend/apps/study/scripture/parse.js`) and a synthetic test table are public. No verse text. |
| Scripture text (the owner's licensed copies of the canon) | `thunderhead-private`, behind sign-in | Owner ruling 2026-10-27. Never in the repo, logs or Actions. Talks are not stored: cited by paragraph with a link. |

### 1.1 Data model (`Library` DO)

All times are integer ms UTC (`*_at`); `day` is the owner-local date. snake_case. See
[DATA.md](../../engineering/DATA.md) for conventions.

| Table | Columns (key first) | Notes |
|---|---|---|
| `books` | `id`, title, author, kind (`book\|manual\|other`), language, bytes, pdf_pages, sha256, r2_key, state, state_reason, added_at, ingested_at, duplicate_of, kept_hint | `state` per §3.2. `title`/`author` editable by the owner. |
| `pages` | `rowid`, book_id, pdf_page, page_label, text, blocks_json, ocr (0/1), ocr_conf, chars | UNIQUE(book_id, pdf_page). `blocks_json` = `[[start,end],…]` character offsets into `text`. |
| `pages_fts` | FTS5 over `pages.text`, `content='pages'`, `content_rowid='rowid'`, `tokenize='unicode61 remove_diacritics 2'` | One row per page. |
| `verse_refs` | (`book_code`, `chapter`, `v_start`, `v_end`, `book_id`, `pdf_page`, `block`) | Index (book_code, chapter). Also `weight` (§7.5) and `in_heading` (0/1). |
| `highlights` | `id` (UUIDv7), book_id, pdf_page, quote, prefix, suffix, rects_json, color, note, ref (verse ref or NULL), created_at, updated_at, deleted_at | A page note is a highlight with empty `quote` and NULL `rects_json`. |
| `positions` | (`book_id`) WITHOUT ROWID, pdf_page, scroll_frac, at, device | Last place per book; the latest `at` wins. |
| `ingest_jobs` | `id`, book_id, state, cursor, attempts, last_error, claimed_by, claimed_at, updated_at | One row per ingestion run. |

**Refs** ([GLOSSARY](../GLOSSARY.md)):
- `book:<book_id>` a book; `book:<book_id>#p<pdf_page>` a page; `book:<book_id>#p<pdf_page>.b<n>` a block
  (1-based block number on that page) **[proposal: the `.b<n>` suffix]**.
- `verse:<book_code>/<chapter>/<verse>` or `verse:<book_code>/<chapter>/<v1>-<v2>`, e.g. `verse:a/3/12`,
  `verse:2-beta/4/7` (invented examples). Book codes are the lowercase slugs in the private book table (§7.1).

Check: a unit test in `backend/` round-trips every ref form through the shared ref parser in
`shared/contract/refs.ts` and rejects `book:x#p0`, `book:x#p12.b0` and `verse:a/0/1`.

---

## 2. The private library: files and transport

### 2.1 Storage and access

| Rule | Value | Check |
|---|---|---|
| Bucket | `thunderhead-private`, Worker binding only | `wrangler.jsonc` test: the bucket appears only under the Worker; no workflow file mentions it. |
| Key | `books/<book_id>.pdf` | Store test. |
| Read path for the phone | `GET /v1/library/books/:id/file` (D) through the Worker with the owner's session; the phone keeps the whole file (§2.3) and reads it from there. No signed link, signing key or bucket CORS rule (decisions 2026-10-30) | API test: the device gets the file byte for byte; nothing while it uploads; `book:` refs are never signed. |
| URL lifetime | `X-Amz-Date` floored to the hour, expiry 3 h, re-sign on 403 (decisions) | Unit test of the signer with a fixed clock. |
| Where a URL may appear | Only in memory, passed to `fetch()`. Never in the address bar, history, a link, a pdf.js `?file=` parameter, a log line or a sense | Grep test over `frontend/apps/study/` for `?file=` and for presigned hosts in `href`. |
| Bucket CORS (one-time, ask first: access change) | Allowed origin: the new site origin only; methods GET, HEAD; allowed header `Range`; exposed `Content-Range, Content-Length, Accept-Ranges, ETag` | Live check: a `Range: bytes=0-1023` fetch from the site returns 206 and pdf.js can read `Content-Range`. |
| Sign-out or revoked session | The phone deletes `OPFS study/`, IndexedDB `th-study` and any pdf.js caches before showing sign-in | Browser test: revoke → folder gone ([SIGN-IN](../SIGN-IN.md)). |

### 2.2 pdf.js and the range transport

- Library: **pdf.js `pdfjs-dist` 6.4.299 (Apache-2.0)**, vendored at `frontend/vendor/pdfjs-6.4.299/`
  with its `LICENSE` and a recorded sha256 (checked in CI). The worker file `pdf.worker.mjs` is served
  same-origin (`worker-src 'self'`).
- The shell CSP has no `'wasm-unsafe-eval'`. pdf.js is created with `useWasm: false` so it uses its
  JavaScript decoders **[verify in P7 that every image type the owner's books use still renders; if
  not, add `'wasm-unsafe-eval'` to the shell CSP and record it in decisions]**.
- The book length is known before opening (`books.bytes`), so no HEAD request is needed.
- Transport: a `PDFDataRangeTransport(bytes, initialChunk)` whose `requestDataRange(begin, end)` does
  `fetch(signedUrl, {headers: {Range: 'bytes=<begin>-<end-1>'}})`.
- `rangeChunkSize: 262144` (256 KB) **[proposal]**, `disableAutoFetch: true`, `disableStream: true`.
  The first request asks for bytes `0–262143`.

| Event | Behavior | Check |
|---|---|---|
| 206 response | Hand the bytes to pdf.js. | Range test against a local R2 (miniflare). |
| 200 response (server ignored Range) | Use it as the whole file; stop issuing range requests. | Test with a server that ignores Range. |
| 403 | Re-sign once (`/v1/media/sign`), retry the same range. A second 403 shows "Can't open this book right now." with **Try again**. | Test with an expired URL. |
| Network error or 5xx | Retry after 1 s, then 3 s. Then show, under the last rendered page: "Can't reach your library. Pages you've already opened are still here." with **Try again**. | Offline test in Playwright. |
| 401 from `/v1/media/sign` | Session ended: the sign-in flow ([SIGN-IN](../SIGN-IN.md)). | API test. |

### 2.3 Offline copies (OPFS)

| Behavior | Exact rule | Check |
|---|---|---|
| Start | Book menu → **Keep on this phone**. | Browser test. |
| Space check | If `navigator.storage.estimate()` shows free quota below `2 × bytes`, refuse: "Not enough space on this phone (needs 2× the book's size)." | Unit test with a stubbed estimate. |
| Download | One full GET (no Range) streamed into `OPFS study/<book_id>.pdf.part`, then renamed to `.pdf`. Progress shown as a ring on the book cover (percent of `bytes`). | Browser test. |
| Verify | sha256 of the file must equal `books.sha256`; on mismatch delete the file and show "The copy didn't match. Try again." | Unit test with a corrupted file. |
| Persistence | Call `navigator.storage.persist()` on the first kept book. | Browser test reads `persisted()`. |
| Open | A kept book opens from `URL.createObjectURL(await handle.getFile())`; no network at all. | Offline browser test. |
| Remove | Book menu → **Remove from this phone** (no confirm: the book stays in the library). | Browser test. |
| Interrupted download | On next open of Study, a `.part` file older than 10 min is deleted and the cover shows **Keep on this phone** again. | Unit test. |

---

## 3. Adding a book and ingestion

### 3.1 Adding

- From Study: **Add a book** (header button) → system file picker, `accept="application/pdf"`.
- From Home: `+` → **Files** → a PDF → the sheet asks "Add to Study?" (**Add** / **Not now**)
  ([HOME](../HOME.md)).
- Size limit: **500 MB** **[proposal]**. Larger files are refused before upload: "This PDF is over 500 MB."
- Upload: through the Worker into R2 as an R2 multipart upload in **50 MB parts** (the Free plan caps a
  request body at 100 MB). `POST /v1/library/books` creates the record and returns `upload_id`;
  `PUT /v1/library/books/:id/parts/:n` sends each part; `POST /v1/library/books/:id/complete` finishes.
  A part that fails is retried 3 times (1 s, 5 s, 15 s), then the upload shows **Resume**.
  Resuming re-sends only missing parts. Uploads unfinished after 24 h are aborted by a Library job and
  the record is removed (it never held data, so no proposal is needed).
- Title and author start from the PDF metadata (`/Title`, `/Author`), else the file name without
  `.pdf`. The owner can edit both in the book menu.

Check: an API test uploads a 120 MB synthetic PDF in three parts, kills the second part once, resumes,
and the stored object's sha256 equals the source.

### 3.2 Book states

| State | Meaning | Shown on the cover | Next |
|---|---|---|---|
| `uploading` | Parts arriving | Progress ring | `stored` or aborted after 24 h |
| `stored` | File complete in R2 | "Waiting to be read" | `queued` at once |
| `queued` | An `ingest_jobs` row is waiting for the mind | "Waiting to be read" | `extracting` when claimed |
| `extracting` | Text being pulled from pages | "Reading… 120 of 512 pages" | `ocr` or `indexing` |
| `ocr` | Scanned pages being recognised | "Reading scanned pages… 40 of 96" | `indexing` |
| `indexing` | Pages, blocks, FTS and verse refs being written | "Indexing…" | `ready` |
| `ready` | Searchable and citable | (nothing) | — |
| `failed` | Stopped; `state_reason` holds a plain sentence | "Couldn't read this book." + **Details** / **Try again** | `queued` on Try again |
| `duplicate` | Same sha256 as an existing book | "Already in your library" + **Open the other copy** | Owner may delete (proposal) |

A book can be opened and read in every state after `stored`; search and citations need `ready`.

Check: a Library store test walks a fixture book through every state, including `failed → queued`.

### 3.3 Who does the ingestion

- **Only the mind's session** (the `mind-night` task, or a `mind-chat` session when the owner asks
  "read my new book"), running `mind/jobs/study-ingest.mjs` **[proposal: path]** ([RUNTIME](../../mind/RUNTIME.md)).
- **Never GitHub Actions.** Actions logs are public and the Actions token has no access to
  `thunderhead-private` ([decisions](../../process/decisions.md)). A CI test fails if any workflow file
  references `/v1/library/` or `books/`.
- The night shift claims at most **2 books per night** and stops a book after **45 minutes** of work,
  leaving a cursor so the next run resumes **[proposal]**.

Steps, per book:
1. `th library claim` → the Worker marks the job `claimed` (lease 60 min, renewed by each call) and the session
   downloads the PDF through the Worker (`GET /v1/library/ingest/:job_id/file`, the holder only; decisions 2026-10-30).
2. Download to a temp directory in the session; compute sha256; if it matches another book, set
   `duplicate` and stop.
3. **Text:** `pypdf` (BSD-3-Clause) per page; `pdfplumber` (MIT) for block layout when pypdf's text has
   no paragraph breaks.
4. **Needs OCR?** A page goes to OCR when it has fewer than 50 extracted characters and contains an
   image, or when more than 40% of its tokens are not words in the book's language **[proposal:
   thresholds]**.
5. **OCR:** render the page at 300 dpi with `pypdfium2` (Apache-2.0/BSD-3), recognise with Tesseract
   (Apache-2.0) through `pytesseract` (Apache-2.0), `--psm 3`, language from `books.language`
   (default `eng`). Store mean word confidence as `ocr_conf`.
   - **Not ocrmypdf:** it depends on Ghostscript (AGPL). The plan's tool list is replaced
     **[proposal; contradicts plan §16.9's tool list, not decisions]**.
   - Not PyMuPDF (AGPL).
6. **Page labels** (§4).
7. **Blocks:** split page text on blank lines; merge blocks under 80 characters into the next;
   split blocks over 1,500 characters at the nearest sentence end. Number them 1..n.
8. **Verse refs:** run the shared parser (§7) over every block; write `verse_refs` rows.
9. Post pages in batches of **50** to `PUT /v1/library/books/:id/pages` (idempotent per
   (book, pdf_page)). The Worker writes pages, FTS and refs in one transaction per batch.
10. Delete the temp directory. Set `ready`, `ingested_at`.

**Printing rule:** the ingestion script prints only counts and timings ("512 pages, 96 OCR, 1,840
refs, 6 m 12 s"). Never page text, titles or file names. Check: a test runs the script on a synthetic
PDF with a canary phrase and asserts the phrase is absent from stdout and stderr.

**Write budget:** pages, FTS shadow rows and refs count as rows written. Library ingestion is a
chunked job under the daily cap for bulk jobs (40,000 rows/day,
[JOBS](../../engineering/JOBS.md)); a large book finishes over several nights. The cover shows
"Indexing… (continues tonight)" when the cap pauses it.

---

## 4. Two page numbers per page

| Field | Source, in order | Example |
|---|---|---|
| `pdf_page` | The page's position in the file, 1-based | 230 |
| `page_label` | 1. The PDF's `/PageLabels` (pypdf `page_labels`). 2. Inferred: a number alone in the top or bottom 8% of the page, accepted only when 5+ consecutive pages show the same offset from `pdf_page`; the offset is then applied across that run. 3. NULL. | "212", "xiv" |

- Shown to the owner: "p. 212". When `page_label` is NULL: "PDF p. 230".
- The page details sheet shows both: "Page 212 · PDF page 230 of 512".
- Opening by printed page: **Go to page** accepts a label ("212", "xiv") or "pdf 230". A label that
  appears more than once (two "1"s in front matter and body) opens the first and lists the others.
- Citations always store `pdf_page` and display `page_label`.

Check: fixture PDFs with (a) real `/PageLabels`, (b) printed numbers only with roman front matter,
(c) no numbers. The test asserts the labels for pages 1, 5, 20 and the last page of each.

---

## 5. The reader

### 5.1 Screens

| Screen | Contents |
|---|---|
| **Library** (Study's start) | Header: "Study" + **Add a book** + search field. Section **Continue** (the last 3 books opened, with "p. 212" and a thin progress line). Section **All books**: covers (first page rendered at 160 px wide, cached in IndexedDB) sorted by last opened, then title. Empty state: "Your books will live here. Add a PDF to start." |
| **Reader** | Full-screen pages, continuous vertical scroll. Top bar (hides after 3 s without touch, returns on tap): back, title, **Search in book**, menu. Bottom: page pill "p. 212" (tap → Go to page). |
| **Verse** | §7.6. |
| **Search** | §6. |
| **Book menu** | Keep on this phone / Remove from this phone, Go to page, Highlights and notes, Edit title and author, Details, Delete book… |

Route: `/study/` (library), `/study/?book=<book_id>&p=<pdf_page>`, `/study/?verse=<book_code>/<ch>/<v>`,
`/study/?q=` (built as queries: the storage website has no rewrites; decisions 2026-10-30). The `p` query is the only position in the address; nothing else (never a URL).

### 5.2 Opening at a page

| Opened from | Lands on |
|---|---|
| Library cover | `positions.pdf_page` and `scroll_frac`; page 1 if never opened |
| A citation `book:<id>#p230.b3` | Page 230; block 3 gets a soft accent wash that fades over 2 s (respects reduced motion: no fade, wash stays until the first scroll) |
| Search result | That page; matched words marked until the first scroll |
| Verb `study.open` (§9.2) | The ref's page |

Check: Playwright opens each entry point on a fixture book and asserts the visible page number and the
wash element.

### 5.3 Gestures and display

- Pinch zoom 1×–4×; double-tap toggles fit-width ↔ 2×. Pages render at device pixel ratio up to 2
  (A15 budget, [PERFORMANCE](../../engineering/PERFORMANCE.md)); at most 5 page canvases alive at once
  (current ±2); others are released.
- Text layer on every rendered page so selection and screen readers work.
- Day and night theme: night shows pages with an inverted, warm-tinted filter **[proposal]**; a menu
  toggle "Original page colours" turns it off per book.
- Screen Wake Lock while the reader is visible; released after 10 minutes with no touch or scroll, and
  re-acquired on the next touch **[proposal: 10 min]**.
- Android back: closes a sheet, then the reader, then Study (history entries; [GESTURES](../../design/GESTURES.md)).

### 5.4 Highlights and notes

| Action | Exact behavior | Check |
|---|---|---|
| Select text | Long-press selects a word; handles extend it. A small toolbar appears above: **Highlight**, **Note**, **Ask**, **Copy**. | Browser test with real touch input. |
| Highlight | Saves `quote` (≤ 500 chars; longer selections are refused: "Highlights hold up to 500 characters."), 32-char `prefix` and `suffix`, normalised rects (0–1 of the page box), colour (last used; 4 colours: accent green, gold, blue, rose). | Store test. |
| Note | Opens a sheet with a text field (≤ 4,000 chars). Saving creates a highlight with that note. | Browser test. |
| Page note | Book menu → Highlights and notes → **Note on this page**. | Browser test. |
| Ask | Opens Home with the selection attached as `book:<id>#p<n>.b<k>` plus the quote ([HOME](../HOME.md) "Ask about this"). | Browser test. |
| Copy | Copies the quote plus " (Title, p. 212)". | Unit test of the string. |
| Edit / delete | Tap a highlight → sheet: colour, note, **Delete**. Delete sets `deleted_at` and shows "Highlight deleted" with **Undo** for 6 s. Purge of `deleted_at` rows after 30 days is a Library job (owner data the owner already deleted; not a proposal). | Store and browser tests. |
| Verse inside a highlight | If the parser finds a reference in the quote, `ref` is set, so the highlight appears on that verse's page (§7.6). | Unit test. |
| Re-anchoring | Rects are used to draw. If a later ingestion changes the text, the TextQuote (`prefix`/`quote`/`suffix`) finds the new position; if not found, the highlight shows in the list with "Couldn't place this on the page". | Unit test. |

**Sync:** every change is written to IndexedDB `th-study` first, then sent through the outbox
(`PUT /v1/library/highlights/:id`). Conflicts: last `updated_at` wins per highlight. Works offline.

### 5.5 Positions

- Local: saved 2 s after the page stops changing.
- Server: `PUT /v1/library/positions/:book_id` at most every 30 s while reading, and on
  `visibilitychange → hidden` (keepalive).
- Another device's newer position is used on open only if it is newer than this device's by more than
  60 s; then a toast: "Picked up where you left off on another device, p. 212." **[proposal]**

---

## 6. Search

| Behavior | Exact rule | Check |
|---|---|---|
| Where | Library header field (all books) and **Search in book** (one book). | Browser test. |
| Engine | FTS5 over `pages_fts`, `bm25()` ranking, `snippet(pages_fts, 0, '<mark>', '</mark>', '…', 12)`. | Store test. |
| Query | Words are ANDed; `"quoted phrases"` are phrases; a trailing `*` is a prefix; FTS syntax characters typed by the owner are escaped. Accents are ignored. | Store tests with fixture pages. |
| Debounce | 250 ms after typing stops; at least 2 characters. | Browser test. |
| Results | Grouped by book (books ordered by best hit), up to 5 hits per book with "Show all N"; max 50 hits per request (`limit`, cursor for more). Each hit: snippet, "p. 212". | API test. |
| Verse in the query | If the parser finds a reference, a **Verse** card appears first (§7.6) and the text search still runs. | Browser test with "Book A 3:12 light". |
| Books not `ready` | Not searched; a line under the results: "1 book is still being read and isn't searchable yet." | Browser test. |
| Offline | Search covers only books kept on the phone, using pdf.js's own text layer search over the OPFS copy (slower; shows "Searching your kept books only (offline)"). | Offline browser test. |
| No results | "Nothing found in your books for “<q>”." | Copy test ([COPY](../../design/COPY.md)). |
| Sense | `study.search` with `{q_len, hits}` only; the query text itself is not sent as a sense. | Sense schema test. |

---

## 7. The scripture-reference parser

One pure ES module, `frontend/apps/study/scripture/parse.js`, with its data in the book table. The parser
code is public; the book table is not: it lives in `thunderhead-private` and is loaded after sign-in (and
cached on the phone for offline use). The same code and table run on the phone (instant lookup, offline),
in the Worker (validating refs) and in the ingestion script (finding refs in book text), so all three
always agree. All examples in this section are invented ("Book A", "2 Beta", "Gamma", "Delta", "Sayings and Notes").

### 7.1 The book table (private)

For each scripture book: `code` (slug, e.g. `2-beta`), `volume` (a short volume code), `name`
("2 Beta"), `abbr` (the official abbreviation, "2 Bet."), `aliases` (accepted variants),
`chapters` (count), `verses` (array of verse counts per chapter), `single_chapter` (true for books with
one chapter), `name_collision` (true when the name is also a person's or common word), and the
source site's URL segments (`link_volume`, `link_book`).

- The table lives in `thunderhead-private` with the source site's deep-link template, loaded after
  sign-in; neither is in the repo (owner ruling 2026-10-28). Tests use a synthetic table of invented books.
- Source of abbreviations: the canon publisher's official abbreviation list (the style used in its
  official footnotes and study helps). The table records the source and the date it was checked.
- Verse counts: one integer per chapter, entered from the official structure and checked by a test
  against the published totals per volume **[verify the totals when building the table]**.
- Books divided into numbered sections use `chapter` = section number. Short documents with no
  verses get chapter numbers only.
- No verse text anywhere in the repo (AGENTS.md privacy list includes scripture copies).

Check: `node --test` (on the synthetic table, and in the mind's session on the private one) asserts every book has `verses.length === chapters`, every count ≥ 1, no
duplicate alias across books, and the per-volume totals.

### 7.2 What it accepts

| Form | Example | Result |
|---|---|---|
| Full name, chapter:verse | `Book A 3:12` | `verse:a/3/12` |
| Official abbreviation, with or without period | `2 Bet. 4:7`, `2 Bet 4:7` | `verse:2-beta/4/7` |
| Numbered books written out | `Second Beta 4:7`, `2nd Beta 4:7`, `II Beta 4:7` | same |
| Verse range | `Book A 3:12–14` (hyphen, en dash or em dash) | `verse:a/3/12-14` |
| Verse list | `Book A 3:12, 17–19` | two refs: `12` and `17-19` |
| Whole chapter | `Gamma 10` | `verse:gamma/10` (chapter ref, no verse) |
| Ampersand abbreviation | `S&N 4:2`, `SN 4:2`, `Sayings and Notes 4:2`, `S. & N. 4:2` | `verse:sn/4/2` |
| Cross-chapter range | `Book A 3:12–4:1` | two refs: `a/3/12-24` (to the chapter's last verse) and `a/4/1` |
| Single-chapter book | `Delta 1:3`, and `Delta 3` meaning verse 3 | `verse:delta/1/3` |
| Chained after a book | `Book A 3:12; 4:2` | `a/3/12` and `a/4/2` |

Case-insensitive; extra spaces allowed; a period after an abbreviation is optional.

### 7.3 Guards against name collisions

Many book names are also people's names or ordinary words (the private table marks them with
`name_collision`; the synthetic table uses invented ones such as Gamma and Delta). Rules, in order:

1. **A book name alone is never a reference.** "Gamma said" and "the book of Delta" produce nothing.
2. **A number must follow immediately** (only spaces between), and `chapter` must be within the book's
   chapter count; otherwise nothing.
3. `chapter:verse` is accepted when the verse is within that chapter's count. Out of range → nothing
   (and, in the ask bar only, the hint "Book A 3 has 24 verses.").
4. **Chapter-only forms** (`Gamma 10`) for `name_collision` books are accepted only when **not**
   followed by a unit or counting word (`years`, `days`, `times`, `people`, `men`, `of`, `percent`,
   `%`, `am`, `pm`, `:` followed by a non-number) and **not** preceded by a number word ("Gamma 2
   visitors" → nothing). In book text during ingestion, chapter-only forms of collision books are
   kept only inside parentheses, after "see"/"cf.", or in a list with another valid reference
   **[proposal: these context rules]**.
5. **Ambiguous numbered books:** a numbered book's name without its leading number ("Beta 3",
   "Beta 2:3") is not a reference.
6. Bare numbers like "3:16" with no book are never references, except right after a valid reference
   in the same list (rule "chained").
7. Words inside a URL, an email address or a code span are skipped.

Check: a fixture file `tests/study/refs.txt` of at least 300 lines — positives and negatives, all
invented sentences — with expected output. Target: zero false positives on the negative set and
≥ 98% recall on the positive set. After the first real ingestion, the mind samples 50 found refs per
book and 50 random collision-name mentions and records precision and recall in
[decisions.md](../../process/decisions.md) (counts only).

### 7.4 Validation

Every ref the parser emits is validated against the book table: book exists, `1 ≤ chapter ≤ chapters`,
`1 ≤ v_start ≤ v_end ≤ verses[chapter-1]`. The Worker repeats the validation on any ref it stores
(zod refinement). An invalid ref is never stored or linked.

### 7.5 Weight (for "Cited in your books")

`weight` per `verse_refs` row **[proposal]**: 3 when the ref is in a heading or the block's first
sentence, 2 when the block quotes or discusses only that ref, 1 when it is one of several refs in a
list. Ties sort by book (most opened first) then page.

### 7.6 The verse page and the link out

Route `/study/?verse=<code>/<ch>[/<v>[-<v>]]` (a query: the storage website has no rewrites). Contents, top to bottom:

1. The reference, normalised: "Book A 3:12" (Fraunces is not used here: it is the owner's content, so
   Inter; [DESIGN-SYSTEM](../../design/DESIGN-SYSTEM.md)).
2. **The verse text** from the owner's private copy (Inter, owner's content), then **Open in the scripture
   app** as a secondary link.
3. **Cited in your books (N):** up to 10 rows "Title · p. 212" sorted by weight, each with the first
   line of the block (≤ 140 chars, clipped at a word). Tap → reader at that block. "Show all N".
4. **Your highlights and notes** on this verse (highlights whose `ref` matches or overlaps).
5. **Ask about this verse** (§8). If a cached answer exists, it shows here with its date.

**Deep link format** (opened with `target="_blank" rel="noopener noreferrer"`): built from the source
site's deep-link template, kept privately with the book table: the per-book segments (`link_volume`,
`link_book`), the chapter, and a verse anchor; a range uses a two-verse anchor; a chapter ref omits the
verse anchor.
**[verify: the exact path segments per volume, the range form, and that Android opens the official
scripture app for these links when it is installed. Settle by generating a share link in the app for one
verse per volume and comparing.]**

Check: unit test builds the URL for one ref per volume and compares with the verified fixtures (a
synthetic template in the public test; the real template and its verified links checked privately); the
Playwright test asserts the link has `rel="noopener noreferrer"`; a repo test asserts no verse text is
committed and that no real book table or link template is committed.

### 7.7 Where the parser runs

| Place | Use |
|---|---|
| Home ask bar (front desk, instant, offline) | Text that is *only* a reference ("2 Bet 4:7") opens the verse page without waking the mind **[proposal; HOME.md owns the front-desk grammar]**. Text that contains a reference plus other words goes to the mind with the ref attached. |
| Study search field | Verse card (§6). |
| Highlights | Sets `ref` (§5.4). |
| Ingestion | Builds `verse_refs` (§3.3). |
| Worker | Validates every stored ref and every cited answer's verse ref. |

---

## 8. "Ask about a verse": cited answers

### 8.1 Flow

1. The owner taps **Ask about this verse**, or asks in the conversation ("what do my books say about
   Book A 3:12?"). The message carries `refs: ["verse:a/3/12"]`.
2. The mind (chat session) calls `th library cite verse:a/3/12` → the Worker returns up to 20
   candidate blocks: every `verse_refs` hit (by weight) plus the top FTS hits for the verse's
   reference string, each as `{ref: "book:<id>#p<n>.b<k>", label: "Title, p. 212", text}`.
3. The mind writes the answer. Every sentence ends with one or more citation markers
   `[[book:<id>#p<n>.b<k>]]`. Quotes from a block are in quotation marks.
4. The mind posts it; **the Worker validates it** (§8.2) before storing or showing it.
5. The phone renders markers as small numbered chips; tapping a chip opens the reader at that block.
   The answer ends with **Where to study:** up to 5 cited pages as tappable rows, plus
   **Open in the scripture app**.

### 8.2 Validation (in the Worker, not trusted to the mind)

| Rule | What happens | Check |
|---|---|---|
| A sentence with no marker | Dropped. | Unit test. |
| A marker whose block doesn't exist, or wasn't in the candidate set for this answer | Marker removed; if the sentence then has no marker, it is dropped. | Unit test. |
| A quoted span | Must appear verbatim (whitespace- and quote-style-normalised) in one of the sentence's cited blocks, and be at most one sentence (no internal `.`, `!`, `?` followed by a space and a capital) and at most 40 words **[proposal: 40]**. Otherwise the sentence is dropped. | Unit tests with near-miss quotes. |
| Length | At most 8 sentences **[proposal]**; extra sentences are cut from the end. | Unit test. |
| Nothing left | The answer becomes: "I couldn't find this verse discussed in your books." plus **Open in the scripture app**. | Unit test. |
| Dropped count | Stored with the answer (`dropped_n`) and counted in the evals ([EVALS](../../mind/EVALS.md)); never shown as an error to the owner. | Store test. |

### 8.3 How the answer speaks

- It reports what each book says, attributed: "The commentary on p. 212 connects this verse to…".
  It never states its own doctrinal conclusion as fact, and it keeps official teaching and a book's
  commentary visibly apart when both appear.
- It never tells the owner what an answer to prayer, a revelation, or a leader's decision means for them
  (Law 8). If asked, it says that is the owner's to decide and offers the cited pages.
- Language: plain, short sentences ([COPY](../../design/COPY.md)). No flattery, no "great question".

Check: [EVALS](../../mind/EVALS.md) holds synthetic books (invented commentary) and prompts that try to
get an uncited claim, a long quote, or a verdict on a personal spiritual decision; the validator plus the
constitution must yield zero violations.

### 8.4 Caching

- A validated answer is stored as the surface `study.verse:<ref>` (payload: answer, citations, made_at)
  for **30 days**; the verse page shows it with "From <date>" and **Ask again**.
- It is invalidated when a new book reaches `ready` and has refs to that verse.

---

## 9. Senses, verbs, surfaces

### 9.1 Senses (events)

Shape per [decisions](../../process/decisions.md): `{id, at, type, ref, data, sensitivity}`.
All `study.*` events use **sensitivity 1** (private: never brought up unprompted) **[proposal]**.

| Type | When | `ref` | `data` |
|---|---|---|---|
| `study.open` | A book opens | `book:<id>#p<n>` | `{from: "library"\|"cite"\|"search"\|"verb"}` |
| `study.page` | A page stays visible ≥ 8 s | `book:<id>#p<n>` | `{}` |
| `study.highlight` | Highlight created | `book:<id>#p<n>` | `{has_note, has_ref}` |
| `study.search` | Search run | — | `{q_len, hits}` |
| `study.verse` | Verse page opened | `verse:…` | `{from}` |
| `study.ask` | Ask about this verse | `verse:…` | `{}` |
| `study.app_open` | Scripture-app link tapped | `verse:…` | `{}` |
| `study.session` | A session ends (§9.4) | `book:<id>` (the most-read book) | `{active_ms, pages, books}` |

No event carries page text, quotes, notes or search words.

### 9.2 Verbs (in `frontend/apps/study/verbs.js`, run without the UI mounted)

| Verb | Args | Does | Undo |
|---|---|---|---|
| `study.open` | `{ref}` (book page or block) | Opens the reader there (only if the shell is visible and the owner is on Home or Study; otherwise becomes a surface card "Ready in Study: Title, p. 212" with **Open**) | `{verb: "study.close"}` |
| `study.keep` | `{book}` | Starts an offline copy | `study.unkeep` |
| `study.highlight` | — | **Not a verb.** The mind never creates, edits or deletes the owner's highlights or notes. | — |

### 9.3 Surfaces

| Slot | Kind | Shown |
|---|---|---|
| `study.continue` | One line: book, page, why | Top of the Library ("Pick up at p. 212 — you stopped mid-chapter.") |
| `study.verse:<ref>` | Cited answer | Verse page (§8.4) |
| `briefing.study` | Tile | Briefing page "Study" tile ([BRIEFING](../BRIEFING.md)) |

Every surface shows its "why" (Law 3).

### 9.4 Sessions and streaks

- **Active time:** the reader is visible and there was a touch or scroll in the last 2 minutes.
- **Session:** active reading with no gap longer than 10 minutes. It ends after 10 minutes without
  activity or when Study is hidden for 10 minutes. It counts when `active_ms ≥ 5 min`.
- **Study day:** an owner-local day (rolled with the day roll, [GLOSSARY](../GLOSSARY.md)) with at least
  one counting session.
- **Week count:** study days in the current week (Monday start). Computed in the Worker from `Senses`
  rollups, never stored as a counter.
- Shown: the Briefing tile says "Studied 4 days this week" when the week count is ≥ 2; otherwise
  "Last studied: Tuesday, p. 212". No streak text ever mentions losing it.
- Settings → Study → **Show study days** (on by default) **[proposal]**.

Check: unit tests over synthetic event streams (gap of 9 vs 11 minutes; 4 vs 6 minutes active;
a day crossing the 04:00 roll).

---

## 10. Errors and edge cases

| Case | Behavior |
|---|---|
| Encrypted / password-protected PDF | Upload succeeds; ingestion sets `failed` with "This PDF is password-protected. Remove the password and add it again." The reader asks for the password in a sheet (pdf.js `onPassword`); it is never stored. |
| Corrupt PDF | `failed`: "This file isn't a readable PDF." |
| PDF over 5,000 pages | Accepted; ingestion runs over several nights. |
| Book deleted | Book menu → **Delete book…** → creates an ask-first proposal (class `delete`) ([BEHAVIOR](../../mind/BEHAVIOR.md)). On approval: R2 object, pages, FTS, refs and positions removed; highlights kept in an export file under `thunderhead-private/exports/study/<book_id>.json` for 30 days, then removed. |
| R2 unreachable when opening a non-kept book | §2.2 network rule. |
| Storage evicted on the phone | Kept-book flags are reset; covers show **Keep on this phone** again; no error. |
| Two devices highlight the same text | Two highlights; both shown. |
| The owner edits a title | Old citations still resolve (they use `book_id`). |

---

## 11. Phase plan inside P7

1. `Library` class deploy (own deploy), tables, `/v1/library/*`, sign routes for `books/`, bucket CORS
   (ask first). **Built:** the class alone (migration tag `v4`), then the routes (API.md §11.21), `book:`
   signing, the daily pass (uploads left a day aborted, lapsed runs freed, deleted highlights purged
   after 30 days) and the Library in the weekly backup and the export. The bucket CORS is SETUP.md O1
   (ask-first). The mind downloads a claimed book through the Worker (`GET /v1/library/ingest/:job_id/file`,
   the run's holder only) instead of a signed link, so ingestion needs neither the signing token nor
   the bucket's S3 host from the session. Measured: one 300-word page with two refs is 9 rows written
   (row, index, FTS, refs, the run's cursor).
2. Library screen, upload, reader over presigned ranges, positions. **Built:** Study has its own page
   (`frontend/study/index.html`, code in `frontend/apps/study/`, its CSP in SECURITY.md §4.1). The storage
   website has no rewrites, so its places are queries on `/study/`: `?book=<id>&p=<pdf_page>`, `?q=` (and
   `&in=<id>` for one book); the page number is still the only position in the address. A picked PDF is
   read on the phone first (pdf.js over the file itself) for its title, author and a cover drawn from its
   first page, so covers need no network; then sent in parts with byte progress and Resume. The reader
   draws five pages at most, at the screen's pixel ratio (at most 2), each with its text layer; page
   labels come from the PDF's own `/PageLabels` until ingestion stores them. pdf.js 6.4.299 is vendored
   (its legacy build: the modern one uses built-ins only the newest Chrome has, unpolyfilled, which
   failed in CI's Chromium) with its `LICENSE.txt` and `SHA256SUMS.txt` (checked by `tests/study-logic.test.mjs`). Reading needs
   SETUP.md N1 and O1; until then the reader says "Books can't open yet". Not yet: keeping a book on the
   phone, highlights and notes (step 5), the verse card (step 4), Study's senses (with the phone's
   senses batcher), Delete book (a proposal).
3. Ingestion script in the mind's session; search. **Built:** `mind/jobs/study-ingest.mjs` with
   `mind/jobs/study_extract.py` (pypdf text, the PDF's `/PageLabels` else labels inferred from printed
   numbers, OCR by pypdfium2 + Tesseract where a page needs it) and `mind/jobs/study-blocks.mjs`;
   `mind/jobs/study-setup.sh` installs the pinned tools when missing. It runs as night step 6 (at most
   2 books and 10 minutes a night, not the 45 minutes above, which the night's own 45-minute hard stop
   can't hold; a book goes on from its cursor the next night) and in a chat session when the owner
   asks. Tested end to end against the real Worker: a canary phrase, the title and the file name never
   appear in its output. Tesseract 5.3.4 installed with apt in a cloud session (open question 5). The
   search screen shipped with step 2. Verse refs come with step 4's parser.
4. Parser + private book table + verse page + scripture-app links. **Built:** the parser
   (`frontend/apps/study/scripture/parse.js`, checked by `tests/study-parse.test.mjs` on the invented
   table and the 330 lines of `tests/study/refs.txt`) runs on the phone, in the Worker (`allowJs`) and in
   the mind. The table and each book's text are in the private bucket (`study/scripture.json`,
   `study/text/<code>.json`; API.md §11.21), stored by the mind with `mind/jobs/scripture-import.mjs`
   (files inside the checkout are refused; counts only; the text built from the owner's read volumes,
   saved outside the checkout by `mind/jobs/study-pages.mjs`), read by the phone after sign-in (the table
   kept for offline use by its ETag). The Worker refuses any verse ref until the table is stored, then
   every ref not in it. Ingestion finds each block's refs in book context and weighs them (§7.5: a
   heading is a block's short first line, at most 80 characters with no closing stop). The verse page
   (§7.6, without step 6's Ask) and the search's verse card are built; `tests/study-private.test.mjs`
   fails on any real table, link template or verse text in the checkout. Owner step: SETUP.md O2.
5. Highlights and notes, offline copies. **Built:** the reader reads only this phone's copy: the
   first open downloads the whole PDF through the Worker (with its progress) into OPFS `study/`, and
   every open after is instant and works offline; **Remove from this phone** in the book menu; signing
   out deletes the folder. The 256 KB signed ranges are gone (with SETUP.md O1 and Study's need for
   N1). Parked in [IDEAS](../../process/IDEAS.md), not built: the highlight and note editor in the
   reader (§5.4; the Worker's highlight routes are built) and the wash on the cited block itself (the
   whole page washes).
6. Cited answers with the Worker validator; evals.

**Done when** (ROADMAP): asking about a verse returns an answer with page citations and opens the book at
the page — checked on the owner's phone with one real book.

---

## 12. Later ideas

- **Exhibit [proposal]:** one chapter told as a single scroll-driven, illustrated page, built from the
  owner's own books' page blocks with their citations, so reading moves through the story and the
  commentary side by side. It came from earlier design work and waits for the owner's reaction; it is
  not in any phase. It must follow §8's citation rules and Law 5 (coach, don't do the study for them).
- **Offline full-text index** for kept books (a small per-book index file in OPFS) instead of pdf.js text
  search **[proposal]**.
- A second language's official abbreviations in the parser **[proposal]**.

---

## Open questions / tests

| # | Question | How to settle |
|---|---|---|
| 1 | Settled 2026-10-27 (owner): verse text from the owner's licensed copies, private only. Import format and per-verse storage shape | Agent decides at P7 from the owner's files |
| 2 | The official scripture app's deep-link format per volume, ranges, and Android app hand-off | Generate share links in the app for one verse per volume and test on the A15. |
| 3 | pdf.js 6.4 with `useWasm: false` renders the owner's books (JPX/JBIG2 images) | Open every ingested book's 10 image-heaviest pages on the A15; compare with a desktop PDF viewer. |
| 4 | FTS5 write cost per 1,000 pages (report 2: 3–5k rows, unverified) | Cost test in `backend/tests/cost/` with a 1,000-page synthetic book. |
| 5 | Tesseract and `pypdfium2` installable in the mind's cloud environment | One session run of the ingestion script on a scanned synthetic PDF. |
| 6 | Library DO size: 1 GB per object on Free | Measure bytes per 1,000 pages after the first book; shard by `library:<shelf>` if projected > 700 MB. |
| 7 | Parser precision/recall on real books | The sampling step in §7.3; record counts in decisions. |
| 8 | Whether the A15 keeps a 50 MB OPFS file across weeks | `persisted()` + check after 14 days. |
