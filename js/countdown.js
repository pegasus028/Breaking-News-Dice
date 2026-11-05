/* Breaking News Dice — teacher countdown timer (classic board header + Arena view).
   Front end only: the clock lives in this browser (localStorage 'bnd-countdown'), keyed to the game id,
   so it survives a reload of the projector page. Modelled on the Nominalization Arena "Time Remaining" clock:
   amber under 1 minute, red pulse under 30 s. At 0:00 it sounds a buzzer and, if "End at 0:00" is ticked,
   ends the game (the same idempotent 'finish' action as the End game button), which opens the podium.
   ES5 only (old iPads). */
var bndCountdown = (function () {
  var $ = function (id) { return document.getElementById(id); };
  var PRESETS = [3, 5, 8, 10, 12, 15, 20, 25, 30];
  var host = null;              // { finish: fn() }
  var game = null;              // { id, phase } of the current game, or null
  var st = load();              // { gid, end, left, mins, auto, fired }
  var tick = null, uiSig = '';

  function load() {
    var o = null;
    try { o = JSON.parse(bndStore('bnd-countdown') || 'null'); } catch (e) { o = null; }
    return o || { gid: '', end: 0, left: 0, mins: 10, auto: true, fired: false };
  }
  function save() { bndStore('bnd-countdown', JSON.stringify(st)); }

  function running() { return st.end > 0; }
  function paused() { return !st.end && st.left > 0; }
  function remaining() {
    if (running()) return Math.max(0, st.end - Date.now());
    return st.left;
  }

  /* ---------- actions ---------- */
  function start(mins) {
    st.mins = mins; st.end = Date.now() + mins * 60000; st.left = 0; st.fired = false;
    st.gid = game ? game.id : '';
    save(); beep(660, 0.12); render(true);
  }
  function pause() { if (!running()) return; st.left = remaining(); st.end = 0; save(); render(true); }
  function resume() { if (!paused()) return; st.end = Date.now() + st.left; st.left = 0; save(); render(true); }
  function add(min) {
    if (running()) st.end += min * 60000; else if (paused()) st.left += min * 60000;
    else if (st.fired) { st.end = Date.now() + min * 60000; st.fired = false; }
    save(); render(true);
  }
  function stop() { st.end = 0; st.left = 0; st.fired = false; save(); render(true); }

  /* ---------- the game changed (from each teacher poll) ---------- */
  function update(t) {
    var s = t && t.session;
    game = s ? { id: s.id, phase: s.phase } : null;
    // a timer belongs to one game: clear it when a new game starts or the game is gone
    if (st.gid && (!game || game.id !== st.gid) && (running() || paused() || st.fired)) { stop(); }
    // game ended some other way (End game button): freeze the clock where it is
    if (game && game.phase === 'final' && running()) { st.left = remaining(); st.end = 0; save(); }
    render(false);
  }

  /* ---------- drawing ---------- */
  function fmt(ms) { return bndClock(Math.ceil(ms / 1000)); }
  function cls(ms) {
    if (st.fired && !running()) return ' up';
    var s = Math.ceil(ms / 1000);
    return s <= 30 ? ' danger' : s < 60 ? ' warn' : '';
  }
  function state() {
    if (!game) return 'none';
    if (game.phase === 'final') return (running() || paused() || st.fired) ? 'over' : 'none';
    if (running()) return 'run';
    if (paused()) return 'pause';
    if (st.fired) return 'up';
    return 'idle';
  }

  function controlsHtml() {
    var k = state(), h = '';
    if (k === 'idle' || k === 'up') {
      h += '<select class="cd-mins" aria-label="Minutes">' + PRESETS.map(function (m) {
        return '<option value="' + m + '"' + (m === st.mins ? ' selected' : '') + '>' + m + ' min</option>';
      }).join('') + '</select>' +
        '<button type="button" class="cd-btn go" data-cd="start">⏱ ' + (k === 'up' ? 'Restart' : 'Start timer') + '</button>';
      if (k === 'up') h += '<button type="button" class="cd-btn" data-cd="add">+1 min</button>';
    } else if (k === 'run' || k === 'pause') {
      h += '<button type="button" class="cd-btn" data-cd="' + (k === 'run' ? 'pause' : 'resume') + '">' + (k === 'run' ? 'Pause' : 'Resume') + '</button>' +
        '<button type="button" class="cd-btn" data-cd="add">+1 min</button>' +
        '<button type="button" class="cd-btn" data-cd="stop">Stop</button>';
    }
    if (k !== 'none' && k !== 'over') {
      h += '<label class="cd-auto"><input type="checkbox" data-cd="auto"' + (st.auto ? ' checked' : '') + '> End game at 0:00</label>';
    }
    return h;
  }

  function render(force) {
    var k = state(), ms = remaining();
    var text = (k === 'none' || k === 'idle') ? '' : (k === 'up' || (k === 'over' && st.fired)) ? "Time's up" : fmt(ms);
    var label = k === 'pause' ? 'Paused' : k === 'run' ? 'Time remaining' : k === 'up' ? 'Writing time over' : k === 'over' ? 'Game over' : 'Timer';
    var sig = k + '|' + st.auto + '|' + st.mins + '|' + !!text;
    var redo = force || sig !== uiSig;
    uiSig = sig;
    // classic board header: label, big clock, controls
    var tm = $('timer');
    if (tm) {
      tm.className = 'tc-timer' + (text ? cls(ms) : '') + (k === 'pause' ? ' paused' : '');
      if (redo || !tm.querySelector('.cd-clock') && text) {
        tm.innerHTML = (text ? '<div class="cd-lab">' + label + '</div><div class="cd-clock" role="timer" aria-live="off">' + bndEsc(text) + '</div>' : '') +
          (k === 'none' ? '' : '<div class="cd-ctl">' + controlsHtml() + '</div>');
      } else {
        var clockEl = tm.querySelector('.cd-clock');
        if (clockEl) clockEl.textContent = text;
      }
    }
    // Arena view: big clock in the header, controls in the control bar
    var big = $('arClock');
    if (big) {
      big.textContent = text || '--:--';
      big.className = 'big' + (text ? cls(ms) : '');
      $('arClockLab').textContent = k === 'run' || k === 'pause' ? 'Time remaining' : 'Countdown';
      $('arClockState').textContent = k === 'run' ? 'Writing time' : k === 'pause' ? 'Paused' : k === 'up' ? 'Writing time over' : k === 'over' ? 'Game over' : (game && game.phase === 'open' ? 'Timer not started' : 'No game yet');
    }
    var ac = $('arTimerCtl');
    if (ac && redo) ac.innerHTML = k === 'none' || k === 'over' ? '' : controlsHtml();
  }

  function loop() {
    if (running()) {
      var ms = remaining();
      if (ms <= 0) {
        st.end = 0; st.left = 0; st.fired = true; save();
        buzzer();
        render(true);
        if (st.auto && game && game.phase === 'open' && st.gid === game.id && host) host.finish();
        return;
      }
      render(false);
    }
  }

  /* ---------- sound ---------- */
  var actx = null;
  function ac() {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function beep(f, dur) {
    try {
      var c = ac(), o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
    } catch (e) { /* no audio */ }
  }
  function buzzer() {
    try {
      var c = ac(), t0 = c.currentTime;
      [0, 0.32, 0.64].forEach(function (d, i) {
        var o = c.createOscillator(), g = c.createGain();
        o.type = 'square'; o.frequency.value = i === 2 ? 330 : 440;
        g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.09, t0 + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + (i === 2 ? 0.7 : 0.25));
        o.connect(g); g.connect(c.destination); o.start(t0 + d); o.stop(t0 + d + 0.75);
      });
    } catch (e) { /* no audio */ }
  }

  /* ---------- events (delegated, so re-rendering never loses them) ---------- */
  function onClick(e) {
    var b = e.target.closest('[data-cd]'); if (!b || b.tagName === 'INPUT') return;
    var a = b.getAttribute('data-cd');
    if (a === 'start') {
      var sel = b.parentNode.querySelector('.cd-mins');
      start(sel ? Number(sel.value) : st.mins);
    } else if (a === 'pause') pause();
    else if (a === 'resume') resume();
    else if (a === 'add') add(1);
    else if (a === 'stop') stop();
  }
  function onChange(e) {
    if (e.target.getAttribute('data-cd') === 'auto') { st.auto = e.target.checked; save(); render(true); }
    else if (e.target.classList.contains('cd-mins')) { st.mins = Number(e.target.value); save(); }
  }

  function init(h) {
    host = h;
    [$('timer'), $('arTimerCtl')].forEach(function (el) {
      if (!el) return;
      el.addEventListener('click', onClick);
      el.addEventListener('change', onChange);
    });
    tick = setInterval(loop, 250);
    render(true);
  }

  return { init: init, update: update, start: start, stop: stop, state: state, remainingMs: remaining };
})();
