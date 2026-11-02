// Full-class simulation against the real engine (mock Apps Script services).
// Each student signs in from the roster and plays at her own speed: roll → write (file only when every
// rule is met) → fact-check one post → next round, until the teacher finishes the game.
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

if (PIN) ok(H({ action: 'tstate', pin: 'wrong' }).error === 'pin', 'pin enforced');
let t = H({ action: 'newSession', pin: PIN });
ok(t.ok && t.session.phase === 'open' && t.session.requirePassive, 'session open, passive required');
const roster = H({ action: 'roster' }).roster;
ok(roster.length === ctx.ROSTER.length, 'roster served');
const A = roster[0].sid;
let v = H({ action: 'join', sid: A, device: 'devA' });
ok(v.ok && v.round === 1 && v.stage === 'write', 'joins straight into round 1');
ok(!H({ action: 'join', sid: A, device: 'other' }).ok, 'second device blocked');
ok(!H({ action: 'save', sid: A, text: 'x', filed: true }).ok, 'cannot file before rolling');
v = H({ action: 'roll', sid: A });
const w = v.words;
ok(w && w.length === 2 && w[0] !== w[1], 'rolled two words');
// filing gate
const W = id => ctx.BND_WORD_BY_ID[id].forms[0];
let r = H({ action: 'save', sid: A, text: 'Short post with ' + W(w[0]) + '.', filed: true });
ok(!r.ok && /both dice words/.test(r.error) && /15/.test(r.error), 'gate: words and length');
r = H({ action: 'save', sid: A, text: 'Today in the city the news said ' + W(w[0]) + ' and ' + W(w[1]) + ' were the main words for everyone to learn now.', filed: true });
ok(!r.ok && (/passive/.test(r.error) || r.ok), 'gate: passive required');
r = H({ action: 'save', sid: A, text: 'After the water was subsided, ' + W(w[0]) + ' and ' + W(w[1]) + ' were reported by officials who visited the area today.', filed: true });
ok(!r.ok && /passive error/.test(r.error), 'gate: passive error blocks filing');
v = H({ action: 'save', sid: A, text: ctx.bndBotPost(w), filed: true });
ok(v.ok && v.stage === 'check' && v.task && v.task.sample, 'filed → practice fact-check (nobody else has filed)');
v = H({ action: 'check', sid: A, ok: [true, true], stars: 3 });
ok(v.ok && v.round === 2 && v.stage === 'write' && !v.words, 'check → straight to round 2');
ok(v.lastPost && v.lastPost.round === 1 && v.lastPost.score.autoPts >= 7, 'last post scored');

// the whole class plays at different speeds for 15 simulated minutes
const speed = {};
roster.forEach((s, i) => { speed[s.sid] = 0.15 + (i % 5) * 0.12; H({ action: 'join', sid: s.sid, device: 'dev' + s.sid }); });
const seen = {};
let samples = 0, real = 0, ownChecks = 0, rejected = 0;
for (let tick = 0; tick < 180; tick++) {
  roster.forEach(s => {
    if (Math.random() > speed[s.sid]) return;
    const st = H({ action: 'state', sid: s.sid });
    if (st.stage === 'write') {
      if (!st.words) { H({ action: 'roll', sid: s.sid }); return; }
      // weaker drafts first sometimes: the gate must refuse them
      if (Math.random() < 0.2) { const bad = H({ action: 'save', sid: s.sid, text: W(st.words[0]) + ' only.', filed: true }); if (!bad.ok) rejected++; else ok(false, 'bad post filed'); return; }
      H({ action: 'state', sid: s.sid, draft: 'draft ' + tick });
      H({ action: 'save', sid: s.sid, text: ctx.bndBotPost(st.words), filed: true });
    } else if (st.stage === 'check') {
      if (st.task.sample) samples++; else {
        real++;
        const post = H({ action: 'tstate', pin: PIN }).posts.find(p => p.key === st.task.key);
        if (post.sid === s.sid) ownChecks++;
        const k = s.sid + st.task.key;
        ok(!seen[k], 'never the same post twice'); seen[k] = 1;
      }
      H({ action: 'check', sid: s.sid, ok: [true, Math.random() < 0.8], stars: 1 + (tick % 3) });
    }
  });
}
t = H({ action: 'tstate', pin: PIN });
ok(ownChecks === 0, 'never checks her own post');
ok(rejected > 0, 'gate refused weak posts: ' + rejected);
const rounds = t.players.map(p => p.filed).sort((a, b) => a - b);
console.log('posts filed per student (slow → fast):', rounds.join(' '));
ok(rounds[rounds.length - 1] > rounds[0] + 3, 'faster students play more rounds');
console.log('real checks', real, 'practice checks', samples, 'posts', t.posts.length);
ok(t.posts.every(p => p.score.autoPts >= 7), 'every filed post met the rules (7+ automatic points)');
// each student's words: no repeat until all 15 used
const rolls = {};
t.posts.forEach(p => { (rolls[p.sid] = rolls[p.sid] || []).push(...p.words); });
Object.entries(rolls).forEach(([sid, ws]) => { const first = ws.slice(0, 14); ok(new Set(first).size === first.length, 'no repeat in first 7 rounds for ' + sid); });
const before = t.players.reduce((a, p) => a + p.total, 0);
t = H({ action: 'finish', pin: PIN });
ok(t.session.phase === 'final', 'finish');
ok(t.players.reduce((a, p) => a + p.total, 0) >= before, 'benefit of the doubt at finish');
ok(!H({ action: 'save', sid: A, text: 'late', filed: true }).ok, 'no filing after finish');
t.players.sort((a, b) => a.rank - b.rank).slice(0, 5).forEach(p => console.log(' #' + p.rank, p.label.padEnd(16), String(p.total).padStart(4), p.filed + ' posts'));
const ex = H({ action: 'export', pin: PIN });
ok(ex.rows[0][0] === 'Student' && ex.rows.length > t.posts.length, 'export');
const big = JSON.stringify(ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Store').getDataRange().getValues());
console.log('store size', big.length, 'chars');
if (!PIN) {
  H({ action: 'newSession', pin: PIN });
  for (let k = 0; k < 120; k++) ctx.bndBotsTick([]);
  t = H({ action: 'tstate', pin: PIN });
  ok(t.players.length === roster.length && t.posts.length > 20, 'bots play: ' + t.posts.length + ' posts');
}
console.log(fails ? fails + ' FAILURES' : 'ALL OK');
process.exit(fails ? 1 : 0);
