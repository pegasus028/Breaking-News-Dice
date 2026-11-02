/* Demo mode only: tiny stand-ins for the Apps Script services server.js uses.
   Each sheet row is its own localStorage entry, so the student page and the teacher board
   (tabs or the side-by-side demo page) can write at the same time without losing each
   other's rows. In Node (tools/sim.js) it falls back to memory. */
(function (g) {
  var P = 'bnd-demo2:';
  var mem = {};
  var ls = null;
  try { if (g.localStorage) { g.localStorage.setItem(P + 'probe', '1'); ls = g.localStorage; } } catch (e) { ls = null; }
  function get(k) { return ls ? ls.getItem(P + k) : (k in mem ? mem[k] : null); }
  function set(k, v) { if (ls) ls.setItem(P + k, v); else mem[k] = v; }
  function del(k) { if (ls) ls.removeItem(P + k); else delete mem[k]; }

  function sheet(name) {
    function n() { return Number(get(name + ':n') || 0); }
    function row(i) { var v = get(name + ':' + i); return v ? JSON.parse(v) : []; }
    function put(i, r) { set(name + ':' + i, JSON.stringify(r)); if (i >= n()) set(name + ':n', String(i + 1)); }
    return {
      getDataRange: function () {
        return { getValues: function () { var out = [], k = n(); for (var i = 0; i < k; i++) out.push(row(i)); return out; } };
      },
      getLastRow: function () { return n(); },
      appendRow: function (r) { put(n(), r.slice()); },
      clearContents: function () { var k = n(); for (var i = 0; i < k; i++) del(name + ':' + i); set(name + ':n', '0'); },
      getRange: function (r0, c0, nr, nc) {
        return {
          setValues: function (vals) {
            for (var i = 0; i < nr; i++) {
              var r = row(r0 - 1 + i);
              for (var j = 0; j < nc; j++) r[c0 - 1 + j] = vals[i][j];
              put(r0 - 1 + i, r);
            }
          },
          getValues: function () {
            var out = [];
            for (var i = 0; i < nr; i++) {
              var r = row(r0 - 1 + i), o = [];
              for (var j = 0; j < nc; j++) o.push(r[c0 - 1 + j] || '');
              out.push(o);
            }
            return out;
          }
        };
      }
    };
  }
  function exists(name) { return get(name + ':n') !== null; }
  g.SpreadsheetApp = {
    openById: function () { return g.SpreadsheetApp.getActiveSpreadsheet(); },
    getActiveSpreadsheet: function () {
      return {
        getSheetByName: function (nm) { return exists(nm) ? sheet(nm) : null; },
        insertSheet: function (nm) { if (!exists(nm)) set(nm + ':n', '0'); return sheet(nm); }
      };
    }
  };
  g.LockService = { getScriptLock: function () { return { waitLock: function () {}, tryLock: function () { return true; }, releaseLock: function () {} }; } };
  /* In Node (tools/sim.js) the cache is real, so the cache-first path is exercised. In a browser each tab has its
     own JS context but shares the localStorage sheet, so the cache is a no-op there and tabs always see each other. */
  var cacheMem = {};
  var cache = ls
    ? { get: function () { return null; }, put: function () {}, getAll: function () { return {}; }, putAll: function () {}, remove: function () {} }
    : { get: function (k) { return k in cacheMem ? cacheMem[k] : null; }, put: function (k, v) { cacheMem[k] = v; },
        getAll: function (ks) { var o = {}; ks.forEach(function (k) { if (k in cacheMem) o[k] = cacheMem[k]; }); return o; },
        putAll: function (m) { Object.keys(m).forEach(function (k) { cacheMem[k] = m[k]; }); }, remove: function (k) { delete cacheMem[k]; },
        removeAll: function (ks) { ks.forEach(function (k) { delete cacheMem[k]; }); } };
  /* In the browser demo the shared cache is a no-op, but a student's draft still needs somewhere to live between
     the student tab and the board: keep draft keys in localStorage. */
  if (ls) {
    cache.get = function (k) { return /^bnd-draft:/.test(k) ? get('cache:' + k) : null; };
    cache.put = function (k, v) { if (/^bnd-draft:/.test(k)) set('cache:' + k, v); };
  }
  g.CacheService = { getScriptCache: function () { return cache; } };
  g.SpreadsheetApp.flush = function () {};
  /* tools/sim.js can set g.BND_MOCK_BUSY (0–1) to make tryLock fail at random, to exercise the busy path. */
  g.LockService.getScriptLock = function () { return { waitLock: function () {}, tryLock: function () { return !(g.BND_MOCK_BUSY && Math.random() < g.BND_MOCK_BUSY); }, releaseLock: function () {} }; };
  g.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: function (t) { return { setMimeType: function () { return t; } }; } };
  g.bndDemoReset = function () {
    if (ls) { Object.keys(ls).forEach(function (k) { if (k.indexOf(P) === 0) ls.removeItem(k); }); } else mem = {};
  };
})(typeof window !== 'undefined' ? window : globalThis);
