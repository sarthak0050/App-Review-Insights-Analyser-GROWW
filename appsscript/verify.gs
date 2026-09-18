function writeVerification(rows) {
  ensureTabs();
  clearSheet(CONFIG.TAB_NAMES.VERIFICATION);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.TAB_NAMES.VERIFICATION);
  rows.forEach(function(r) {
    sheet.appendRow([r.check, r.status, r.detail]);
  });
}

function scanPii(text) {
  var hits = [];
  PII_REGEXES.forEach(function(rule) {
    rule.re.lastIndex = 0;
    var m;
    while ((m = rule.re.exec(text)) !== null) {
      hits.push(m[0]);
    }
  });
  return hits;
}

function runVerification() {
  ensureTabs();
  var results = [];
  var ok = function(check, detail) { results.push({ check: check, status: 'PASS', detail: detail }); };
  var fail = function(check, detail) { results.push({ check: check, status: 'FAIL', detail: detail }); };
  var raw = getRawReviews();

  if (raw.length === 0) {
    fail('data loaded', 'RawReviews is empty');
    writeVerification(results);
    return results;
  }
  ok('data loaded', raw.length + ' reviews loaded, ' + Object.keys(raw[0]).join(','));

  var piiRaw = 0;
  raw.forEach(function(r) {
    piiRaw += scanPii(String(r.text || '') + ' ' + String(r.title || '')).length;
  });
  if (piiRaw) fail('PII sweep — RawReviews', piiRaw + ' possible hits in texts/titles');
  else ok('PII sweep — RawReviews', 'no PII regex hits in RawReviews');

  var themesUsed = {};
  raw.forEach(function(r) { themesUsed[r.theme] = (themesUsed[r.theme] || 0) + 1; });
  var legend = CONFIG.THEMES.map(function(t) { return t.name; });
  var legendNames = {};
  legend.forEach(function(n) { legendNames[n] = 1; });
  var bad = Object.keys(themesUsed).filter(function(t) { return !legendNames[t] && t !== 'Unclassified'; });
  if (bad.length) fail('theme legend', 'non-legend themes used: ' + bad.join(','));
  else ok('theme legend', Object.keys(themesUsed).length + ' themes used (Unclassified = explicit no-match bucket); ' + legend.length + ' allowed themes in legend');

  var themes = getThemesTab();
  var noteRow = getLastNote();
  var note = noteRow ? noteRow.note_text : '';
  if (note) {
    var wc = wordCount(note);
    if (wc > CONFIG.NOTE_WORD_LIMIT) fail('note word count', wc + ' words (limit ' + CONFIG.NOTE_WORD_LIMIT + ')');
    else ok('note word count', wc + ' words <= ' + CONFIG.NOTE_WORD_LIMIT);

    var piiNote = scanPii(note).length;
    if (piiNote) fail('PII sweep — note', piiNote + ' hits');
    else ok('PII sweep — note', 'no PII regex hits');

    if (String(note).indexOf('Signal basis:') === -1) fail('note disclosure', 'coverage disclosure line missing');
    else ok('note disclosure', 'coverage disclosure line present');

    if (/\.{2,}/.test(String(note))) fail('note punctuation', 'double/multiple periods found');
    else ok('note punctuation', 'no double periods');

    var quoteChecks = 0;
    var quoteFails = 0;
    var top = themes.filter(function(t) { return t.top_quote; });
    top.forEach(function(t) {
      var q = String(t.top_quote || '').trim();
      if (!q) return;
      var found = raw.some(function(r) {
        return String(r.text || '').indexOf(q) !== -1 || String(r.title || '').indexOf(q) !== -1;
      });
      quoteChecks++;
      if (!found) {
        quoteFails++;
        fail('quote exact-substring', t.theme + ' quote not found verbatim in any review');
      } else {
        ok('quote exact-substring', t.theme + ': "' + q.slice(0, 50) + '"');
      }
    });
    if (quoteChecks && !quoteFails) ok('quote coverage', 'all ' + quoteChecks + ' top-3 quotes verified verbatim');
  } else {
    fail('note generated', 'no NoteHistory row found to verify');
  }

  var stats = themeStats();
  var top3Expected = stats.stats.slice(0, 3);
  var recomputed = top3Expected.map(function(t) {
    return { theme: t.theme, score: Number(t.priority_score.toFixed(1)) };
  });
  var recomputedStr = JSON.stringify(recomputed);
  ok('priority recompute', 'top-3 by count×(6−avg): ' + recomputedStr);

  if (note) {
    var flip = themes.filter(function(t) {
      return t.top_quote && String(note).indexOf(String(t.top_quote).trim()) === -1;
    }).length;
    if (flip) fail('note contains quotes', flip + ' top-3 quotes missing from note text');
    else ok('note contains quotes', 'all top-3 quotes present in note');
  }

  writeVerification(results);
  return results;
}

function getLastNoteRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.TAB_NAMES.NOTE_HISTORY);
  if (!sheet) return 0;
  return sheet.getLastRow();
}

function getLastNote() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.TAB_NAMES.NOTE_HISTORY);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var row = sheet.getLastRow();
  var vals = sheet.getRange(row, 1, 1, CONFIG.NOTE_HISTORY_COLS.length).getValues()[0];
  var obj = {};
  CONFIG.NOTE_HISTORY_COLS.forEach(function(c, i) { obj[c] = vals[i]; });
  return obj;
}