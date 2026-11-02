/* Demo mode only: tiny stand-ins for the Apps Script services server.js uses.
   Data lives in localStorage, so the student and teacher consoles open in
   the same browser (tabs or the side-by-side demo page) share one game.
   In Node (tools/sim.js) it falls back to memory. */
(function (g) {
  var KEY = 'bnd-demo-db-v1';
  var mem = null;
  function load() {
    try { if (g.localStorage) return JSON.parse(g.localStorage.getItem(KEY) || '{}'); } catch (e) { /* fall through */ }
    return mem || {};
  }
  function save(d) {
    try { if (g.localStorage) { g.localStorage.setItem(KEY, JSON.stringify(d)); return; } } catch (e) { /* fall through */ }
    mem = d;
  }
  function sheet(name) {
    function rows() { return load()[name] || []; }
    function put(r) { var d = load(); d[name] = r; save(d); }
    return {
      getDataRange: function () { return { getValues: function () { return rows().map(function (x) { return x.slice(); }); } }; },
      getLastRow: function () { return rows().length; },
      appendRow: function (row) { var r = rows(); r.push(row.slice()); put(r); },
      clearContents: function () { put([]); },
      getRange: function (r0, c0, nr, nc) {
        return {
          setValues: function (vals) {
            var r = rows();
            for (var i = 0; i < nr; i++) {
              r[r0 - 1 + i] = r[r0 - 1 + i] || [];
              for (var j = 0; j < nc; j++) r[r0 - 1 + i][c0 - 1 + j] = vals[i][j];
            }
            put(r);
          },
          getValues: function () {
            var r = rows(), out = [];
            for (var i = 0; i < nr; i++) {
              var row = [];
              for (var j = 0; j < nc; j++) row.push(((r[r0 - 1 + i] || [])[c0 - 1 + j]) || '');
              out.push(row);
            }
            return out;
          }
        };
      }
    };
  }
  g.SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return {
        getSheetByName: function (n) { return load()[n] ? sheet(n) : null; },
        insertSheet: function (n) { var d = load(); d[n] = d[n] || []; save(d); return sheet(n); }
      };
    }
  };
  g.LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };
  g.CacheService = { getScriptCache: function () { return { get: function () { return null; }, put: function () {} }; } };
  g.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: function (t) { return { setMimeType: function () { return t; } }; } };
  g.bndDemoReset = function () { save({}); };
})(typeof window !== 'undefined' ? window : globalThis);
