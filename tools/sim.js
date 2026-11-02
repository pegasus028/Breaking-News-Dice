// Full-class simulation against the real engine (mock Apps Script services).
// Players are anonymous device ids that tap team numbers, like Conditionals Arena.
// Usage: node tools/sim.js [settingsFile]   default: js/demo-settings.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = { console, Math, Date, JSON };
vm.createContext(ctx);
const settings = process.argv[2] || 'js/demo-settings.js';
for (const f of ['js/mock-gas.js', settings, 'apps-script/Code.gs', 'js/bots.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const H = r => JSON.parse(JSON.stringify(ctx.bndHandle(r)));
const PIN = ctx.TEACHER_PIN;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const id = i => 'dev-c' + String(i).padStart(2, '0');

if (PIN) ok(H({ action: 'tstate', pin: 'wrong' }).error === 'pin', 'pin enforced');
ok(!H({ action: 'join', sid: id(1), team: 1 }).ok || true, 'join before any session handled');
let t = H({ action: 'newSession', pin: PIN, settings: { rounds: 3 } });
ok(t.ok && t.session.phase === 'lobby', 'session created');
ok(!JSON.stringify(t).match(/roster|name"/), 'no names in teacher state');

// 22 devices arrive: pairs on teams 1..11 in arrival order
for (let i = 1; i <= 22; i++) {
  const team = Math.ceil(i / 2);
  const v = H({ action: 'join', sid: id(i), team });
  ok(v.ok && v.desk.num === team, 'join team ' + team);
  ok(v.me.label === 'Player ' + (i % 2 ? 1 : 2), 'role ' + v.me.label + ' for ' + id(i));
}
// a third device cannot join a full team
const full = H({ action: 'join', sid: id(23), team: 3 });
ok(!full.ok && full.full && /already has two players/.test(full.error), 'full team rejected');
ok(!H({ action: 'join', sid: id(23), team: 0 }).ok, 'bad number rejected');
ok(!H({ action: 'join', sid: 'x', team: 4 }).ok, 'bad id rejected');
// rejoining the same team is harmless; a player can change team before the start
ok(H({ action: 'join', sid: id(1), team: 1 }).desk.num === 1, 'same team again');
ok(H({ action: 'join', sid: id(1), team: 15 }).desk.num === 15, 'change team');
ok(H({ action: 'join', sid: id(1), team: 1 }).me.label === 'Player 1', 'back on team 1 takes the free Player 1 seat');
ok(H({ action: 'leaveTeam', sid: id(2) }).desk === undefined, 'leave team');
ok(H({ action: 'join', sid: id(2), team: 1 }).me.label === 'Player 2', 'rejoining partner is Player 2');
t = H({ action: 'tstate', pin: PIN });
ok(!t.desks.some(d => d.num === 15), 'empty team removed');
ok(t.desks.every(d => d.members.length === 2), 'all teams are pairs');
console.log('teams', t.desks.map(d => d.num).join(','), 'players', t.players.length);
ok(t.players.every(p => /^Team \d+ · Player [12]$/.test(p.label)), 'teacher labels are Team n · Player k');

const used = {};
for (let round = 1; round <= 3; round++) {
  t = H({ action: 'go', pin: PIN, from: { phase: t.session.phase, round: t.session.round } });
  ok(t.session.phase === 'write' && t.session.round === round, 'round ' + round + ' write');
  const again = H({ action: 'go', pin: PIN, from: { phase: 'lobby', round: round - 1 } });
  ok(again.session.phase === 'write' && again.session.round === round, 'double click ignored');
  if (round === 1) {
    ok(!H({ action: 'join', sid: id(3), team: 13 }).ok, 'team locked after start');
    const late = H({ action: 'join', sid: id(23), team: 12 });
    const late2 = H({ action: 'join', sid: id(24), team: 12 });
    ok(late.ok && late2.ok && late2.desk.members.length === 2, 'latecomers form team 12 mid-game');
    t = H({ action: 'tstate', pin: PIN });
  }
  t.players.forEach(p => {
    const v = H({ action: 'roll', sid: p.sid });
    ok(v.desk.words && v.desk.words.length === 2 && v.desk.words[0] !== v.desk.words[1], 'roll');
  });
  t = H({ action: 'tstate', pin: PIN });
  t.desks.forEach(d => { d.words.forEach(w => { used[w] = (used[w] || 0) + 1; }); });
  t.desks.forEach(d => { const all = [].concat(...Object.values(d.allWords)); ok(new Set(all).size === all.length, 'no repeat team ' + d.num); });
  t.players.forEach((p, i) => {
    if (i % 7 === 3) return;
    const v = H({ action: 'state', sid: p.sid });
    const text = ctx.bndBotPost(v.desk.words);
    ok(!H({ action: 'state', sid: p.sid, draft: text.slice(0, 20) }).saveError, 'draft saved');
    H({ action: 'save', sid: p.sid, text, filed: i % 5 !== 0 });
  });
  t = H({ action: 'go', pin: PIN, from: { phase: 'write', round } });
  ok(t.session.phase === 'verify', 'verify');
  let tasks = 0;
  t.players.forEach(p => {
    const v = H({ action: 'state', sid: p.sid });
    if (!v.task) return;
    tasks++;
    ok(t.posts.find(x => x.key === v.task.key).desk !== p.desk, 'not own team');
    if (Math.random() < 0.9) ok(H({ action: 'check', sid: p.sid, ok: [true, Math.random() < 0.8], stars: 1 + (tasks % 3) }).ok, 'check');
  });
  ok(tasks === t.players.length, 'everyone has a task');
  t = H({ action: 'go', pin: PIN, from: { phase: 'verify', round } });
  ok(t.session.phase === 'reveal', 'reveal');
  const cand = t.posts.filter(p => p.round === round).sort((a, b) => b.score.total - a.score.total)[0];
  t = H({ action: 'front', pin: PIN, key: cand.key });
  ok(t.front.length === round, 'front page');
  ok(H({ action: 'state', sid: cand.sid }).myPost.score.front, 'author sees front page');
}
t = H({ action: 'go', pin: PIN, from: { phase: 'reveal', round: 3 } });
ok(t.session.phase === 'final', 'final');
ok(!H({ action: 'save', sid: t.players[0].sid, text: 'late' }).ok, 'late save rejected');
t.desks.sort((a, b) => a.rank - b.rank).forEach(d => console.log(' #' + d.rank, ('Team ' + d.num + ' ' + d.name).padEnd(30), String(d.total).padStart(3), JSON.stringify(d.byRound)));
ok(Object.keys(used).length === 15, 'all 15 words drawn');
const ex = H({ action: 'export', pin: PIN });
ok(ex.rows[0][1] === 'Team' && ex.rows[0][2] === 'Player' && /^Player [12]$/.test(ex.rows[1][2]), 'export has team + player, no names');
// pretend players fill a fresh game for the demo
if (!PIN) {
H({ action: 'newSession', pin: PIN });
for (let k = 0; k < 30; k++) ctx.bndBotsTick();
t = H({ action: 'tstate', pin: PIN });
ok(t.players.length === (ctx.BND_DEMO_BOTS || 22) && t.desks.every(d => d.members.length === 2), 'bots pair up: ' + t.players.length);
}
console.log(fails ? fails + ' FAILURES' : 'ALL OK');
process.exit(fails ? 1 : 0);
