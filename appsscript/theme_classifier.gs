function keywordScore(text, keywords) {
  var blob = String(text).toLowerCase();
  var tokens = blob.match(/[a-z0-9]+/g) || [];
  var score = 0;
  for (var i = 0; i < keywords.length; i++) {
    var kw = keywords[i];
    for (var j = 0; j < tokens.length; j++) {
      var tok = tokens[j];
      if (tok.length >= kw.length && tok.length <= kw.length + 4 && tok.indexOf(kw) === 0) {
        score++;
        break;
      }
    }
  }
  return score;
}

function ruleClassify(title, text) {
  var blob = (title || '') + ' ' + (text || '');
  var best = { theme: 'Unclassified', score: 0 };
  CONFIG.THEMES.forEach(function(theme) {
    var s = keywordScore(blob, theme.keywords);
    if (s > best.score) best = { theme: theme.name, score: s };
  });
  return best;
}

function llmClassify(indexedReviews) {
  var payload = indexedReviews.map(function(it) {
    return it.idx + ': ' + (it.title ? it.title + ' | ' : '') + it.text.slice(0, 240);
  });
  var allowed = CONFIG.THEMES.map(function(t) { return t.name; });
  var system = 'You classify app-store/play-store review snippets into exactly one of: ' +
    allowed.join(', ') + '. Respond with only a JSON array of objects like ' +
    '[{"idx":0,"theme":"App Stability"}]. Use no other theme name. If unclear, use your best guess among the allowed list.';
  var prompt = 'Classify each review. Allowed themes: ' + allowed.join(', ') + '.\n\n' + payload.join('\n');
  var arr = geminiGenerateJSON(system, prompt, { temperature: 0.2, maxOutputTokens: 800 });
  if (!Array.isArray(arr)) throw new Error('LLM classifier did not return an array');
  var map = {};
  arr.forEach(function(item) {
    var key = item.idx;
    var theme = String(item.theme || '').trim();
    if (allowed.indexOf(theme) === -1) theme = 'Unclassified';
    map[key] = theme;
  });
  return map;
}

function classifyAllReviews() {
  ensureTabs();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.TAB_NAMES.RAW);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { logRun('classify', 'skip', 'no reviews to classify'); return 0; }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var themeCol = headers.indexOf('theme') + 1;
  var titleCol = headers.indexOf('title') + 1;
  var textCol  = headers.indexOf('text') + 1;
  var count = 0;
  var unclassified = [];
  var unClassifiedRows = [];
  for (var r = 2; r <= lastRow; r++) {
    var title = String(sheet.getRange(r, titleCol).getValue());
    var text  = String(sheet.getRange(r, textCol).getValue());
    if (!title && !text) continue;
    var rule = ruleClassify(title, text);
    if (rule.theme === 'Unclassified') {
      unclassified.push({ idx: unclassified.length, title: title, text: text });
      unClassifiedRows.push(r);
    } else {
      sheet.getRange(r, themeCol).setValue(rule.theme);
      count++;
    }
  }
  if (unclassified.length) {
    try {
      var map = llmClassify(unclassified);
      unclassified.forEach(function(it) {
        var theme = map[it.idx] || 'Unclassified';
        sheet.getRange(unClassifiedRows[it.idx], themeCol).setValue(theme);
        count++;
      });
    } catch (e) {
      logRun('classify', 'partial', 'LLM fallback failed (' + e.message + '); ' + unclassified.length + ' left Unclassified');
      unclassified.forEach(function(it) {
        sheet.getRange(unClassifiedRows[it.idx], themeCol).setValue('Unclassified');
        count++;
      });
    }
  }
  logRun('classify', count > 0 ? 'ok' : 'skip', count + ' reviews classified');
  return count;
}