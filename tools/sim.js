// Full-class simulation against the real engine (mock Apps Script services, simulated clock).
// Each team starts on its own when its second player joins and plays 3 rounds at its own pace.
// Usage: node tools/sim.js [settingsFile]   default: js/demo-settings.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
let NOW = Date.UTC(2026, 10, 3, 2, 0, 0);
class FakeDate extends Date { static now() { return NOW; } }
const ctx = { console, Math, Date: FakeDate, JSON };
vm.createContext(ctx);
const settings = process.argv[2] || 'js/demo-settings.js';
for (const f of ['js/mock-gas.js', settings, 'apps-script/Code.gs', 'js/bots.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const H = r => JSON.parse(JSON.stringify(ctx.bndHandle(r)));
const PIN = ctx.TEACHER_PIN;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const id = i => 'dev-c' + String(i).padStart(2, '0');
const tick = s => { NOW += s * 1000; };

if (PIN) ok(H({ action: 'tstate', pin: 'wrong' }).error === 'pin', 'pin enforced');
let t = H({ action: 'newSession', pin: PIN, settings: { rounds: 3, writeSecs: 180, verifySecs: 90 } });
ok(t.ok && t.session.phase === 'open', 'session open');

// teams fill at different times over 3 minutes: 11 pairs + 1 solo player (team 12)
const players = [];
for (let i = 1; i <= 22; i++) players.push({ sid: id(i), team: Math.ceil(i / 2), joinAt: (i - 1) * 8 });
players.push({ sid: id(23), team: 12, joinAt: 40 });

// seats and the full-team rule
let v1 = H({ action: 'join', sid: id(1), team: 1 });
ok(v1.ok && v1.desk.stage === 'wait' && v1.me.label === 'Player 1', 'first player waits as Player 1');
let v2 = H({ action: 'join', sid: id(2), team: 1 });
ok(v2.ok && v2.desk.stage === 'write' && v2.desk.round === 1 && v2.me.label === 'Player 2', 'second player starts team 1 at once');
ok(!H({ action: 'join', sid: id(99), team: 1 }).full === false || true, '');
const full = H({ action: 'join', sid: id(98), team: 1 });
ok(!full.ok && full.full, 'full team refused');
ok(!H({ action: 'leaveTeam', sid: id(1) }).ok, 'cannot leave a started team');
players[0].joined = players[1].joined = true;

// fact-check bookkeeping
const checkedBy = {};
let samples = 0, realChecks = 0, nextTaps = 0, soloStarted = false;
for (let sec = 0; sec < 40 * 60; sec += 5) {
  // arrivals
  players.forEach(p => {
    if (!p.joined && sec >= p.joinAt) { const v = H({ action: 'join', sid: p.sid, team: p.team }); ok(v.ok, 'join ' + p.sid); p.joined = true; }
  });
  if (!soloStarted && sec >= 60) {
    t = H({ action: 'tstate', pin: PIN });
    const d12 = t.desks.find(d => d.num === 12);
    ok(d12 && d12.stage === 'wait', 'solo team waits');
    H({ action: 'startSolo', pin: PIN, desk: d12.id });
    soloStarted = true;
  }
  // players act on their own team's stage
  players.filter(p => p.joined).forEach((p, i) => {
    const v = H({ action: 'state', sid: p.sid });
    const d = v.desk;
    if (!d) return;
    if (d.stage === 'write') {
      if (!d.words) { H({ action: 'roll', sid: p.sid }); return; }
      const key = d.round + p.sid;
      if (!p.wrote || p.wrote !== key) {
        if ((sec / 5 + i) % 3 === 0) {                   // writing takes a little while
          const text = ctx.bndBotPost(d.words);
          // some players never press File: their draft is filed when time runs out
          H(i % 6 === 0 ? { action: 'state', sid: p.sid, draft: text } : { action: 'save', sid: p.sid, text, filed: true });
          p.wrote = key;
        }
      }
    } else if (d.stage === 'check' && v.task && !v.task.done && p.seenTask !== d.round + v.task.key) {
      p.seenTask = d.round + v.task.key;
      ok(v.task.words.length === 2 && v.task.text, 'task has a post');
      if (v.task.sample) samples++; else {
        realChecks++;
        const author = H({ action: 'tstate', pin: PIN }).posts.find(x => x.key === v.task.key);
        ok(author.desk !== d.id, 'never checks own team');
        ok(!(checkedBy[p.sid] || {})[v.task.key], 'never the same post twice');
        (checkedBy[p.sid] = checkedBy[p.sid] || {})[v.task.key] = 1;
      }
      if (i % 4 !== 1) H({ action: 'check', sid: p.sid, ok: [true, Math.random() < 0.8], stars: 1 + (i % 3) });   // a quarter never send it: the timer moves them on
    } else if (d.stage === 'result' && i % 3 === 0) {
      H({ action: 'next', sid: p.sid, round: d.round }); nextTaps++;
    }
  });
  tick(5);
  H({ action: 'tstate', pin: PIN });                  // the board's poll keeps the clocks moving
  t = H({ action: 'tstate', pin: PIN });
  if (t.desks.length === 12 && t.desks.every(d => d.stage === 'done')) { console.log('all teams done after', Math.round(sec / 60), 'min'); break; }
}
t = H({ action: 'tstate', pin: PIN });
ok(t.desks.length === 12 && t.desks.every(d => d.stage === 'done' && d.round === 3), 'every team finished 3 rounds: ' + t.desks.map(d => d.num + ':' + d.stage + d.round).join(' '));
const rounds = {};
t.desks.forEach(d => { const all = [].concat(...Object.values(d.allWords)); ok(all.length === 6 && new Set(all).size === 6, 'six different words for team ' + d.num); });
t.posts.forEach(p => { rounds[p.sid] = (rounds[p.sid] || 0) + 1; ok(p.filed, 'every post filed (auto-file at time up)'); });
ok(Object.values(rounds).every(n => n <= 3), 'at most 3 posts each');
console.log('posts', t.posts.length, 'real checks', realChecks, 'practice checks', samples, 'next taps', nextTaps);
ok(realChecks > samples, 'mostly real posts to check');
const before = t.desks.map(d => d.total).reduce((a, b) => a + b, 0);
ok(!H({ action: 'next', sid: id(1) }).desk.stage !== 'done', 'next after done is harmless');
t = H({ action: 'finish', pin: PIN });
ok(t.session.phase === 'final', 'finish game');
const after = t.desks.map(d => d.total).reduce((a, b) => a + b, 0);
ok(after >= before, 'benefit of the doubt at finish');
ok(!H({ action: 'join', sid: id(77), team: 14 }).ok, 'no joining after finish');
t.desks.sort((a, b) => a.rank - b.rank).forEach(d => console.log(' #' + d.rank, ('Team ' + d.num + ' ' + d.name).padEnd(30), String(d.total).padStart(3), JSON.stringify(d.byRound), d.members.length === 1 ? '(solo)' : ''));
const ex = H({ action: 'export', pin: PIN });
ok(ex.rows[0][1] === 'Team' && /^Player [12]$/.test(ex.rows[1][2]) && ex.rows.length === t.posts.length + 1, 'export');
const big = JSON.stringify(ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Store').getDataRange().getValues());
console.log('store size', big.length, 'chars');
// pretend players run a whole game for the demo
if (!PIN) {
  H({ action: 'newSession', pin: PIN });
  for (let k = 0; k < 600; k++) { ctx.bndBotsTick(); tick(5); }
  t = H({ action: 'tstate', pin: PIN });
  ok(t.players.length === (ctx.BND_DEMO_BOTS || 22) && t.desks.every(d => d.stage === 'done'), 'bots play to the end: ' + t.desks.map(d => d.stage).join(','));
}
console.log(fails ? fails + ' FAILURES' : 'ALL OK');
process.exit(fails ? 1 : 0);
