# Breaking News Dice

A speed-based writing game for English 4 (EN32102), Unit 5 *When the Water Came*.
Each student signs in by tapping her name and plays at her own pace: roll two of the 15 flood
words, write a breaking news post (at least 15 words; 15–25 is the guide) that meets every rule, fact-check a classmate's
post, next round. The teacher board on the projector shows a live leaderboard (water levels).

- `student.html` — student page (iPad/phone): tap your name, then follow the steps.
- `teacher.html` — teacher board for the projector: leaderboard, Front Page picks, players & posts.
  Writing tools (no points): Anchor Desk Phrasebank, Reporter mission self-check, optional 2-min pace timer,
  news phrases on each dice word (`js/newsroom.js`), and **Copy** for the student's own copy of her post.
- `demo.html` — board and one student side by side, in Demo mode.

## Running a game

1. **Open the game** on the teacher board. It shows a QR code and the student link.
2. **Students tap their name** (one device per name; **Release** in Players & posts frees a name).
3. **Each student plays at her own speed**, up to 20 rounds (setting):
   - **Roll** two words (she gets all 15 before any repeats).
   - **Write** and **file**: the File button unlocks only when every rule is met — both dice words,
     at least 15 words (15–25 shown as a guide; no upper limit), a passive (setting; on by default) and no passive error such as *was subsided*.
   - **Fact-check** one classmate's post (least-checked first; a practice post if nobody else has filed),
     then the next round starts straight away. More rounds = more points.
4. The board shows the leaderboard and the best fact-checked posts: tap **Front Page** (+5) any time.
5. **Finish game** (click twice) ends play, gives unchecked posts the benefit of the doubt and shows the winner.
   **Download results** saves every post and each student's totals as CSV; **New game** archives this game.

## Scoring

Per filed post: each dice word +2 · 15+ words +1 · a passive +2 ·
bonus: +1 per kind of complex structure (subordinate clause, relative clause, advanced passive such as
*has been / is being / must be / is thought to*, participle phrase such as *families displaced by*), max +3 ·
+1 per extra Unit 5 word (max +2) · +1 for three long words (9+ letters) ·
each word a classmate's fact-check confirms +3 · headline stars 1–3 · Front Page +5.
Each fact-check a student sends earns her +1. **Remove** in Players & posts sets a post to 0 points.

## Live set-up (Google Sheet + Apps Script)

1. Create a Google Sheet (e.g. *Breaking News Dice*). Extensions → Apps Script.
2. Replace `Code.gs` with `apps-script/Code.gs` from this repo.
3. Add a second script file `Roster.gs` (private: not in this repo) defining `ROSTER` (class number + nickname),
   `TEACHER_PIN` and `SHEET_ID` (the Sheet’s id). Change `TEACHER_PIN` before class.
4. Deploy → New deployment → Web app → Execute as **Me** → Who has access **Anyone** → Deploy, and authorise.
5. Paste the `/exec` URL into `js/config.js` (`window.BND_API_URL = '…'`), bump the `?v=` in the HTML files, and push.

After changing Code.gs: Deploy → Manage deployments → pencil → **New version** → Deploy.
Saving alone does not update the live URL.

The game keeps everything in one sheet tab, `Store`. **New game** copies the old game to
`Archive` and clears `Store`.

## Demo mode

With `BND_API_URL` empty, the same engine runs in the browser (`js/mock-gas.js` stands in for
Apps Script) with a made-up class. On the board, open **Desks & posts** and tick
**Simulate class** to fill the room with pretend students.

## Editing

- Words, meanings, Thai glosses and the forms that count: `js/words.js`.
- Scoring values and the passive checker: `js/check.js`.
- Game engine: `js/server.js`.
- After editing any of these, run `node tools/build.js` to regenerate `apps-script/Code.gs`, paste it into Apps Script and deploy a new version.

## Tests

```
node tools/build.js
node tools/sim.js                        # a whole class playing at different speeds
python3 -m http.server 8765 &            # then
NODE_PATH=$(npm root -g) node tools/test-ui.js /tmp/shots
```
