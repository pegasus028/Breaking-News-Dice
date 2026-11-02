/* Demo mode only: simulated classmates, so one person can try the whole game.
   The teacher console's "Simulate class" switch calls bndBotsTick() each poll. */
var BND_BOT_LINES = {
  'evacuate': ['Hundreds of residents were evacuated from Rangsit overnight.', 'Police are evacuating families who live near the canal.'],
  'submerged': ['Several cars were left submerged on Vibhavadi Road.', 'The school football field is still completely submerged.'],
  'inundate': ['The hotline has been inundated with calls since Monday.', 'Floodwater inundated the night market before dawn.'],
  'displaced': ['Displaced families are being housed in a temple hall.', 'Over two thousand people were displaced by the storm.'],
  'aftermath': ['In the aftermath, volunteers are clearing the blocked drains.', 'The aftermath of the flood will cost the city millions.'],
  'devastate': ['Rice farms across Ayutthaya were devastated this week.', 'The flood devastated three small riverside villages.'],
  'resilient': ['Officials say the city must be made more resilient.', 'Local shop owners have proved remarkably resilient.'],
  'mitigate': ['New water tunnels could mitigate the risk next year.', 'Flood damage can be mitigated by early warnings.'],
  'exacerbate': ['Blocked drains exacerbated the flooding in Lat Phrao.', 'The crisis was exacerbated by heavy traffic.'],
  'prolonged': ['Prolonged rain has closed four schools in Bangkok.', 'Residents now fear a prolonged power cut.'],
  'unprecedented': ['Officials recorded unprecedented water levels at the river gauge.', 'The river rose at an unprecedented speed.'],
  'discharge': ['More water is being discharged from the dam today.', 'The dam’s discharge has doubled since Friday.'],
  'relief': ['Relief supplies were handed out by students at noon.', 'Residents sighed with relief when the rain finally stopped.'],
  'subside': ['The water finally subsided in Don Mueang on Sunday.', 'Experts expect the flood to subside by next week.'],
  'trying-times': ['Neighbours shared food and water during these trying times.', 'These are trying times for farmers in the Central Plain.']
};

function bndBotPost(words) {
  var a = BND_BOT_LINES[words[0]], b = BND_BOT_LINES[words[1]];
  var r = Math.random();
  var s1 = a[Math.floor(Math.random() * 2)], s2 = b[Math.floor(Math.random() * 2)];
  if (r < 0.1) return s1;                          // a weak post: one word, too short
  return s1 + ' ' + s2;
}

/* realSids: students being played by a real person in another tab — bots leave them alone. */
function bndBotsTick(realSids) {
  realSids = realSids || [];
  var t = bndHandle({ action: 'tstate', pin: '' });
  if (!t.ok || !t.session) return;
  var s = t.session;
  var real = {};
  realSids.forEach(function (x) { real[x] = 1; });
  t.roster.forEach(function (st, idx) {
    if (real[st.sid] || Math.random() < 0.45) return;          // act a little at a time, like real students
    var v = bndHandle({ action: 'state', sid: st.sid });
    if (!v.joined) { if (s.phase === 'lobby' || s.phase === 'paired') bndHandle({ action: 'join', sid: st.sid, device: 'bot-' + st.sid }); return; }
    if (!v.desk) { bndHandle({ action: 'team', sid: st.sid, team: Math.floor(idx / 2) + 1 }); return; }
    if (s.phase === 'write' && v.desk) {
      if (!v.desk.words) { bndHandle({ action: 'roll', sid: st.sid }); return; }
      if (!v.myPost || !v.myPost.filed) bndHandle({ action: 'save', sid: st.sid, text: bndBotPost(v.desk.words), filed: true });
    }
    if (s.phase === 'verify' && v.task && !v.task.done) {
      bndHandle({ action: 'check', sid: st.sid, ok: [Math.random() < 0.85, Math.random() < 0.85], stars: 1 + Math.floor(Math.random() * 3) });
    }
  });
}
