function themeStats() {
  var rows = getRawReviews();
  var stats = {};
  CONFIG.THEMES.forEach(function(t) { stats[t.name] = { count: 0, sum: 0 }; });
  var unclass = 0;
  rows.forEach(function(r) {
    var theme = r.theme || 'Unclassified';
    var rating = parseInt(r.rating, 10);
    if (isNaN(rating)) rating = 0;
    if (stats[theme]) {
      stats[theme].count++;
      stats[theme].sum += rating;
    } else {
      unclass++;
    }
  });
  var out = [];
  CONFIG.THEMES.forEach(function(t) {
    var st = stats[t.name];
    if (st.count === 0) return;
    var avg = st.sum / st.count;
    out.push({
      theme: t.name,
      count: st.count,
      avg_rating: avg,
      priority_score: st.count * (6 - avg),
      rank: 0,
      top_quote: '',
      top_quote_rating: '',
      action_idea: ''
    });
  });
  out.sort(function(a, b) { return b.priority_score - a.priority_score; });
  out.forEach(function(x, i) { x.rank = i + 1; });
  for (var i = out.length; i < CONFIG.THEMES.length; i++) {
    out.push({ theme: CONFIG.THEMES[i].name, count: 0, avg_rating: '', priority_score: 0, rank: i + 1, top_quote: '', top_quote_rating: '', action_idea: '' });
  }
  return { stats: out, total: rows.length, unclassified: unclass };
}

function exactQuote(text, title) {
  var source = String(title || '') || String(text || '');
  if (!source) return { quote: '', source: '' };
  var body = String(text || '');
  if (body.length >= 40) source = body;
  var q = source;
  if (q.length > 180) {
    var cut = q.slice(0, 160);
    var sp = cut.lastIndexOf(' ');
    if (sp > 80) cut = cut.slice(0, sp);
    q = cut;
  }
  q = q.trim();
  return { quote: q.replace(/\s+/g, ' ').trim(), source: source };
}

function pickQuotes() {
  var reviews = getRawReviews();
  var byTheme = {};
  reviews.forEach(function(r) {
    var theme = r.theme;
    if (!byTheme[theme]) byTheme[theme] = [];
    byTheme[theme].push(r);
  });
  var quotes = {};
  Object.keys(byTheme).forEach(function(theme) {
    var rows = byTheme[theme].filter(function(r) { return (r.text || '').trim().length > 0; });
    if (!rows.length) return;
    rows.sort(function(a, b) { return (parseFloat(a.rating) || 5) - (parseFloat(b.rating) || 5); });
    var chosen = null;
    for (var i = 0; i < rows.length && !chosen; i++) {
      var cand = exactQuote(rows[i].text, rows[i].title);
      if (cand && (cand.quote + cand.source).indexOf(cand.quote) !== -1) chosen = cand;
    }
    if (chosen) quotes[theme] = { quote: chosen.quote, rating: rows[0].rating };
  });
  return quotes;
}

function generateActionIdeas(top3) {
  var allowed = CONFIG.THEMES.map(function(t) { return t.name; });
  var items = top3.map(function(s) {
    return s.theme + ' (count ' + s.count + ', avg ' + (typeof s.avg_rating === 'number' ? s.avg_rating.toFixed(2) : s.avg_rating) + ', quote: ' + (s.top_quote || 'none') + ')';
  });
  var system = 'You are a product manager for the Groww trading/investing app. For each theme, propose ONE concrete, actionable product/customer-support action in under 30 words. Never mention specific users, names, emails, or data that was not provided. Respond ONLY with a JSON array of objects: [{"theme":"App Stability","action":"..."}].';
  var prompt = 'Give one next-week action per theme:\n' + items.join('\n');
  var arr = geminiGenerateJSON(system, prompt, { temperature: 0.4, maxOutputTokens: 700 });
  var map = {};
  arr.forEach(function(item) {
    if (allowed.indexOf(item.theme) !== -1) map[item.theme] = String(item.action || '').trim();
  });
  return map;
}

function writeThemesTab() {
  ensureTabs();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.TAB_NAMES.THEMES);
  clearThemes();
  var quoteMap = pickQuotes();
  var stats = themeStats();
  var rows = stats.stats;
  rows.forEach(function(row) {
    if (quoteMap[row.theme]) {
      row.top_quote = quoteMap[row.theme].quote;
      row.top_quote_rating = quoteMap[row.theme].rating;
    }
    if (row.count > 0) {
      sheet.appendRow(CONFIG.THEME_COLS.map(function(c) { return row[c] != null ? row[c] : ''; }));
    }
  });
  var top3 = rows.filter(function(r) { return r.rank >= 1 && r.rank <= 3 && r.count > 0; });
  if (top3.length) {
    try {
      var ideas = generateActionIdeas(top3);
      top3.forEach(function(r) {
        if (ideas[r.theme]) {
          var rowNum = r.rank + 1;
          setCell(CONFIG.TAB_NAMES.THEMES, rowNum, CONFIG.THEME_COLS.indexOf('action_idea') + 1, ideas[r.theme]);
        }
      });
    } catch (e) {
      logRun('prioritize', 'partial', 'action ideas failed: ' + e.message);
    }
  }
  return rows;
}