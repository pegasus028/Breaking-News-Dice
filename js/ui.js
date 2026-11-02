/* Shared browser helpers: API calls (live Apps Script or in-browser demo),
   server clock, escaping and word highlighting. */
var BND_LIVE = !!(window.BND_API_URL && /^https:\/\//.test(window.BND_API_URL));
var bndClockOffset = 0;

function bndApi(req) {
  var p;
  if (BND_LIVE) {
    // text/plain body = no CORS preflight; Apps Script answers with JSON
    p = fetch(window.BND_API_URL, { method: 'POST', body: JSON.stringify(req), redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
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
