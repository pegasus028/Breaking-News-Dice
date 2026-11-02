/* Demo mode only: simulated classmates, so one person can try the whole game.
   The teacher board's "Simulate class" switch calls bndBotsTick(realSids) each poll. */
var BND_BOT_LINES = BND_SAMPLE_LINES;

function bndBotPost(words) {
  var a = BND_BOT_LINES[words[0]], b = BND_BOT_LINES[words[1]];
  var s1 = a[Math.floor(Math.random() * 2)], s2 = b[Math.floor(Math.random() * 2)];
  var text = s1 + ' ' + s2;
  // make sure the post meets every filing rule (a passive, 15–25 words)
  if (!bndAnalyse(text, words).passive) text += ' Residents were warned.';
  if (bndCountWords(text) < BND_RULES.minWords) text += ' More rain is expected tonight.';
  return text;
}

/* realSids: names being played by a real person in another tab — bots leave them alone. */
function bndBotsTick(realSids) {
  var t = bndHandle({ action: 'tstate', pin: '' });
  if (!t.ok || !t.session || t.session.phase !== 'open') return;
  var real = {};
  (realSids || []).forEach(function (x) { real[x] = 1; });
  t.roster.forEach(function (st) {
    if (real[st.sid] || Math.random() < 0.6) return;          // act a little at a time, like real students
    var v = bndHandle({ action: 'state', sid: st.sid });
    if (!v.joined) { bndHandle({ action: 'join', sid: st.sid, device: 'bot-' + st.sid }); return; }
    if (v.stage === 'write') {
      if (!v.words) { bndHandle({ action: 'roll', sid: st.sid }); return; }
      if (Math.random() < 0.25) bndHandle({ action: 'save', sid: st.sid, text: bndBotPost(v.words), filed: true });
    } else if (v.stage === 'check' && v.task && Math.random() < 0.5) {
      bndHandle({ action: 'check', sid: st.sid, ok: [Math.random() < 0.85, Math.random() < 0.85], stars: 1 + Math.floor(Math.random() * 3) });
    }
  });
}
