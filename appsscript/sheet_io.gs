function ensureTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabs = [
    [CONFIG.TAB_NAMES.RAW, CONFIG.RAW_COLS],
    [CONFIG.TAB_NAMES.THEMES, CONFIG.THEME_COLS],
    [CONFIG.TAB_NAMES.NOTE_HISTORY, CONFIG.NOTE_HISTORY_COLS],
    [CONFIG.TAB_NAMES.RUN_LOG, CONFIG.RUN_LOG_COLS],
    [CONFIG.TAB_NAMES.VERIFICATION, CONFIG.VERIFICATION_COLS]
  ];
  tabs.forEach(function(def) {
    var name = def[0], cols = def[1];
    var s = ss.getSheetByName(name);
    if (!s) {
      s = ss.insertSheet(name);
      s.appendRow(cols);
    } else if (s.getLastRow() < 1 || s.getRange(1,1,1,s.getLastColumn()).getValues()[0].join(',') !== cols.join(',')) {
      s.clearContents();
      s.appendRow(cols);
    }
  });
}

function appendToTab(sheetName, row) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return;
  sheet.appendRow(row);
}

function getRawReviews() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.TAB_NAMES.RAW);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = sheet.getLastColumn();
  var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = data[0];
  var rows = [];
  for (var r = 1; r < lastRow; r++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = data[r][c];
    rows.push(obj);
  }
  return rows;
}

function clearThemes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.TAB_NAMES.THEMES);
  if (!sheet) return;
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow()-1, sheet.getLastColumn()).clearContent();
}

function setCell(sheetName, row, col, val) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (sheet) sheet.getRange(row, col).setValue(val);
}

function csvParse(text) {
  if (!text) return [];
  var rows = [];
  var current = [];
  var cell = '';
  var inQuote = false;
  var i = 0;
  while (i < text.length) {
    var ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i+1] === '"') {
          cell += '"';
          i += 2;
        } else {
          inQuote = false;
          i++;
        }
      } else {
        cell += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
        i++;
      } else if (ch === ',') {
        current.push(cell);
        cell = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && i+1 < text.length && text[i+1] === '\n') i++;
        current.push(cell);
        if (current.some(function(c) { return c.trim() !== ''; })) rows.push(current);
        current = [];
        cell = '';
        i++;
      } else {
        cell += ch;
        i++;
      }
    }
  }
  current.push(cell);
  if (current.some(function(c) { return c.trim() !== ''; })) rows.push(current);
  return rows;
}

function parseImportCsv(csvText) {
  var rows = csvParse(csvText);
  if (rows.length < 2) return { headers: [], rows: [] };
  var headers = rows[0].map(function(h) { return h.trim().toLowerCase(); });
  var dataRows = [];
  for (var i = 1; i < rows.length; i++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = (rows[i][c] || '').trim();
    if (obj.rating || obj.text) dataRows.push(obj);
  }
  return { headers: headers, rows: dataRows };
}

function getThemesTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.TAB_NAMES.THEMES);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var data = sheet.getRange(1, 1, lastRow, CONFIG.THEME_COLS.length).getValues();
  var headers = data[0];
  var rows = [];
  for (var r = 1; r < lastRow; r++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = data[r][c];
    rows.push(obj);
  }
  return rows;
}

function showImportDialog() {
  var html = HtmlService.createHtmlOutput(
    '<style>body{font-family:sans-serif;padding:12px;} textarea{width:100%;height:300px;font-family:monospace;} button{margin-top:8px;padding:8px 16px;cursor:pointer;} .ok{color:green;} .err{color:red;white-space:pre-wrap;}</style>' +
    '<h4>Import reviews CSV into RawReviews</h4>' +
    '<p>Paste the CSV content (header row + data rows) below, then click <b>Import</b>.</p>' +
    '<textarea id="csv"></textarea>' +
    '<button onclick="doImport()">Import</button> <span id="msg"></span>' +
    '<script>function doImport(){var t=document.getElementById("csv").value;document.getElementById("msg").className="";document.getElementById("msg").textContent="importing…";google.script.run.withSuccessHandler(function(m){document.getElementById("msg").className="ok";document.getElementById("msg").textContent=m}).withFailureHandler(function(e){document.getElementById("msg").className="err";document.getElementById("msg").textContent="error: "+(e.message||e)}).importCsvText(t)}</script>',
    'Import Reviews'
  ).setWidth(520).setHeight(420);
  SpreadsheetApp.getUi().showModalDialog(html, 'Import CSV');
}

function importCsvText(csvText) {
  ensureTabs();
  var parsed = parseImportCsv(csvText);
  if (!parsed.rows.length) return 'no rows found';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.TAB_NAMES.RAW);
  if (!sheet) throw new Error('RawReviews tab missing after ensureTabs');
  var existingHeaders = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  var wantCols = CONFIG.RAW_COLS;
  var count = 0;
  parsed.rows.forEach(function(row) {
    var out = [];
    wantCols.forEach(function(h) {
      var val = row[h] != null ? String(row[h]) : '';
      if (h === 'text' || h === 'title') val = scrubPii(val);
      out.push(val);
    });
    sheet.appendRow(out);
    count++;
  });
  return count + ' reviews imported into RawReviews';
}
