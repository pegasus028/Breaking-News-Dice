# Breaking News Dice

A 20-minute pair game for English 4 (EN32102), Unit 5 *When the Water Came*.
Each team (two players) rolls two of the 15 flood words, each student writes a
15–25-word breaking news post that uses both words, then fact-checks a post from
another team. The teacher board on the projector shows live team totals as rising
water on river gauges.

- `student.html` — student console (iPad/phone): tap your team number, then follow the steps.
- `teacher.html` — teacher board for the projector: run the phases, fix teams, remove posts, pick the Front Page.
- `demo.html` — board and one student side by side, in Demo mode.

## Running a game (about 15–20 minutes)

1. **Open the game** on the teacher board (projector). It shows a QR code and the student link.
2. **Students join like Conditionals Arena:** tap their **team number** (1–15), then **Enter the newsroom**.
   Partners tap the same number (T.Chris tells them); the first is Player 1, the second Player 2; a full team is refused.
   No names are collected.
3. **Each team starts by itself** the moment its second player joins, and plays every round at its own pace:
   - **Write** (3:00): roll two words, write a 15–25-word post, file it. The team moves on when both have filed or the timer ends (drafts are filed automatically).
   - **Fact-check** (1:30): each student checks a finished post from another team (least-checked first). If no other team has a post yet, she gets a practice post.
   - **Results** (25 s): the round score; either partner taps **Start round 2** (or it moves on by itself).
   - After the last round the team sees its rank; its score can still rise as other teams check its posts.
4. The board shows live totals and each team's stage, plus the best fact-checked posts: tap **Front Page** (+5) any time.
   **Teams & posts** lets you move a player, **Start solo** for a student whose partner is absent, or remove a post.
5. **Finish game** (click twice) ends play, gives unchecked posts the benefit of the doubt and shows the winner.
   **Download results** saves every post as CSV; **New game** archives this game and opens a fresh one.

## Scoring

Per post: each dice word used +2 · 15–25 words +1 · a passive +2 · each word the
fact-checker says is used with the right meaning +3 · headline stars 1–3 · Front Page +5.
Each fact-check a student sends earns her team +1. A team with one player is scored as if it were two. While writing, the board counts only the automatic points;
fact-check points arrive as checks come in; a post nobody checked gets the benefit of the doubt
at Results. **Remove** in Teams & posts sets a post to 0 points.

## Live set-up (Google Sheet + Apps Script)

1. Create a Google Sheet (e.g. *Breaking News Dice*). Extensions → Apps Script.
2. Replace `Code.gs` with `apps-script/Code.gs` from this repo.
3. Add a second script file `Roster.gs` (settings; no student names) defining `TEACHER_PIN` and `SHEET_ID`
   (the Sheet’s id; leave it out if the script is bound to the Sheet). Change `TEACHER_PIN` before class.
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
node tools/sim.js                        # 3 rounds with a full class against the engine
python3 -m http.server 8765 &            # then
NODE_PATH=$(npm root -g) node tools/test-ui.js /tmp/shots
```
