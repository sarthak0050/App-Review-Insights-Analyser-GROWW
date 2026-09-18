function logRun(stage, status, detail) {
  try {
    ensureTabs();
    var stamp = new Date().toISOString();
    if (stage === 'run') {
      clearSheet(CONFIG.TAB_NAMES.RUN_LOG);
    }
    appendToTab(CONFIG.TAB_NAMES.RUN_LOG, [stamp, stage, status, detail || '']);
  } catch (e) {
    Logger.log('logRun failed: ' + e.message);
  }
}

function clearSheet(tabName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return;
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
}