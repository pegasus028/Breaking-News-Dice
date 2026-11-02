/* Demo mode only: simulated classmates, so one person can try the whole game.
   The teacher console's "Simulate class" switch calls bndBotsTick() each poll. */
var BND_BOT_LINES = BND_SAMPLE_LINES;

function bndBotPost(words) {
  var a = BND_BOT_LINES[words[0]], b = BND_BOT_LINES[words[1]];
  var r = Math.random();
  var s1 = a[Math.floor(Math.random() * 2)], s2 = b[Math.floor(Math.random() * 2)];
  if (r < 0.1) return s1;                          // a weak post: one word, too short
  return s1 + ' ' + s2;
}

/* Pretend players (bot-01 …) join like real students: each fills the first team that is waiting
   for a partner, otherwise the lowest empty team number, then plays its own team's rounds. */
function bndBotsTick() {
  var t = bndHandle({ action: 'tstate', pin: '' });
  if (!t.ok || !t.session || t.session.phase !== 'open') return;
  var n = (typeof BND_DEMO_BOTS === 'number') ? BND_DEMO_BOTS : 22;
  for (var i = 1; i <= n; i++) {
    if (Math.random() < 0.45) continue;                       // act a little at a time, like real students
    var id = 'bot-' + (i < 10 ? '0' : '') + i;
    var v = bndHandle({ action: 'state', sid: id });
    var d = v.desk;
    if (!d) {
      var teams = {};
      (v.teams || []).forEach(function (x) { teams[x.num] = x.members.length; });
      var pick = 0;
      for (var k = 1; k <= v.teamCount && !pick; k++) if (teams[k] === 1) pick = k;
      for (k = 1; k <= v.teamCount && !pick; k++) if (!teams[k]) pick = k;
      if (pick) bndHandle({ action: 'team', sid: id, team: pick });
      continue;
    }
    if (d.stage === 'write') {
      if (!d.words) { bndHandle({ action: 'roll', sid: id }); continue; }
      if ((!v.myPost || !v.myPost.filed) && Math.random() < 0.3) bndHandle({ action: 'save', sid: id, text: bndBotPost(d.words), filed: true });
    } else if (d.stage === 'check' && v.task && !v.task.done && Math.random() < 0.4) {
      bndHandle({ action: 'check', sid: id, ok: [Math.random() < 0.85, Math.random() < 0.85], stars: 1 + Math.floor(Math.random() * 3) });
    } else if (d.stage === 'result' && Math.random() < 0.15) {
      bndHandle({ action: 'next', sid: id, round: d.round });
    }
  }
}
