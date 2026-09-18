function wordCount(s) {
  if (!s) return 0;
  return String(s).trim().split(/\s+/).filter(function(w) { return w.length > 0; }).length;
}

function endSentence(s) {
  return String(s || '').trim().replace(/[.\s]+$/, '') + '.';
}

function coverageFooter(classified, unclassified) {
  return 'Signal basis: themes drawn from ' + classified + ' of ' + (classified + unclassified) +
    ' reviews; ' + unclassified + ' no-signal reviews (largely one-line praise) sit outside the legend.';
}

function buildOverview(top3, stats) {
  var top = top3[0];
  if (!top) return 'No review signals this week — no theme passed the priority threshold.';
  var names = top3.map(function(t) { return t.theme; }).join(', ');
  var feed = 'Ranked themes this week (most urgent first): ' + names + '. Most urgent: ' + top.theme +
    '. Do NOT repeat any counts, ratings or priority scores (the numbered list below shows them). ' +
    'Instead give ONE cross-cutting observation: tone, concentration, or a shared root cause across this week\'s reviews.';
  var system = 'You write one concise factual sentence (under 45 words) giving a cross-cutting observation about Groww app reviews this week. Base claims ONLY on the data provided. Never repeat stat numbers you were shown. No user names, no invented facts.';
  try {
    return geminiGenerate(system, feed, { temperature: 0.3, maxOutputTokens: 120 }).trim();
  } catch (e) {
    logRun('note', 'partial', 'overview fallback used: ' + e.message);
    return 'Money movement and trade execution carry most of this window\'s friction — the ranked themes below show where attention is needed.';
  }
}

function buildThemeLines(top3) {
  var feed = top3.map(function(t) {
    return t.theme + ': ' + t.count + ' reviews, avg ' + t.avg_rating.toFixed(2) + '/5, quote "' + (t.top_quote || '') + '"';
  });
  var system = 'For each of the three themes, return ONE short sentence (max 35 words) summarising the signal from its reviews, and ONE short action idea (max 25 words). Never invent data. Respond with ONLY this JSON array: [{"theme":"...","commentary":"...","action":"..."}]';
  try {
    var arr = geminiGenerateJSON(system, 'Themes:\n' + feed.join('\n'), { temperature: 0.4, maxOutputTokens: 700 });
    var out = {};
    arr.forEach(function(item) {
      out[item.theme] = { commentary: String(item.commentary || '').trim(), action: String(item.action || '').trim() };
    });
    return out;
  } catch (e) {
    logRun('note', 'partial', 'theme lines fallback: ' + e.message);
    var fb = {};
    top3.forEach(function(t) {
      fb[t.theme] = { commentary: t.count + ' reviews averaging ' + t.avg_rating.toFixed(2) + '/5.', action: 'Prioritise ' + t.theme + ' investigation this week.' };
    });
    return fb;
  }
}

function assembleNote(overview, lines, top3, footer, truncated) {
  var parts = [];
  parts.push('WEEKLY REVIEW PULSE — GROWW');
  parts.push(overview);
  top3.forEach(function(t) {
    var l = lines[t.theme] || {};
    var commentary = endSentence(l.commentary || '');
    var action = l.action ? endSentence(l.action) : '';
    var line = (t.rank) + '. ' + t.theme + ' (' + t.count + ' reviews, ~' + t.avg_rating.toFixed(1) + '/5): "' + t.top_quote + '" — ' + commentary;
    if (action) line += ' Action: ' + action;
    parts.push(line);
  });
  if (footer) parts.push(footer);
  var note = parts.join('\n');
  var bodyMax = footer ? (CONFIG.NOTE_WORD_LIMIT - wordCount(footer)) : CONFIG.NOTE_WORD_LIMIT;
  if (wordCount(parts.slice(0, -1).join(' ')) > bodyMax) {
    while (wordCount(parts.slice(0, -1).join(' ')) > bodyMax && parts.length > 3) {
      var tail = parts[parts.length - 2].split(' ');
      parts[parts.length - 2] = tail.slice(0, -1).join(' ');
    }
    truncated = truncated || wordCount(parts.slice(0, -1).join(' ')) > bodyMax;
    note = parts.join('\n');
  }
  return { note: note, truncated: truncated };
}

function generateNote() {
  var themes = getThemesTab();
  var top3 = themes.filter(function(r) { return r.count > 0 && r.rank >= 1 && r.rank <= 3 && r.top_quote; })
    .slice(0, 3).sort(function(a, b) { return a.rank - b.rank; });
  if (!top3.length) return { note: 'WEEKLY REVIEW PULSE — GROWW\nNo qualifying themes this week.', truncated: false, top: [] };
  var classified = themes.reduce(function(s, t) { return s + (Number(t.count) || 0); }, 0);
  var total = getRawReviews().length;
  var footer = coverageFooter(classified, total - classified);
  var overview = buildOverview(top3, themes);
  var lines = buildThemeLines(top3);
  var built = assembleNote(overview, lines, top3, footer, false);
  if (built.truncated) logRun('note', 'truncated', 'note exceeded ' + CONFIG.NOTE_WORD_LIMIT + ' words and was trimmed');
  return {
    note: built.note,
    truncated: built.truncated,
    top: top3,
    coverage: { total: total, classified: classified, unclassified: total - classified }
  };
}