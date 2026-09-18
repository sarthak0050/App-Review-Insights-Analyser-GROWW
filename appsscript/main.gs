function onOpen() {
  SpreadsheetApp.getUi().createMenu('Pulse')
    .addItem('1. Import reviews CSV', 'runImportDialog')
    .addItem('2. Scrub PII (RawReviews)', 'runScrub')
    .addItem('3. Classify themes', 'runClassify')
    .addItem('4. Build Themes + quotes', 'runPrioritize')
    .addItem('5. Generate note', 'runGenerateNote')
    .addItem('6. Create email draft', 'runCreateDraft')
    .addItem('7. Send email now (Gmail)', 'runSendEmail')
    .addItem('Run FULL pipeline', 'runPipeline')
    .addItem('PII demo (before/after)', 'runPiiDemo')
    .addItem('Run verification', 'runVerificationWrapper')
    .addToUi();
}

function runImportDialog() { showImportDialog(); }
function runScrub() { logRun('scrub', 'ok', scrubSheet(CONFIG.TAB_NAMES.RAW)); }
function runClassify() { classifyAllReviews(); }
function runPrioritize() { var t = writeThemesTab(); logRun('prioritize', 'ok', t.length + ' theme rows written'); }
function runGenerateNote() {
  var n = generateNote();
  ensureTabs();
  var top = n.top || [];
  var row = [ new Date().toISOString(), top[0] ? top[0].theme : '', top[1] ? top[1].theme : '', top[2] ? top[2].theme : '', n.note, wordCount(n.note), '', n.truncated ? 'truncated' : 'ok' ];
  appendToTab(CONFIG.TAB_NAMES.NOTE_HISTORY, row);
  logRun('note', n.truncated ? 'truncated' : 'ok', 'note generated, ' + wordCount(n.note) + ' words');
  return n;
}
function runCreateDraft(noteObj) {
  var n = noteObj || runGenerateNote();
  var email = buildEmail(n);
  var row = getLastNoteRow();
  if (row > 0) setCell(CONFIG.TAB_NAMES.NOTE_HISTORY, row, CONFIG.NOTE_HISTORY_COLS.indexOf('email_subject') + 1, email.subject);
  var draft = createEmailDraft(email.subject, email.body);
  logRun('email', 'ok', 'draft created: ' + email.subject);
  return email;
}
function runVerificationWrapper() { return runVerification(); }
function runSendEmail() {
  var note = generateNote();
  var email = buildEmail(note);
  var to = sendLiveEmail(email.subject, email.body);
  return 'sent to ' + to + ' :: ' + email.subject;
}
function runPipeline() {
  ensureTabs();
  logRun('run', 'start', 'pipeline start');
  try { runScrub(); } catch (e) { logRun('scrub', 'error', e.message); throw e; }
  try { classifyAllReviews(); } catch (e) { logRun('classify', 'error', e.message); throw e; }
  try { writeThemesTab(); } catch (e) { logRun('prioritize', 'error', e.message); throw e; }
  var note;
  try { note = runGenerateNote(); } catch (e) { logRun('note', 'error', e.message); throw e; }
  try { runCreateDraft(note); } catch (e) { logRun('email', 'error', e.message); throw e; }
  try { runVerification(); } catch (e) { logRun('verify', 'error', e.message); throw e; }
  logRun('run', 'done', 'pipeline finished');
}