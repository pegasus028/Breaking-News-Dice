# QA report

## Teacher console: Arena view, End game, podium; guest seats — 2 November 2026 (Claude Opus 5.5)

- **Guest seats:** `server.js` adds Guest#1–#3 (ids g1–g3) after the class list; skipped if Roster.gs already uses those ids. Code.gs rebuilt: **needs Deploy → Manage deployments → New version** before the guests appear in the live game.
- **🏆 Arena view** (new `js/arena.js`, modelled on the Nominalization Arena leaderboard): dark stage, pinned top-3 cards (gold card with crown, float and shine; silver; bronze; count-up and +delta), the chasing pack as bars (places 4+, scrolls), class snapshot, full standings, a lead-change chime.
- **End game:** "End game & show podium" in the arena (two clicks); the classic board's "Finish game" is now "End game". Ending from either board opens the podium; a **🏆 Podium** button reopens it.
- **Podium:** rising gold/silver/bronze blocks, confetti, synthesised crowd cheer (Mute, Close, Esc); students who tie share a step; places after the podium listed below. Confetti and animations are off under reduced motion.
- Front end only for this part (Code.gs unchanged by it). Tests: ES5 parse, sim.js ALL OK, test-ui.js NO PAGE ERRORS (new checks: guests listed last, arena cards/bars/standings, two-click End game, podium with three blocks, Esc closes).

## Student console: CEFR B2 review items — 2 November 2026 (Claude Opus 5.5)

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
