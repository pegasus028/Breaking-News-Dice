# QA report

## Concurrency audit after the class failure (23 students) — 2 November 2026 (Claude Fable 5.1)

**What went wrong in class.** Every student page polled the Apps Script backend every 3 s and sent her draft
every 8 s; the teacher board polled every 2 s. Each draft save took the single script lock, re-read the whole
`Store` sheet (`getDataRange`), scored every post with `bndAnalyse`, then did `appendRow` + `getLastRow` — about
2 s of serialised work per write. With 23 students that is ~3 lock-held writes a second against a lock that can
serve about 0.5 a second, so the queue never drained: `waitLock(20000)` timed out, requests piled up against Apps
Script's simultaneous-execution limit, and every page showed "offline". The front end also had no request
timeout, so a hung request blocked that page's next poll for ever.

**The Google Aragon review** (CEFR B2 audit, Google Doc) covers onboarding, phrasebank, mission, timer and
synonyms only; all five tasks were shipped by Opus 5.5 on 2 Nov (section below). It says nothing about
performance, so this pass is Claude's own.

**Backend (`js/server.js` → `apps-script/Code.gs`, Version 8 deployed by Claude in the browser on 2 Nov 2026 22:42, same `/exec` URL; verified live: roster 28 names, cold `state` 3.3 s while the cache rebuilt, then 1.4–2.0 s round trips from Bangkok)**

| Area | Before | After |
|---|---|---|
| Reads (student polls, teacher board) | Cache TTL 20 s, so every 20 s the whole class hit the Sheet | Versioned chunked cache, TTL 30 min, refreshed by every write; reads never touch the Sheet while a game is running |
| Reads under the lock | Always `getDataRange` on the Sheet | Cache-first (`bndRead_(true, 120000, true)`); the Sheet is re-read under the lock at most once every 2 min as insurance |
| Writes | `appendRow` + `getLastRow` | One `setValues` on one row; the row number comes from the in-memory order (writes are serialised) |
| Scoring | `bndAnalyse` on every filed post on every request (85 ms at 520 posts in V8; several × that in Apps Script) | The analysis is stored on the post at filing (`an`), so scoring is 4 ms at 520 posts; older posts without `an` are analysed on the fly |
| Lock | `waitLock(20000)` then a 20-s error | `tryLock(10000)`; on failure `{ok:false, busy:true}`; actions retry once or twice after 1.5–3 s, polls back off |
| Drafts | A locked Sheet write every 8 s per student | A per-student cache key, no lock, no Sheet; synced at most every 30 s |
| Cache consistency | Chunks could mix two puts | Chunk keys carry a version id named in the index; a failed put removes the index; only a lock holder refills the cache from the Sheet (an unlocked reader that misses tries `tryLock(0)` first) |

Estimated lock load for 23 students: before ≈ 2.9 writes/s × 2 s = 580 % of one lock; after the first pass ≈ 36 %; after the review's draft change ≈ 12 %.

**Front end (`js/student.js`, `js/teacher.js`, `js/ui.js`, cache `?v=2026-11-02m`)**

- Student poll 3 s → 10 s with ±20 % jitter (`setTimeout` chain, not `setInterval`); no polls while the tab is hidden; the gap doubles to 60 s while the server is unreachable and resets on the next success or when the tab is shown again. Every action (join, roll, file, fact-check) already returns the full view, so nothing a student does waits for a poll.
- Draft sync 8 s → 30 s, and only when the text changed; a draft that fails to send is marked dirty again and resent.
- The draft is also kept in the browser (`bnd-draft:<session>:<round>:<words>`): a reload shows it at once (test added to `tools/test-ui.js`), and a copy newer than the server's is synced on the next poll. The server copy still lets a student continue on another device after Release.
- `bndApi`: 25-s request timeout (`AbortController` where available), one or two retries on `busy`.
- Teacher board poll 2 s → 5 s.

Request rate for 23 students + board: before ≈ 8.2 requests/s (0.5 s each → ~4 concurrent executions plus the lock queue); after ≈ 2.5 requests/s, none of them touching the Sheet, and only files and fact-checks take the lock.

**Independent review (subagent that had not seen the change) — 22 findings, no P0, 5 P1, all applied:**

1. `SpreadsheetApp.flush()` before `releaseLock()`: Apps Script batches `setValues`, so without it the next lock holder could read a Sheet missing the last row and overwrite it.
2. An exception after a Sheet write but before the cache flush now drops the cache, so the next lock holder rebuilds from the Sheet (cache-ahead/behind row clobbering).
3. Cache chunks 90 000 → 30 000 characters: the 100 KB limit is in bytes and Thai is 3 bytes a character; chunks never split a surrogate pair; a failed put is logged; the previous version's chunks are removed so the shared cache does not fill with dead copies.
4. A `busy` reply to a poll is treated like a network failure (back off, keep the screen) instead of re-rendering the textarea or wiping a half-done fact-check; polls are never retried on busy, only actions.
5. **Drafts no longer touch the lock or the Sheet at all:** the server keeps each student's draft in its own 6-h cache key (`bnd-draft:<sid>`), so a draft sync costs the same as a plain poll. Lock load for 23 students is now ≈ 0.3 locked writes/s (files + fact-checks only) × ~0.4 s ≈ 12 %.
6. Appends use `max(order+2, lastRow+1)`, with the Sheet's last row carried in the cache index.
7. `Promise.race` timeout so a hung request settles even on iPads without `AbortController`.
8. A File/Send whose first try timed out but was applied server-side now shows the returned view instead of a stale screen.
9. `tryLock` 15 s → 10 s so the server says `busy` before the client's 25-s timeout; the archive on New game is read from the Sheet, not the cache.

The new sim checks (`cache matches the Sheet row for row`, flaky-lock `busy` run with no duplicate or lost rows) caught one bug of this pass before it shipped: New game re-read the Sheet into a new object and the lock's flush then wrote the old game back into the cache.

**Unchanged:** item ids, storage keys (`player:`, `post:`, `check:`), the Sheet layout, action names, the `/exec` URL, scoring values. A game in progress survives the deploy (the first request after it reads the Sheet once and rebuilds the cache).

**Tests:** every browser file parses as ES5, no regex lookbehind, every `src`/`href` exists; `tools/build.js` regenerates Code.gs; `tools/sim.js` ALL OK on the real cache path (`mock-gas.js` now has an in-memory CacheService and `tryLock` in Node; in a browser the cache stays a no-op so demo tabs still see each other); `tools/test-ui.js` NO PAGE ERRORS at 360/390/420 px, run on a copy with the live URL blanked (0 `AKfycb` matches), with the new reload-keeps-draft check; profile script at 520 posts: `state` 87 ms → 4 ms, `tstate` 84 ms → 5.5 ms.

**Judgement calls for T.Chris:** the teacher board payload is ~210 KB at 500+ posts (every post text is sent each 5 s); fine for one projector, but a trimmed `tstate` (scores only, posts on demand) would halve it if the Wi-Fi is poor. The 2-minute Sheet re-read under the lock is insurance against manual Sheet edits during a game; if he never edits `Store` by hand it could be dropped.

## Earlier review — November 2026

### Teacher console: Arena view, End game, podium; guest seats — 2 November 2026 (Claude Opus 5.5)

- **Guest seats:** `server.js` adds Guest#1–#3 (ids g1–g3) after the class list; skipped if Roster.gs already uses those ids. Code.gs rebuilt: **needs Deploy → Manage deployments → New version** before the guests appear in the live game.
- **🏆 Arena view** (new `js/arena.js`, modelled on the Nominalization Arena leaderboard): dark stage, pinned top-3 cards (gold card with crown, float and shine; silver; bronze; count-up and +delta), the chasing pack as bars (places 4+, scrolls), class snapshot, full standings, a lead-change chime.
- **End game:** "End game & show podium" in the arena (two clicks); the classic board's "Finish game" is now "End game". Ending from either board opens the podium; a **🏆 Podium** button reopens it.
- **Podium:** rising gold/silver/bronze blocks, confetti, synthesised crowd cheer (Mute, Close, Esc); students who tie share a step; places after the podium listed below. Confetti and animations are off under reduced motion.
- Front end only for this part (Code.gs unchanged by it). Tests: ES5 parse, sim.js ALL OK, test-ui.js NO PAGE ERRORS (new checks: guests listed last, arena cards/bars/standings, two-click End game, podium with three blocks, Esc closes).

### Student console: CEFR B2 review items — 2 November 2026 (Claude Opus 5.5)

Source: the review "Breaking News Dice - CEFR B2 Audit & Update Specification" (Google Doc, Nov 2026).
All five tasks are in `student.html`, `js/student.js`, new `js/newsroom.js` and `css/app.css`.
No change to `words.js`, `check.js` or `server.js`, so `apps-script/Code.gs` is unchanged: **no Apps Script redeploy needed.**
Scoring, item ids, storage keys and the API are unchanged.

| Review task | What shipped | Adapted from the spec because… |
|---|---|---|
| 1 Banner, Copy, onboarding | Banner is mode-aware: live = "draft saves to the class game every few seconds; T.Chris sees a post only when you file it"; demo = "Practice mode … only in this browser". **📋 Copy** in the header (draft while writing, else last filed post) with a "Copied to clipboard!" toast and an execCommand fallback. Static "Newsroom briefing" (mission + 3 steps) inside `<main>` until the script mounts, plus `<noscript>`. Mission line added to "How it works". | The spec's "saved locally in this browser tab" is false in the live game (drafts go to the Sheet), so live mode says what really happens. |
| 2 Anchor Desk Phrasebank | Collapsible, 5 groups, 20 chips; a tap puts the phrase at the cursor and re-runs the checks. Includes the spec's distancing phrases and an "Upgrade an everyday word" group (big problem → major crisis …). | Dropped "We are interrupting our regular programming to bring you live coverage from…" (12 words of TV filler in a 15-word written post). |
| 3 Reporter mission | Collapsible self-check, live count 0/4, no points: breaking-news tense (has/have + pp, is/are + -ing), reporting verb or distancing, past perfect, connector upgrade. Shows the phrase it found. | There is no separate headline field (the whole post is the "headline" the fact-checker stars), so "present-tense headline" became "breaking-news tense". |
| 4 Pace timer | Optional "⏱️ Start 2-min pace timer" on the write screen: progress bar + 3 phases (angle 120–90 s, facts 90–30 s, polish 30–0 s); stops when the screen changes. | Placed after the roll (words are known); phase texts rewritten for one written post, not bullet points for a broadcast. |
| 5 Synonyms on dice | Each die says "💡 tap: meaning + news phrases"; the help sheet adds 3 newsroom collocations per Unit 5 word. | The dice words are already B2/C1 targets that must appear in the post, so swapping them for synonyms would lose the points; collocations show how to use them in news register instead. |

Tests: every browser file parses as ES5; `tools/build.js` leaves Code.gs byte-identical; `tools/sim.js` ALL OK;
`tools/test-ui.js` (extended: no-JS briefing, phrasebank insert, mission 4/4, timer phase, help-sheet phrases, copy + toast, no sideways scroll at 360/390/420 px) NO PAGE ERRORS, run on a copy with the live URL blanked.

Judgement calls for T.Chris: phrasebank chips can supply a passive ("is believed to have been triggered by…"), which earns the passive +2 once the student finishes the sentence; the mission gives no points (add them in `check.js` + redeploy if wanted).
