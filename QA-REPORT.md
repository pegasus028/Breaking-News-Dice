# QA report

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
