function buildEmail(noteObj) {
  var top = noteObj.top || [];
  var note = noteObj.note;
  var date = new Date().toISOString().slice(0, 10);
  if (!top.length) {
    return {
      subject: 'Weekly Review Pulse — GROWW (no signals)',
      body: 'Hi team,\n\nThis week no theme crossed the priority threshold.\n\n— Weekly Review Pulse (automated summary, ' + date + ')'
    };
  }
  var urgent = top[0];
  var frameFeed = 'Most urgent theme: ' + urgent.theme + '. Ranked: ' + top.map(function(t) { return t.theme; }).join(', ') +
    '. Quote: "' + urgent.top_quote + '". Write ONE lead-in sentence (max 25 words) that hooks a product/leadership reader on what reviewers are telling us. Do NOT repeat the counts, ratings or priority numbers (the digest below shows them). Quote usage verbatim is allowed.';
  var askFeed = 'Based on theme ' + urgent.theme + ' (' + urgent.count + ' reviews, avg ' + urgent.avg_rating.toFixed(2) + '/5), write ONE direct next-step ask for the product team (max 20 words, no invented data).';
  var frame = '';
  var ask = '';
  try {
    var sys1 = 'You write one lead-in sentence (max 25 words) for a product-leadership digest built from app reviews of Groww. Base it only on the data given, do not repeat stat numbers, no user names.';
    frame = endSentence(geminiGenerate(sys1, frameFeed, { temperature: 0.3, maxOutputTokens: 120 }));
  } catch (e) { frame = 'Reviewer feedback this week points at money movement and trade execution.'; }
  try {
    var sys2 = 'You write one direct next-step ask for a product team, max 20 words, based only on the data given.';
    ask = endSentence(geminiGenerate(sys2, askFeed, { temperature: 0.4, maxOutputTokens: 120 }));
  } catch (e) { ask = endSentence('Please treat ' + urgent.theme + ' as the top priority this week'); }
  var bullets = top.map(function(t) {
    var score = (typeof t.priority_score !== 'undefined') ? ', priority ' + Number(t.priority_score).toFixed(1) : '';
    return '• ' + t.theme + ' — ' + t.count + ' reviews, ~' + Number(t.avg_rating).toFixed(1) + '/5' + score + ': "' + t.top_quote + '"';
  });
  var suffix = '';
  if (noteObj.coverage) {
    suffix = ' · ' + coverageFooter(noteObj.coverage.classified, noteObj.coverage.unclassified).replace(/\.$/, '');
  }
  var subject = 'Weekly Review Pulse — GROWW (' + date + ')';
  var body = [
    'Hi team,', '',
    frame, '',
    'What reviewers are telling us:'
  ].concat(bullets, ['', 'Next step: ' + ask, '',
    '— Weekly Review Pulse (automated summary, ' + date + ')' + suffix
  ]).join('\n');
  return { subject: subject, body: body };
}

function createEmailDraft(subject, body) {
  var recipient = prop('PULSE_EMAIL', '');
  if (!recipient) throw new Error('Set PULSE_EMAIL in Script Properties (or edit createEmailDraft)');
  return GmailApp.createDraft(recipient, subject, body);
}

function sendLiveEmail(subject, body) {
  var recipient = prop('PULSE_EMAIL', '');
  if (!recipient) throw new Error('Set PULSE_EMAIL in Script Properties');
  GmailApp.sendEmail(recipient, subject, body);
  logRun('email', 'ok', 'SENT to ' + recipient + ' :: ' + subject);
  return recipient;
}