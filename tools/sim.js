// Full-class simulation against the real engine (mock Apps Script services).
// Usage: node tools/sim.js [rosterFile]   default: private/Roster.gs
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = { console, Math, Date, JSON };
vm.createContext(ctx);
const roster = process.argv[2] || 'private/Roster.gs';
for (const f of ['js/mock-gas.js', 'js/words.js', 'js/check.js', roster, 'apps-script/Code.gs', 'js/bots.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const H = r => JSON.parse(JSON.stringify(ctx.bndHandle(r)));
const PIN = ctx.TEACHER_PIN;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };

ok(H({ action: 'tstate', pin: 'wrong' }).error === 'pin' || !PIN, 'pin enforced');
let t = H({ action: 'newSession', pin: PIN, settings: { rounds: 3 } });
ok(t.ok && t.session.phase === 'lobby', 'session created');
const roster0 = H({ action: 'roster' }).roster;
ok(roster0.length === ctx.ROSTER.length, 'roster served');
ok(!JSON.stringify(roster0).includes('band'), 'roster hides bands');
// 22 of the class arrive before pairing (3 absent / late)
const early = roster0.slice(0, roster0.length - 3);
early.forEach(s => ok(H({ action: 'join', sid: s.sid, device: 'dev' + s.sid }).ok, 'join ' + s.label));
ok(!H({ action: 'join', sid: early[0].sid, device: 'other' }).ok, 'second device blocked');
t = H({ action: 'pair', pin: PIN, mode: 'mixed' });
const sizes = t.desks.map(d => d.members.length);
console.log('desks', t.desks.length, 'sizes', sizes.join(','));
ok(sizes.every(n => n === 2 || n === 3) && sizes.filter(n => n === 3).length <= 1, 'pair sizes');
// mixed ability check
const band = {}; ctx.ROSTER.forEach(r => band[r.sid] = r.band);
t.desks.forEach(d => { const b = d.members.map(m => band[m.sid]); ok(Math.max(...b) - Math.min(...b) >= 1 || b.every(x => x === 2 || x === 3), 'mixed ' + d.name + ' ' + b); });
// two latecomers arrive
roster0.slice(-3, -1).forEach(s => H({ action: 'join', sid: s.sid, device: 'dev' + s.sid }));
t = H({ action: 'tstate', pin: PIN });
ok(t.players.every(p => p.desk), 'latecomers seated');
const used = {};
for (let round = 1; round <= 3; round++) {
  t = H({ action: 'go', pin: PIN, from: { phase: t.session.phase, round: t.session.round } });
  ok(t.session.phase === 'write' && t.session.round === round, 'round ' + round + ' write');
  // double click is harmless
  const again = H({ action: 'go', pin: PIN, from: { phase: 'paired', round: round - 1 } });
  ok(again.session.phase === 'write' && again.session.round === round, 'double click ignored');
  t.players.forEach(p => {
    const v = H({ action: 'roll', sid: p.sid });
    ok(v.desk.words && v.desk.words.length === 2 && v.desk.words[0] !== v.desk.words[1], 'roll');
  });
  t = H({ action: 'tstate', pin: PIN });
  t.desks.forEach(d => { d.words.forEach(w => { used[w] = (used[w] || 0) + 1; }); });
  // desks never repeat a word across rounds
  t.desks.forEach(d => { const all = [].concat(...Object.values(d.allWords)); ok(new Set(all).size === all.length, 'no repeat ' + d.name); });
  t.players.forEach((p, i) => {
    const v = H({ action: 'state', sid: p.sid });
    if (i % 7 === 3) return; // one in seven writes nothing
    const text = ctx.bndBotPost(v.desk.words);
    const draft = H({ action: 'state', sid: p.sid, draft: text.slice(0, 20) });
    ok(!draft.saveError, 'draft saved');
    H({ action: 'save', sid: p.sid, text, filed: i % 5 !== 0 });
  });
  t = H({ action: 'tstate', pin: PIN });
  console.log(' R' + round + ' write counts', JSON.stringify(t.counts), 'leader', t.desks.map(d => d.total).sort((a, b) => b - a).slice(0, 3).join('/'));
  t = H({ action: 'go', pin: PIN, from: { phase: 'write', round } });
  ok(t.session.phase === 'verify', 'verify');
  // every judge has a post from another desk
  let tasks = 0;
  t.players.forEach(p => {
    const v = H({ action: 'state', sid: p.sid });
    if (!v.task) return;
    tasks++;
    const post = t.posts.find(x => x.key === v.task.key);
    ok(post.desk !== p.desk, 'not own desk');
    ok(!v.task.text.includes('undefined'), 'task text');
    if (Math.random() < 0.9) ok(H({ action: 'check', sid: p.sid, ok: [true, Math.random() < 0.8], stars: 1 + (tasks % 3) }).ok, 'check');
  });
  t = H({ action: 'tstate', pin: PIN });
  const written = t.posts.filter(p => p.round === round && p.text.trim()).length;
  const judged = new Set(t.posts.filter(p => p.round === round && p.score.checks > 0).map(p => p.key)).size;
  console.log(' R' + round + ' verify: tasks', tasks, 'posts', written, 'judged posts', judged);
  ok(tasks === t.players.length, 'everyone has a task');
  t = H({ action: 'go', pin: PIN, from: { phase: 'verify', round } });
  ok(t.session.phase === 'reveal', 'reveal');
  const cand = t.posts.filter(p => p.round === round).sort((a, b) => b.score.total - a.score.total)[0];
  t = H({ action: 'front', pin: PIN, key: cand.key });
  ok(t.front.length === round, 'front page');
  const st = H({ action: 'state', sid: cand.sid });
  ok(st.myPost.score && st.myPost.score.front, 'author sees front page');
}
t = H({ action: 'go', pin: PIN, from: { phase: 'reveal', round: 3 } });
ok(t.session.phase === 'final', 'final');
// writes rejected after close
ok(!H({ action: 'save', sid: t.players[0].sid, text: 'late' }).ok, 'late save rejected');
t.desks.sort((a, b) => a.rank - b.rank).forEach(d => console.log(' #' + d.rank, d.name.padEnd(22), String(d.total).padStart(3), JSON.stringify(d.byRound), d.members.map(m => m.label).join(' + ')));
console.log('word coverage', Object.keys(used).length, '/ 15');
ok(Object.keys(used).length === 15, 'all 15 words drawn');
const ex = H({ action: 'export', pin: PIN });
ok(ex.rows.length > 30, 'export rows ' + ex.rows.length);
const big = JSON.stringify(ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Store').getDataRange().getValues());
console.log('store size', big.length, 'chars');
console.log(fails ? fails + ' FAILURES' : 'ALL OK');
process.exit(fails ? 1 : 0);
