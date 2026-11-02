/* Breaking News Dice — game engine.
   Runs inside Google Apps Script (copied into apps-script/Code.gs by
   tools/build.js) and, unchanged, in the browser for Demo mode, where
   js/mock-gas.js stands in for SpreadsheetApp, LockService and CacheService.
   Needs globals from words.js, check.js and a settings file (TEACHER_PIN, SHEET_ID). */

var BND_DESK_NAMES = ['Chao Phraya Chronicle', 'Klong Courier', 'Monsoon Mail', 'Riverside Report',
  'Soi Sentinel', 'Dusit Dispatch', 'Thonburi Times', 'Bang Na Bulletin', 'Silom Standard',
  'Pratunam Post', 'Ari Herald', 'Rama IV Record', 'Lumpini Ledger', 'Rangsit Wire', 'Nonthaburi News',
  'Ayutthaya Advertiser'];
var BND_TEAM_COUNT = 15;         // team numbers 1–15 on the student screen
var BND_MAX_ROUNDS = 20;         // rounds are open-ended: faster students simply play more of them
var BND_CACHE_KEY = 'bnd-store-v3';
var BND_CACHE_TTL = 1800;       // seconds; every write refreshes the cache, so it is only a fallback expiry
var BND_CACHE_RECHECK = 120000; // ms: under the lock, re-read the sheet when the cached copy is older than this

/* ---------- storage: one "Store" sheet of key | json | updated ----------
   Performance (2 Nov 2026): with 23 students the Sheet is the bottleneck, so the script cache holds a
   versioned copy of the whole store. Every write happens under the script lock and refreshes the cache,
   so the cache is authoritative while it exists: reads (student polls, the teacher board) never touch
   the Sheet, and a write touches exactly one row. A stale-looking cache (older than BND_CACHE_RECHECK)
   is re-read from the Sheet once, under the lock, as insurance against manual edits. */
/* SHEET_ID (in Roster.gs) points a standalone script at its Sheet; a script bound to the Sheet needs none. */
function bndSS_() {
  return (typeof SHEET_ID !== 'undefined' && SHEET_ID) ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}
var BND_SHEET_ = null;
function bndSheet_() {
  if (BND_SHEET_) return BND_SHEET_;
  var ss = bndSS_();
  var sh = ss.getSheetByName('Store');
  if (!sh) {
    sh = ss.insertSheet('Store');
    sh.getRange(1, 1, 1, 3).setValues([['key', 'json', 'updated']]);
  }
  BND_SHEET_ = sh;
  return sh;
}

function bndReadSheet_() {
  var vals = bndSheet_().getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < vals.length; i++) if (vals[i][0]) rows.push([String(vals[i][0]), String(vals[i][1])]);
  rows.lastRow = vals.length;   // the sheet's real last row (header included), for appends
  return rows;
}

/* useCache: read the cached copy when there is one. maxAge (ms, optional): treat a cached copy older than
   this as a miss. locked: the caller holds the script lock. Only a lock holder may refill the cache from the
   Sheet (an unlocked reader that did so could overwrite a fresher copy a moment later), so an unlocked reader
   that misses tries for the lock without waiting and otherwise just reads the Sheet.
   Returns db = { map, order, rowOf, cached, born }. */
function bndRead_(useCache, maxAge, locked) {
  var got = useCache ? bndCacheGet_() : null;
  var rows, born = 0, cached = false, lastRow = 0;
  if (got && (!maxAge || Date.now() - got.born < maxAge)) { rows = got.rows; born = got.born; cached = true; lastRow = got.lastRow; }
  else {
    var lock = null;
    if (!locked) { try { lock = LockService.getScriptLock(); if (!lock.tryLock(300)) lock = null; } catch (e) { lock = null; } }
    try {
      rows = bndReadSheet_();
      born = Date.now();
      lastRow = rows.lastRow;
      if (lock) bndCachePut_(rows, born, lastRow);   // a locked caller's flush puts it (dirty) once, below
    } finally { if (lock) lock.releaseLock(); }
  }
  var db = { map: {}, order: [], rowOf: {}, cached: cached, born: born, lastRow: Math.max(lastRow || 0, rows.length + 1), dirty: !cached && !!locked };
  rows.forEach(function (r, i) { db.map[r[0]] = JSON.parse(r[1]); db.order.push(r[0]); db.rowOf[r[0]] = i + 2; });
  return db;
}

/* The cache holds 100 KB per key, so the store is kept in chunks. Each put uses a fresh version id in the
   chunk keys, and the index names that version, so a reader can never stitch chunks from two different puts. */
function bndCachePut_(rows, born, lastRow) {
  var cache = null, oldIx = null;
  try {
    cache = CacheService.getScriptCache();
    try { oldIx = JSON.parse(cache.get(BND_CACHE_KEY) || 'null'); } catch (e0) { oldIx = null; }
    var ver = String(born || Date.now()) + '-' + Math.floor(Math.random() * 1e6);
    // 100 KB per value is measured in bytes: Thai text is 3 bytes a character, so chunk at 30 000 characters
    var str = JSON.stringify(rows), size = 30000, parts = {}, n = 0, at = 0;
    while (at < str.length || n === 0) {
      var end = Math.min(str.length, at + size);
      var c = str.charCodeAt(end - 1);
      if (end < str.length && c >= 0xD800 && c <= 0xDBFF) end--;   // never split an emoji's surrogate pair
      parts[BND_CACHE_KEY + ':' + ver + ':' + n] = str.slice(at, end);
      at = end; n++;
    }
    parts[BND_CACHE_KEY] = JSON.stringify({ n: n, ver: ver, born: born || Date.now(), lastRow: lastRow || (rows.length + 1) });
    cache.putAll(parts, BND_CACHE_TTL);
    // drop the previous version's chunks so the shared cache is not filled with dead copies
    if (oldIx && oldIx.ver && oldIx.ver !== ver && oldIx.n) {
      var dead = [];
      for (var j = 0; j < oldIx.n; j++) dead.push(BND_CACHE_KEY + ':' + oldIx.ver + ':' + j);
      try { cache.removeAll(dead); } catch (e3) { /* ignore */ }
    }
  } catch (e) {
    // a failed put must not leave an old copy in place
    try { if (typeof console !== 'undefined') console.error('bndCachePut_ failed: ' + e); } catch (e1) { /* ignore */ }
    try { (cache || CacheService.getScriptCache()).remove(BND_CACHE_KEY); } catch (e2) { /* ignore */ }
  }
}
function bndCacheGet_() {
  try {
    var cache = CacheService.getScriptCache();
    var ix = cache.get(BND_CACHE_KEY);
    if (!ix) return null;
    ix = JSON.parse(ix);
    if (!ix || !ix.n || !ix.ver) return null;
    var keys = [];
    for (var i = 0; i < ix.n; i++) keys.push(BND_CACHE_KEY + ':' + ix.ver + ':' + i);
    var got = cache.getAll(keys), str = '';
    for (i = 0; i < ix.n; i++) { if (got[keys[i]] === undefined || got[keys[i]] === null) return null; str += got[keys[i]]; }
    var rows = JSON.parse(str);
    if (!rows || (!rows.length && ix.n > 1)) return null;
    return { rows: rows, born: Number(ix.born) || 0, lastRow: Number(ix.lastRow) || (rows.length + 1) };
  } catch (e) { return null; }
}
function bndCacheDrop_() {
  try { CacheService.getScriptCache().remove(BND_CACHE_KEY); } catch (e) { /* ignore */ }
}

/* One row per write. A new key goes on the row after the last known one (writes are serialised by the lock,
   so the in-memory order matches the sheet); getLastRow() is checked only if the two disagree. */
function bndWrite_(db, key, obj) {
  var sh = bndSheet_();
  var row = [key, JSON.stringify(obj), new Date().toISOString()];
  if (db.rowOf[key]) sh.getRange(db.rowOf[key], 1, 1, 3).setValues([row]);
  else {
    var r = Math.max(db.order.length + 2, (db.lastRow || 0) + 1);
    sh.getRange(r, 1, 1, 3).setValues([row]);
    db.order.push(key); db.rowOf[key] = r; db.lastRow = r;
  }
  db.map[key] = obj;
  db.dirty = true;
}

function bndFlushCache_(db) {
  if (!db.dirty) return;
  bndCachePut_(db.order.map(function (k) { return [k, JSON.stringify(db.map[k])]; }), Date.now(), db.lastRow);
}

function bndWithLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'The game is busy. Try again in a moment.', busy: true };
  var db = null;
  try {
    db = bndRead_(true, BND_CACHE_RECHECK, true);
    var out = fn(db);
    SpreadsheetApp.flush();   // the rows must be in the Sheet before the next lock holder can read it
    bndFlushCache_(db);
    return out;
  } catch (e) {
    // the Sheet may now be ahead of the cache: make the next lock holder rebuild from the Sheet
    if (db && db.dirty) { try { SpreadsheetApp.flush(); } catch (e1) { /* ignore */ } bndCacheDrop_(); }
    throw e;
  } finally { lock.releaseLock(); }
}

/* ---------- web app entry points ---------- */
function doGet(e) {
  var q = (e && e.parameter && e.parameter.q) ? JSON.parse(e.parameter.q) : { action: 'ping' };
  return bndOut_(bndHandle(q));
}
function doPost(e) {
  var q = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  return bndOut_(bndHandle(q));
}
function bndOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function bndHandle(req) {
  try {
    var a = req.action;
    if (a === 'ping') return { ok: true, now: Date.now() };
    if (a === 'roster') return { ok: true, roster: bndRosterPublic_() };
    if (a === 'state') return bndStudentState_(req);
    if (a === 'join') return bndJoin_(req);
    if (a === 'roll') return bndRoll_(req);
    if (a === 'save') return bndSave_(req);
    if (a === 'check') return bndCheck_(req);
    // teacher actions
    if (typeof TEACHER_PIN !== 'undefined' && TEACHER_PIN && String(req.pin || '') !== String(TEACHER_PIN)) {
      return { ok: false, error: 'pin' };
    }
    if (a === 'tstate') return bndTeacherState_(bndRead_(true));
    if (a === 'newSession') return bndNewSession_(req);
    if (a === 'settings') return bndSettings_(req);
    if (a === 'release') return bndRelease_(req);
    if (a === 'finish') return bndFinish_(req);
    if (a === 'front') return bndFront_(req);
    if (a === 'spike') return bndSpike_(req);
    if (a === 'export') return bndExport_();
    return { ok: false, error: 'unknown action ' + a };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

/* ---------- roster (Roster.gs): students sign in by tapping their name ---------- */
/* Three guest seats (visitors, new students, a spare iPad), always after the class list. */
var BND_GUESTS = [{ sid: 'g1', name: 'Guest#1' }, { sid: 'g2', name: 'Guest#2' }, { sid: 'g3', name: 'Guest#3' }];
function bndIsGuest_(sid) { return /^g\d+$/.test(String(sid)); }
function bndRoster_() {
  var r = (typeof ROSTER !== 'undefined' && ROSTER) ? ROSTER : [];
  var have = {};
  r.forEach(function (s) { have[String(s.sid)] = 1; });
  return r.concat(BND_GUESTS.filter(function (g) { return !have[g.sid]; }));
}
function bndRosterPublic_() {
  var r = bndRoster_();
  var counts = {};
  r.forEach(function (s) { counts[s.name] = (counts[s.name] || 0) + 1; });
  return r.map(function (s) {
    return { sid: String(s.sid), name: s.name, label: counts[s.name] > 1 ? s.name + ' (No. ' + s.sid + ')' : s.name };
  }).sort(function (x, y) {
    var gx = bndIsGuest_(x.sid), gy = bndIsGuest_(y.sid);
    return gx !== gy ? (gx ? 1 : -1) : x.label.localeCompare(y.label);
  });
}
var BND_LABELS_ = null;
function bndLabel_(sid) {
  if (!BND_LABELS_) { BND_LABELS_ = {}; bndRosterPublic_().forEach(function (r) { BND_LABELS_[r.sid] = r.label; }); }
  return BND_LABELS_[String(sid)] || ('No. ' + sid);
}

/* ---------- session ----------
   phase: 'open' while students play (each at her own speed), 'final' after Finish game.
   Each player: round 1, 2, 3 … and stage 'write' (roll + write + file) → 'check' (fact-check one post) → next round. */
function bndBlankSession_(settings) {
  settings = settings || {};
  return {
    id: 'S' + Date.now(), created: Date.now(), phase: 'open',
    maxRounds: settings.maxRounds || BND_MAX_ROUNDS,
    requirePassive: settings.requirePassive === undefined ? true : !!settings.requirePassive,
    front: {}, spiked: {}
  };
}
function bndSession_(db) { return db.map.session || null; }

function bndNewSession_(req) {
  return bndWithLock_(function (db) {
    var sh = bndSheet_();
    var real = db.cached ? bndRead_(false, 0, true) : db;   // archive what is really in the Sheet
    var old = bndSession_(real) || bndSession_(db);
    if (old && real.order.length) {
      var ss = bndSS_();
      var ar = ss.getSheetByName('Archive') || ss.insertSheet('Archive');
      var rows = real.order.map(function (k) { return [old.id, k, JSON.stringify(real.map[k]), new Date().toISOString()]; });
      ar.getRange(ar.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
    }
    sh.clearContents();
    sh.getRange(1, 1, 1, 3).setValues([['key', 'json', 'updated']]);
    db.map = {}; db.order = []; db.rowOf = {}; db.cached = true; db.lastRow = 1; db.dirty = true;
    bndWrite_(db, 'session', bndBlankSession_(req.settings));
    return bndTeacherState_(db);
  });
}

function bndSettings_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (!s) return { ok: false, error: 'no session' };
    if (req.maxRounds) s.maxRounds = Math.max(1, Math.min(BND_MAX_ROUNDS, Number(req.maxRounds)));
    if (req.requirePassive !== undefined) s.requirePassive = !!req.requirePassive;
    bndWrite_(db, 'session', s);
    return bndTeacherState_(db);
  });
}

function bndPostKey_(round, sid) { return 'post:' + round + ':' + sid; }
/* Each student's progress is her own row ('player:<sid>'), so students never overwrite each other. */
function bndPlayerKey_(sid) { return 'player:' + sid; }
function bndPlayer_(db, sid) { return db.map[bndPlayerKey_(sid)] || null; }
function bndPlayerIds_(db) { return db.order.filter(function (k) { return k.indexOf('player:') === 0; }).map(function (k) { return k.slice(7); }); }
function bndCheckKey_(round, sid) { return 'check:' + round + ':' + sid; }

/* The filing rule: every checklist item must be met. */
function bndCriteria_(a, s) {
  var miss = [];
  if (!a.used[0] || !a.used[1]) miss.push('use both dice words');
  if (!a.inRange) miss.push('write at least ' + BND_RULES.minWords + ' words');
  if (s.requirePassive && !a.passive) miss.push('include a passive');
  if (a.traps.length) miss.push('fix the passive error');
  return miss;
}

/* ---------- student actions ---------- */
function bndJoin_(req) {
  var sid = String(req.sid || '');
  if (!bndRoster_().some(function (r) { return String(r.sid) === sid; })) return { ok: false, error: 'Unknown name.' };
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (!s) return { ok: false, error: 'The game has not started yet. Wait for T.Chris.' };
    if (s.phase === 'final') return { ok: false, error: 'This game has finished.' };
    var p = bndPlayer_(db, sid);
    if (p && p.device && req.device && p.device !== req.device) {
      return { ok: false, error: 'This name is already signed in on another device. Ask T.Chris to release it.' };
    }
    if (!p) p = { sid: sid, joined: Date.now(), round: 1, stage: 'write', words: null, task: null };
    p.device = req.device || p.device || '';
    bndWrite_(db, bndPlayerKey_(sid), p);
    return bndStudentView_(db, sid);
  });
}

function bndRoll_(req) {
  var sid = String(req.sid || '');
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    var p = s && bndPlayer_(db, sid);
    if (!p || s.phase !== 'open' || p.stage !== 'write') return { ok: false, error: 'You can roll at the start of a round.' };
    if (!p.words) {
      p.words = bndPickWords_(db, sid);
      bndWrite_(db, bndPlayerKey_(sid), p);
    }
    return bndStudentView_(db, sid);
  });
}

/* Two words she has not had yet (repeats only after all 15), favouring words the class has drawn least. */
function bndPickWords_(db, sid) {
  var had = {}, overall = {};
  db.order.forEach(function (k) {
    if (k.indexOf('post:') !== 0) return;
    var p = db.map[k];
    p.words.forEach(function (w) {
      overall[w] = (overall[w] || 0) + 1;
      if (p.sid === sid) had[w] = (had[w] || 0) + 1;
    });
  });
  var ids = BND_WORDS.map(function (w) { return w.id; });
  var tie = {};
  ids.forEach(function (id) { tie[id] = Math.random(); });
  ids.sort(function (a, b) {
    return ((had[a] || 0) - (had[b] || 0)) || ((overall[a] || 0) - (overall[b] || 0)) || (tie[a] - tie[b]);
  });
  return [ids[0], ids[1]];
}

function bndSave_(req) {
  var sid = String(req.sid || '');
  var text = String(req.text || '').slice(0, 2000);
  return bndWithLock_(function (db) {
    var r = bndSaveIn_(db, sid, text, !!req.filed);
    if (!r.ok) { var v = bndStudentView_(db, sid); v.ok = false; v.error = r.error; v.missing = r.missing; return v; }
    return bndStudentView_(db, sid);
  });
}

function bndSaveIn_(db, sid, text, filed) {
  var s = bndSession_(db);
  var p = s && bndPlayer_(db, sid);
  if (!p || s.phase !== 'open') return { ok: false, error: 'No game running.' };
  if (p.stage !== 'write') return { ok: false, error: 'You have already filed this round.' };
  var words = p.words;
  if (!words) return { ok: false, error: 'Roll the dice first.' };
  var an = null;
  if (filed) {
    var a0 = bndAnalyse(text, words);
    var miss = bndCriteria_(a0, s);
    if (miss.length) return { ok: false, error: 'Not yet: ' + miss.join(', ') + '.', missing: miss };
    an = bndTrimAnalysis_(a0);
  }
  var key = bndPostKey_(p.round, sid);
  var old = db.map[key];
  if (!(old && old.text === text && !filed)) {
    var post = { sid: sid, round: p.round, words: words, text: text, filed: filed, at: Date.now() };
    if (an) post.an = an;   // scored once at filing; bndScores_ never re-analyses a filed post
    bndWrite_(db, key, post);
  }
  if (filed) {
    p.stage = 'check';
    p.task = bndPickCheck_(db, s, sid);
    bndWrite_(db, bndPlayerKey_(sid), p);
  }
  return { ok: true };
}

/* Fact-check: another student's filed post — least-checked first, newest preferred, never her own.
   If nobody else has filed yet, a practice post from the sample bank. */
function bndPickCheck_(db, s, sid) {
  var seen = {}, counts = {};
  db.order.forEach(function (k) {
    if (k.indexOf('check:') !== 0) return;
    var c = db.map[k];
    counts[c.post] = (counts[c.post] || 0) + 1;
    if (c.sid === sid) seen[c.post] = 1;
  });
  var best = null, bestScore = null;
  db.order.forEach(function (k) {
    if (k.indexOf('post:') !== 0) return;
    var p = db.map[k];
    if (!p.filed || p.sid === sid || seen[k] || s.spiked[k]) return;
    var score = [counts[k] || 0, -p.at];
    if (!bestScore || score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) { best = k; bestScore = score; }
  });
  if (best) return best;
  var ids = BND_WORDS.map(function (w) { return w.id; });
  var i = Math.floor(Math.random() * ids.length), j = (i + 1 + Math.floor(Math.random() * (ids.length - 1))) % ids.length;
  return 'sample:' + ids[i] + ':' + ids[j] + ':' + Math.floor(Math.random() * 2) + Math.floor(Math.random() * 2);
}

function bndSamplePost_(key) {
  var bits = key.split(':');
  var a = BND_SAMPLE_LINES[bits[1]], b = BND_SAMPLE_LINES[bits[2]], ix = bits[3] || '00';
  return { text: a[Number(ix[0])] + ' ' + b[Number(ix[1])], words: [bits[1], bits[2]] };
}

function bndCheck_(req) {
  var sid = String(req.sid || '');
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    var p = s && bndPlayer_(db, sid);
    if (!p || s.phase !== 'open' || p.stage !== 'check') return { ok: false, error: 'There is nothing to fact-check right now.' };
    var task = p.task || bndPickCheck_(db, s, sid);
    var ok = (req.ok || []).map(function (v) { return !!v; });
    var stars = Math.max(1, Math.min(3, Number(req.stars) || 2));
    bndWrite_(db, bndCheckKey_(p.round, sid), { sid: sid, round: p.round, post: task, ok: ok, stars: stars, at: Date.now() });
    // straight on to the next round
    p.task = null; p.words = null;
    if (p.round >= s.maxRounds) p.stage = 'done'; else { p.round += 1; p.stage = 'write'; }
    bndWrite_(db, bndPlayerKey_(sid), p);
    return bndStudentView_(db, sid);
  });
}

/* ---------- teacher actions ---------- */
function bndRelease_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    var p = bndPlayer_(db, String(req.sid));
    if (p) { p.device = ''; bndWrite_(db, bndPlayerKey_(String(req.sid)), p); }
    return bndTeacherState_(db);
  });
}

function bndFinish_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (s && s.phase === 'open') { s.phase = 'final'; bndWrite_(db, 'session', s); }
    return bndTeacherState_(db);
  });
}

function bndFront_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (s && db.map[req.key]) {
      if (s.front[req.key]) delete s.front[req.key]; else s.front[req.key] = Date.now();
      bndWrite_(db, 'session', s);
    }
    return bndTeacherState_(db);
  });
}

function bndSpike_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (s && db.map[req.key]) {
      if (s.spiked[req.key]) delete s.spiked[req.key]; else s.spiked[req.key] = true;
      bndWrite_(db, 'session', s);
    }
    return bndTeacherState_(db);
  });
}

function bndExport_() {
  var db = bndRead_(false);
  var sc = bndScores_(db);
  var rows = [['Student', 'Round', 'Word 1', 'Word 2', 'Post', 'Words', 'Passive', 'Auto', 'Peer', 'Stars', 'Front page', 'Score']];
  Object.keys(sc.posts).forEach(function (k) {
    var p = db.map[k], b = sc.posts[k];
    rows.push([bndLabel_(p.sid), p.round, p.words[0], p.words[1], p.text, b.count,
      b.passive ? 'yes' : 'no', b.autoPts, b.peerPts, b.stars, b.front ? 'yes' : '', b.total]);
  });
  rows.push([]);
  rows.push(['Student', 'Rounds filed', 'Fact-checks', 'Total', 'Rank']);
  sc.players.forEach(function (p) { rows.push([p.label, p.filed, p.checks, p.total, p.rank]); });
  return { ok: true, rows: rows };
}

/* The part of bndAnalyse a filed post needs for scoring, stored on the post so the board never re-analyses. */
function bndTrimAnalysis_(a) {
  return { used: a.used, count: a.count, inRange: a.inRange, passive: a.passive, traps: a.traps.length, autoPts: a.autoPts };
}

/* ---------- scoring ----------
   Points for a filed post count at once; fact-check points arrive as other students check it;
   at Finish game, filed posts nobody checked get the benefit of the doubt. Each fact-check sent earns +1. */
function bndScores_(db) {
  var s = bndSession_(db);
  var R = BND_RULES;
  var final = s.phase === 'final';
  var checksByPost = {}, checkPts = {}, checkCount = {};
  db.order.forEach(function (k) {
    if (k.indexOf('check:') !== 0) return;
    var c = db.map[k];
    (checksByPost[c.post] = checksByPost[c.post] || []).push(c);
    checkPts[c.sid] = (checkPts[c.sid] || 0) + R.ptsCheck;
    checkCount[c.sid] = (checkCount[c.sid] || 0) + 1;
  });
  var posts = {}, ptsBy = {}, filedBy = {};
  db.order.forEach(function (k) {
    if (k.indexOf('post:') !== 0) return;
    var p = db.map[k];
    if (!p.filed) return;
    var a = p.an || bndTrimAnalysis_(bndAnalyse(p.text, p.words));   // posts filed before Nov 2026 carry no `an`
    var checks = checksByPost[k] || [];
    var peer = 0, stars = 0;
    if (checks.length) {
      a.used.forEach(function (u, i) {
        if (!u) return;
        var yes = checks.filter(function (c) { return c.ok[i]; }).length;
        if (yes * 2 >= checks.length) peer += R.ptsPeerWord;
      });
      stars = Math.round(checks.reduce(function (t, c) { return t + c.stars; }, 0) / checks.length);
    } else if (final) {
      peer = a.used.filter(Boolean).length * R.ptsPeerWord;
      stars = 2;
    }
    var front = !!s.front[k], spiked = !!s.spiked[k];
    var total = spiked ? 0 : a.autoPts + peer + stars + (front ? R.ptsFront : 0);
    posts[k] = { autoPts: a.autoPts, peerPts: peer, stars: stars, front: front, spiked: spiked, total: total,
      count: a.count, inRange: a.inRange, passive: a.passive, used: a.used, traps: a.traps, checks: checks.length };
    ptsBy[p.sid] = (ptsBy[p.sid] || 0) + total;
    filedBy[p.sid] = (filedBy[p.sid] || 0) + 1;
  });
  var players = bndPlayerIds_(db).map(function (sid) {
    var pl = bndPlayer_(db, sid);
    return { sid: sid, label: bndLabel_(sid), total: (ptsBy[sid] || 0) + (checkPts[sid] || 0), filed: filedBy[sid] || 0,
      checks: checkCount[sid] || 0, round: pl.round, stage: pl.stage, locked: !!pl.device };
  });
  var sorted = players.slice().sort(function (a, b) { return b.total - a.total; });
  players.forEach(function (p) { p.rank = 1 + sorted.filter(function (x) { return x.total > p.total; }).length; });
  return { posts: posts, players: players };
}

/* ---------- views ---------- */
function bndPublicSession_(s) {
  return { id: s.id, phase: s.phase, maxRounds: s.maxRounds, requirePassive: s.requirePassive };
}

/* Drafts (2 Nov 2026): a student's unfiled text lives in its own cache key for 6 h — no lock, no Sheet row —
   so a draft sync costs the same as a plain poll. The browser keeps its own copy too; this one is for a student
   who continues on another device. Filing writes the post row as before. */
function bndDraftKey_(sid) { return 'bnd-draft:' + sid; }
function bndDraftPut_(sid, round, words, text) {
  try { CacheService.getScriptCache().put(bndDraftKey_(sid), JSON.stringify({ round: round, words: words, text: text }), 21600); } catch (e) { /* ignore */ }
}
function bndDraftGet_(sid, round) {
  try {
    var d = JSON.parse(CacheService.getScriptCache().get(bndDraftKey_(sid)) || 'null');
    return d && d.round === round ? d.text : '';
  } catch (e) { return ''; }
}
function bndStudentState_(req) {
  var sid = String(req.sid || '');
  var db = bndRead_(true);
  if (req.draft !== undefined && req.draft !== null) {
    var p0 = bndPlayer_(db, sid);
    if (p0 && p0.stage === 'write' && p0.words) bndDraftPut_(sid, p0.round, p0.words, String(req.draft).slice(0, 2000));
  }
  return bndStudentView_(db, sid);
}

function bndStudentView_(db, sid) {
  var s = bndSession_(db);
  var out = { ok: true, now: Date.now(), session: s ? bndPublicSession_(s) : null };
  if (!s) return out;
  var p = bndPlayer_(db, sid);
  out.joined = !!p;
  out.me = { sid: sid, label: bndLabel_(sid) };
  if (!p) return out;
  var sc = bndScores_(db);
  var me = sc.players.filter(function (x) { return x.sid === sid; })[0];
  out.me.total = me.total; out.me.rank = me.rank; out.me.filed = me.filed; out.me.checks = me.checks;
  out.playerCount = sc.players.length;
  out.round = p.round; out.stage = p.stage;
  out.words = p.words || null;
  var mine = db.map[bndPostKey_(p.round, sid)];
  out.draft = mine && !mine.filed ? mine.text : (p.stage === 'write' && p.words ? bndDraftGet_(sid, p.round) : '');
  // her latest filed post and its score so far
  for (var r = p.round; r >= 1; r--) {
    var k = bndPostKey_(r, sid);
    if (db.map[k] && db.map[k].filed) { out.lastPost = { round: r, text: db.map[k].text, words: db.map[k].words, score: sc.posts[k] }; break; }
  }
  if (p.stage === 'check') {
    var tk = p.task;
    if (tk) {
      var post = tk.indexOf('sample:') === 0 ? bndSamplePost_(tk) : db.map[tk];
      out.task = { key: tk, text: post.text, words: post.words, sample: tk.indexOf('sample:') === 0 };
    }
  }
  out.front = bndFrontList_(db, s);
  return out;
}

function bndFrontList_(db, s) {
  return Object.keys(s.front).map(function (k) {
    var p = db.map[k];
    if (!p) return null;
    return { at: s.front[k], round: p.round, key: k, text: p.text, words: p.words, author: bndLabel_(p.sid) };
  }).filter(Boolean).sort(function (a, b) { return a.at - b.at; });
}

function bndTeacherState_(db) {
  var s = bndSession_(db);
  var out = { ok: true, now: Date.now(), session: s ? bndPublicSession_(s) : null, roster: bndRosterPublic_() };
  if (!s) return out;
  var sc = bndScores_(db);
  out.players = sc.players;
  out.posts = Object.keys(sc.posts).map(function (k) {
    var p = db.map[k];
    return { key: k, round: p.round, sid: p.sid, author: bndLabel_(p.sid), words: p.words, text: p.text, at: p.at, score: sc.posts[k] };
  });
  var c = { players: sc.players.length, filed: out.posts.length, checks: 0, writing: 0, checking: 0, done: 0 };
  db.order.forEach(function (k) { if (k.indexOf('check:') === 0) c.checks++; });
  sc.players.forEach(function (p) { if (p.stage === 'write') c.writing++; else if (p.stage === 'check') c.checking++; else c.done++; });
  out.counts = c;
  out.front = bndFrontList_(db, s);
  return out;
}
