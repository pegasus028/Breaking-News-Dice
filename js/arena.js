/* Breaking News Dice — Arena view for the teacher console (projector).
   Modelled on the Nominalization Arena leaderboard: pinned top-3 cards with a crown,
   the chasing pack as bars, class snapshot, full standings, End game & podium
   (rising blocks, confetti, synthesised crowd cheer). ES5 only. */
var bndArena = (function () {
  var $ = function (id) { return document.getElementById(id); };
  var host = null;            // { call, armed, exportCsv, studentUrl, onToggle }
  var on = false;
  var last = null;            // last teacher state
  var lastPhase = '';
  var cardState = {}, lastOrder = [];
  var colourOf = {};
  var COLORS = ['#c8961e', '#2f7d52', '#b8442f', '#7a5cc4', '#2f6d9e', '#e2851d', '#5a8f3a', '#a83f6a',
    '#3a8f8a', '#9e7a2f', '#6a4fb0', '#2f9e6d', '#b04f3a', '#4f6ab0', '#8f5a2f'];
  var ctrlSig = '';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function esc(s) { return bndEsc(s); }

  function sorted(t) {
    return (t && t.players ? t.players.slice() : []).sort(function (a, b) { return (a.rank - b.rank) || a.label.localeCompare(b.label); });
  }
  function colour(sid) {
    if (!colourOf[sid]) colourOf[sid] = COLORS[Object.keys(colourOf).length % COLORS.length];
    return colourOf[sid];
  }
  function metaOf(p) {
    return p.filed + ' post' + (p.filed === 1 ? '' : 's') + ' · ' + p.checks + ' check' + (p.checks === 1 ? '' : 's') +
      (last && last.session && last.session.phase === 'final' ? '' : ' · ' + (p.stage === 'done' ? 'done' : 'round ' + p.round));
  }

  /* ---------------- top 3 cards ---------------- */
  function renderTop3(list) {
    var top = list.slice(0, 3), strip = $('arStrip');
    var names = top.map(function (p) { return p.sid; }).join('|');
    if (names !== lastOrder.join('|')) {
      var newLeader = lastOrder.length && top[0] && lastOrder[0] !== top[0].sid && top[0].total > 0;
      strip.innerHTML = ''; cardState = {};
      for (var i = 0; i < 3; i++) {
        var p = top[i], el = document.createElement('div');
        if (!p) { el.className = 'pcard slotopen'; el.innerHTML = '<div class="nm">Slot ' + (i + 1) + ' open</div>'; }
        else {
          el.className = 'pcard p' + (i + 1) + (i === 0 && newLeader ? ' newleader' : '');
          el.innerHTML = (i === 0 && p.total > 0 ? '<div class="crown" aria-hidden="true">👑</div>' : '') +
            '<div class="rank">' + p.rank + '</div><div class="info"><div class="nm">' + esc(p.label) + '</div><div class="meta">' + esc(metaOf(p)) + '</div></div>' +
            '<div><div class="sc">' + p.total + '</div><div class="delta"></div></div>';
          cardState[p.sid] = { el: el, score: p.total };
        }
        strip.appendChild(el);
      }
      if (newLeader) chime();
      lastOrder = top.map(function (p) { return p.sid; });
    } else {
      top.forEach(function (p) {
        var c = cardState[p.sid]; if (!c) return;
        c.el.querySelector('.meta').textContent = metaOf(p);
        c.el.querySelector('.rank').textContent = p.rank;
        if (p.total !== c.score) {
          countUp(c.el.querySelector('.sc'), c.score, p.total);
          var d = c.el.querySelector('.delta');
          d.textContent = (p.total > c.score ? '+' : '') + (p.total - c.score);
          d.className = 'delta' + (p.total < c.score ? ' dn' : '');
          clearTimeout(d.tm); d.tm = setTimeout(function () { d.textContent = ''; }, 2600);
          c.el.classList.remove('bump'); void c.el.offsetWidth; c.el.classList.add('bump');
          c.score = p.total;
        }
      });
    }
  }
  function countUp(el, from, to) {
    if (reduced || !window.requestAnimationFrame) { el.textContent = to; return; }
    var t0 = Date.now(), dur = 650;
    (function step() {
      var k = Math.min(1, (Date.now() - t0) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    })();
  }

  /* ---------------- chasing pack (ranks 4+) as bars ---------------- */
  function renderBars(list) {
    var rest = list.slice(3), bars = $('arBars'), empty = $('arEmpty');
    $('arChTitle').textContent = rest.length ? 'The chasing pack · places 4–' + list.length : (list.length ? 'Everyone is on the podium' : 'The chasing pack');
    if (!rest.length) {
      bars.innerHTML = '';
      empty.classList.remove('hidden');
      empty.innerHTML = list.length ? 'Everyone playing is in the top three<small>More students appear here as they join</small>'
        : 'Waiting for students to join…<small>Scores appear the moment the first post is filed</small>';
      return;
    }
    empty.classList.add('hidden');
    var max = Math.max(10, list[0].total);
    var steps = max <= 20 ? 5 : max <= 60 ? 10 : max <= 150 ? 25 : 50;
    bars.style.setProperty('--grid', (steps / max * 100) + '%');
    rest.forEach(function (p, i) {
      var row = bars.querySelector('[data-sid="' + p.sid + '"]');
      if (!row) {
        row = document.createElement('div');
        row.className = 'ar-row'; row.setAttribute('data-sid', p.sid);
        row.innerHTML = '<span class="lab"></span><span class="track"><span class="bar"></span><span class="val"></span></span>';
        row.querySelector('.bar').style.background = colour(p.sid);
        bars.appendChild(row);
      }
      row.style.order = i;
      row.querySelector('.lab').textContent = p.rank + '. ' + p.label;
      row.querySelector('.bar').style.width = Math.max(1.5, p.total / max * 100) + '%';
      row.querySelector('.val').style.left = 'calc(' + Math.max(1.5, p.total / max * 100) + '% + 8px)';
      row.querySelector('.val').textContent = p.total;
    });
    Array.prototype.slice.call(bars.querySelectorAll('.ar-row')).forEach(function (row) {
      if (!rest.some(function (p) { return p.sid === row.getAttribute('data-sid'); })) row.remove();
    });
  }

  function renderSide(list, t) {
    var c = t.counts || { players: list.length, filed: 0, checks: 0 };
    $('kPlayers').textContent = c.players;
    $('kPosts').textContent = c.filed;
    $('kChecks').textContent = c.checks;
    $('kTop').textContent = list.length ? list[0].total : 0;
    var medals = ['🥇', '🥈', '🥉'];
    $('arFeed').innerHTML = list.map(function (p, i) {
      return '<div class="row' + (i < 3 ? ' top3' : '') + '"><span class="t">' + (i < 3 ? medals[i] + ' ' : '') + p.rank + '. ' + esc(p.label) + '</span>' +
        '<span class="acc">' + p.total + ' pts · ' + p.filed + ' posts</span></div>';
    }).join('');
  }

  /* ---------------- controls ---------------- */
  function renderCtrl(t) {
    var s = t && t.session, b = [];
    if (s && s.phase === 'open') b.push(['end', 'End game &amp; show podium', '']);
    if (s && s.phase === 'final') b.push(['podium', 'Podium', ''], ['export', 'Download results', 'ghost']);
    b.push(['fs', 'Fullscreen', 'ghost'], ['exit', 'Classic board', 'ghost']);
    var status = s ? (s.phase === 'final' ? 'Game over' : 'Live · ' + (t.counts ? t.counts.players : 0) + ' playing') : 'No game open';
    var sig = JSON.stringify(b);
    if (sig !== ctrlSig) {
      ctrlSig = sig;
      $('arCtrl').innerHTML = b.map(function (x) {
        return '<button type="button" class="' + x[2] + '" data-ar="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '<div class="spacer"></div><div class="status" id="arStatus"></div>';
    }
    $('arStatus').textContent = status;
  }

  function bindCtrl() {
    $('arCtrl').onclick = function (e) {
      var b = e.target.closest('button[data-ar]'); if (!b) return;
      var a = b.getAttribute('data-ar');
      unlockAudio();
      if (a === 'exit') { toggle(false); return; }
      if (a === 'fs') { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); return; }
      if (a === 'podium') { showPodium(); return; }
      if (a === 'export') { host.exportCsv(); return; }
      if (a === 'end' && host.armed(b)) host.call({ action: 'finish' });
    };
    $('arClose').onclick = hidePodium;
    $('arMute').onclick = function () {
      muted = !muted;
      $('arMute').textContent = muted ? '🔇 Unmute crowd' : '🔊 Mute crowd';
      if (crowd) { try { crowd.out.gain.exponentialRampToValueAtTime(muted ? 0.0001 : 0.5, ac().currentTime + 0.3); } catch (err) { /* ignore */ } }
    };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hidePodium(); });
  }

  /* ---------------- update from each teacher poll ---------------- */
  function update(t) {
    last = t;
    var s = t && t.session;
    var phase = s ? s.phase : '';
    // the game just ended (from either board): show the podium
    if (lastPhase === 'open' && phase === 'final') setTimeout(showPodium, 600);
    if (phase === 'open' && lastPhase === 'final') hidePodium();
    if (!s) { lastOrder = []; cardState = {}; colourOf = {}; }
    lastPhase = phase;
    if (!on) return;
    var list = s ? sorted(t) : [];
    $('arHint').innerHTML = s && phase === 'open' ? 'Students: open <b>' + esc(host.studentUrl()) + '</b> and tap your name' : (phase === 'final' ? 'Final scores' : 'Open a game on the classic board to start');
    $('arBig').textContent = t && t.counts ? t.counts.filed : 0;
    $('arState').textContent = phase === 'open' ? 'Game live' : phase === 'final' ? 'Game over' : 'No game yet';
    renderTop3(list);
    renderBars(list);
    renderSide(list, t || {});
    renderCtrl(t);
  }

  function toggle(v) {
    on = v;
    bndStore('bnd-arena', v ? '1' : '0');
    $('arena').classList.toggle('hidden', !v);
    document.body.classList.toggle('arena-on', v);
    lastOrder = []; ctrlSig = '';
    if (host.onToggle) host.onToggle(v);
    if (v && last) update(last);
  }

  /* ---------------- podium ---------------- */
  function showPodium() {
    var list = sorted(last);
    if (!list.length) return;
    // one step per score: students who tie share a step (gold, silver, bronze = the first three scores)
    var groups = [];
    list.forEach(function (p) {
      var g = groups[groups.length - 1];
      if (g && g.total === p.total) g.people.push(p); else if (groups.length < 3) groups.push({ total: p.total, rank: p.rank, people: [p] });
    });
    var onPodium = 0;
    groups.forEach(function (g) { onPodium += g.people.length; });
    var order = [1, 0, 2], cls = ['b2', 'b1', 'b3'];
    $('arPlinks').innerHTML = order.map(function (gi, pos) {
      var g = groups[gi]; if (!g) return '<div class="pcol"></div>';
      var names = g.people.slice(0, 3).map(function (p) { return esc(p.label); }).join(' &amp; ') + (g.people.length > 3 ? ' +' + (g.people.length - 3) : '');
      var info = g.people.length === 1 ? g.people[0].filed + ' posts · ' + g.people[0].checks + ' fact-checks' : 'tied on ' + g.total;
      return '<div class="pcol' + (gi === 0 ? ' winner' : '') + '"><div class="nm">' + names + '</div><div class="sc">' + g.total + '</div>' +
        '<div class="ac">' + info + '</div><div class="block ' + cls[pos] + '">' + (gi + 1) + '</div></div>';
    }).join('');
    $('arRest').innerHTML = list.slice(onPodium, onPodium + 7).map(function (p) { return p.rank + '. ' + esc(p.label) + ' — ' + p.total + ' pts'; }).join('<br>');
    $('arPodium').classList.add('show');
    startConfetti();
    startCrowd();
    $('arClose').focus();
  }
  function hidePodium() {
    var pd = $('arPodium');
    if (!pd.classList.contains('show')) return;
    pd.classList.remove('show');
    stopConfetti(); stopCrowd();
  }

  /* ---------------- audio: lead-change chime + synthesised crowd ---------------- */
  var actx = null, crowd = null, muted = false;
  function ac() {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function unlockAudio() { try { ac(); } catch (e) { /* no audio */ } }
  document.addEventListener('click', unlockAudio, { once: true });

  function chime() {
    try {
      var c = ac(), t0 = c.currentTime;
      [784, 988, 1319].forEach(function (f, i) {
        var o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + i * 0.08);
        g.gain.exponentialRampToValueAtTime(0.10, t0 + i * 0.08 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.08 + 0.45);
        o.connect(g); g.connect(c.destination); o.start(t0 + i * 0.08); o.stop(t0 + i * 0.08 + 0.5);
      });
    } catch (e) { /* no audio */ }
  }
  function noiseBuffer(c, seconds) {
    var len = Math.floor(c.sampleRate * seconds), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0), lastV = 0;
    for (var i = 0; i < len; i++) { var w = Math.random() * 2 - 1; lastV = (lastV + 0.02 * w) / 1.02; d[i] = lastV * 3.2; }
    return buf;
  }
  function startCrowd() {
    stopCrowd();
    try {
      var c = ac();
      var out = c.createGain(); out.gain.value = 0; out.connect(c.destination);
      var src = c.createBufferSource(); src.buffer = noiseBuffer(c, 4); src.loop = true;
      var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.65;
      var roar = c.createGain(); roar.gain.value = 0.42;
      src.connect(bp); bp.connect(roar); roar.connect(out); src.start();
      var lfo = c.createOscillator(), lfoG = c.createGain();
      lfo.frequency.value = 0.18; lfoG.gain.value = 0.16; lfo.connect(lfoG); lfoG.connect(roar.gain); lfo.start();
      var t0 = c.currentTime;
      out.gain.setValueAtTime(0.0001, t0);
      out.gain.exponentialRampToValueAtTime(muted ? 0.0001 : 0.5, t0 + 0.7);
      var clapBuf = noiseBuffer(c, 0.35);
      var clap = function () {
        var s = c.createBufferSource(); s.buffer = clapBuf;
        var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400 + Math.random() * 900;
        var g = c.createGain(), t = c.currentTime;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.10 + Math.random() * 0.16, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09 + Math.random() * 0.08);
        s.connect(hp); hp.connect(g); g.connect(out); s.start(t); s.stop(t + 0.35);
      };
      var whistle = function () {
        var o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
        o.type = 'sine';
        o.frequency.setValueAtTime(1700 + Math.random() * 500, t);
        o.frequency.linearRampToValueAtTime(2500 + Math.random() * 700, t + 0.16);
        o.frequency.linearRampToValueAtTime(1900 + Math.random() * 400, t + 0.34);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.07, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.42);
      };
      var clapTimer = setInterval(function () { var n = 2 + Math.floor(Math.random() * 4); for (var i = 0; i < n; i++) setTimeout(clap, Math.random() * 260); }, 170);
      var whistleTimer = setInterval(function () { if (Math.random() < 0.55) whistle(); }, 1500);
      crowd = { out: out, src: src, lfo: lfo, clapTimer: clapTimer, whistleTimer: whistleTimer };
    } catch (e) { crowd = null; }
  }
  function stopCrowd() {
    if (!crowd) return;
    var cr = crowd; crowd = null;
    try {
      clearInterval(cr.clapTimer); clearInterval(cr.whistleTimer);
      var c = ac(), t = c.currentTime;
      cr.out.gain.cancelScheduledValues(t);
      cr.out.gain.setValueAtTime(Math.max(0.0001, cr.out.gain.value), t);
      cr.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      setTimeout(function () { try { cr.src.stop(); cr.lfo.stop(); } catch (e) { /* stopped */ } }, 800);
    } catch (e) { /* ignore */ }
  }

  /* ---------------- confetti: continuous rainfall while the podium is open ---------------- */
  var cvs = null, cctx = null, bits = [], confOn = false, confRAF = null;
  var CONF = ['#c8961e', '#f4ead7', '#2f7d52', '#b8442f', '#7a5cc4', '#e2851d', '#cfc3a8'];
  function sizeCanvas() { if (cvs) { cvs.width = window.innerWidth; cvs.height = window.innerHeight; } }
  function makeBit(atTop) {
    return { x: Math.random() * cvs.width, y: atTop ? -20 - Math.random() * cvs.height * 0.4 : Math.random() * cvs.height,
      w: 6 + Math.random() * 8, h: 9 + Math.random() * 13, vy: 55 + Math.random() * 115,
      sway: 18 + Math.random() * 46, phase: Math.random() * Math.PI * 2, swaySpd: 0.7 + Math.random() * 1.5,
      rot: Math.random() * Math.PI, vrot: (Math.random() - 0.5) * 4.5,
      col: CONF[Math.floor(Math.random() * CONF.length)], flip: Math.random() * Math.PI * 2, vflip: 2 + Math.random() * 3 };
  }
  function startConfetti() {
    if (confOn || reduced || !cctx) return;
    confOn = true; cvs.classList.add('show'); sizeCanvas();
    bits = []; for (var i = 0; i < 190; i++) bits.push(makeBit(false));
    var lastT = Date.now();
    (function loop() {
      if (!confOn) return;
      var now = Date.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
      cctx.clearRect(0, 0, cvs.width, cvs.height);
      bits.forEach(function (b) {
        b.y += b.vy * dt; b.phase += b.swaySpd * dt; b.x += Math.sin(b.phase) * b.sway * dt;
        b.rot += b.vrot * dt; b.flip += b.vflip * dt;
        if (b.y > cvs.height + 30) { var nb = makeBit(true); for (var k in nb) b[k] = nb[k]; b.y = -20; }
        cctx.save(); cctx.translate(b.x, b.y); cctx.rotate(b.rot); cctx.globalAlpha = 0.92; cctx.fillStyle = b.col;
        var h = b.h * Math.abs(Math.cos(b.flip)); cctx.fillRect(-b.w / 2, -h / 2, b.w, Math.max(2, h)); cctx.restore();
      });
      confRAF = requestAnimationFrame(loop);
    })();
  }
  function stopConfetti() {
    confOn = false;
    if (confRAF) cancelAnimationFrame(confRAF);
    if (cctx) cctx.clearRect(0, 0, cvs.width, cvs.height);
    if (cvs) cvs.classList.remove('show');
  }

  function init(h) {
    host = h;
    cvs = $('arConfetti'); cctx = cvs && cvs.getContext ? cvs.getContext('2d') : null;
    window.addEventListener('resize', sizeCanvas);
    bindCtrl();
    if (bndStore('bnd-arena') === '1') toggle(true);
  }

  return { init: init, update: update, toggle: function (v) { toggle(v === undefined ? !on : v); }, isOn: function () { return on; }, showPodium: showPodium };
})();
