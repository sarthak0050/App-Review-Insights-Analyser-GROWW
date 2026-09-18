const PII_REGEXES = [
  { re: /[\w.+-]+@[\w-]+(\.[\w-]+)+/g, rep: '[EMAIL]' },
  { re: /(?<!\d)\d{9,}(?!\d)/g, rep: '[NUMBER]' },
  { re: /\+?\d[\d\s().-]{8,}\d/g, rep: '[PHONE]' },
  { re: /@\w{2,}/g, rep: '[HANDLE]' }
];

function scrubPii(text) {
  if (!text) return '';
  var out = String(text);
  for (var i = 0; i < PII_REGEXES.length; i++) {
    PII_REGEXES[i].re.lastIndex = 0;
    out = out.replace(PII_REGEXES[i].re, PII_REGEXES[i].rep);
  }
  return out.replace(/\s+/g, ' ').trim();
}

function scrubSheet(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName || CONFIG.TAB_NAMES.RAW);
  if (!sheet) return 'no sheet';
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'no data rows';
  var lastCol = sheet.getLastColumn();
  var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = data[0];
  var titleIdx = headers.indexOf('title');
  var textIdx  = headers.indexOf('text');
  var scrubbed = 0;
  for (var r = 1; r < lastRow; r++) {
    for (var idx of [titleIdx, textIdx]) {
      if (idx < 0) continue;
      var orig = String(data[r][idx]);
      var clean = scrubPii(orig);
      if (clean !== orig) {
        sheet.getRange(r + 1, idx + 1).setValue(clean);
        scrubbed++;
      }
    }
  }
  return scrubbed + ' cells scrubbed';
}

function piiDemo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.TAB_NAMES.RAW);
  if (!sheet) return 'RawReviews not found';
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'no data rows';
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var textIdx = headers.indexOf('text');
  for (var r = 2; r <= lastRow; r++) {
    var val = String(sheet.getRange(r, textIdx + 1).getValue());
    if (val && val.length > 30) {
      var before = val;
      var after = scrubPii(val);
      return 'BEFORE: ' + before.slice(0, 150) + '\nAFTER:  ' + after.slice(0, 150);
    }
  }
  return 'no row long enough for demo';
}
