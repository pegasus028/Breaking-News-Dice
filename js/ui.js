/* Shared browser helpers: API calls (live Apps Script or in-browser demo),
   server clock, escaping and word highlighting. */
var BND_LIVE = !!(window.BND_API_URL && /^https:\/\//.test(window.BND_API_URL));
var bndClockOffset = 0;

var BND_API_TIMEOUT = 25000;   // ms; a hung request must not block the next poll for ever
function bndFetchJson(req) {
  var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
  var opts = { method: 'POST', body: JSON.stringify(req), redirect: 'follow' };
  if (ctrl) opts.signal = ctrl.signal;
  var tm = null;
  // text/plain body = no CORS preflight; Apps Script answers with JSON
  var req1 = fetch(window.BND_API_URL, opts)
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  // a timer that always settles the promise, even on browsers with no AbortController (old iPads)
  var timer = new Promise(function (res, rej) { tm = setTimeout(function () { if (ctrl) ctrl.abort(); rej(new Error('timeout')); }, BND_API_TIMEOUT); });
  return Promise.race([req1, timer])
    .then(function (out) { clearTimeout(tm); return out; }, function (e) { clearTimeout(tm); throw e; });
}
function bndApi(req, tries) {
  var p;
  if (BND_LIVE) {
    p = bndFetchJson(req).then(function (out) {
      // the server could not get its lock in time: one more try after a short pause, then give up
      if (out && out.busy && req.action !== 'state' && req.action !== 'tstate' && (tries || 0) < 2) {
        return new Promise(function (res) { setTimeout(res, 1500 + Math.random() * 1500); }).then(function () { return bndApi(req, (tries || 0) + 1); });
      }
      return out;
    });
  } else {
    p = new Promise(function (res) {
      setTimeout(function () { res(JSON.parse(JSON.stringify(bndHandle(req)))); }, 40);
    });
  }
  return p.then(function (out) {
    if (out && out.now) bndClockOffset = out.now - Date.now();
    return out;
  });
}

function bndNow() { return Date.now() + bndClockOffset; }

function bndSecsLeft(session) {
  if (!session || !session.phaseEnds) return null;
  return Math.max(0, Math.ceil((session.phaseEnds - bndNow()) / 1000));
}
function bndClock(secs) {
  if (secs === null || secs === undefined) return '';
  var m = Math.floor(secs / 60), s = secs % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function bndEsc(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* Escape a post and underline the dice words in it. */
function bndHighlight(text, ids) {
  text = String(text || '');
  var spans = bndFindSpans(text, ids), out = '', at = 0;
  spans.forEach(function (sp) {
    if (sp.start < at) return;
    out += bndEsc(text.slice(at, sp.start)) + '<mark class="w">' + bndEsc(text.slice(sp.start, sp.end)) + '</mark>';
    at = sp.end;
  });
  return out + bndEsc(text.slice(at));
}

function bndWordName(id) { return (BND_WORD_BY_ID[id] || { word: id }).word; }

function bndDevice() {
  var k = 'bnd-device';
  var d = null;
  try { d = localStorage.getItem(k); } catch (e) { /* private mode */ }
  if (!d) {
    d = 'dev-' + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(k, d); } catch (e) { /* ignore */ }
  }
  return d;
}

function bndStore(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k);
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  } catch (e) { return null; }
  return v;
}

var BND_PHASE_LABEL = { lobby: 'Checking in', paired: 'Desks ready', write: 'Writing', verify: 'Fact-check',
  reveal: 'Results', final: 'Final scores' };
