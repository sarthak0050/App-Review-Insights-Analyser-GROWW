"use strict";

let DATA = null;
let EMAIL = null;

function hideBoot() {
  document.getElementById("boot").classList.add("hidden");
}

async function load() {
  try {
    const res = await fetch("dashboard_data.json?t=" + Date.now());
    if (!res.ok) throw new Error("HTTP " + res.status);
    DATA = await res.json();
  } catch (e) {
    hideBoot();
    document.getElementById("meta").innerHTML =
      "Dashboard data not found. Run: python3 scripts/5_build_dashboard.py  (then refresh).";
    return;
  }
  renderMeta();
  renderStages();
  renderKpis();
  renderCoverage();
  renderThemes();
  renderRatingChart();
  renderSourceChart();
  renderNote();
  renderFilters();
  renderRows();
  hideBoot();
  document.querySelector("main").classList.add("ready");
}

function renderMeta() {
  const d = DATA;
  document.getElementById("meta").textContent =
    d.source_count + " reviews · window " + d.date_range.min + " → " + d.date_range.max +
    " · generated " + d.generated_at.replace("T", " ");
}

const CHECKS_DEF = [
  ["data", "Data"],
  ["pii", "PII clean"],
  ["themes", "Themes"],
  ["note", "Note"]
];

function renderStages() {
  const d = DATA;
  const states = {
    data: d.checks && d.checks.columns ? "ok" : "no",
    pii: d.checks && d.checks.pii_hits === 0 ? "ok" : "no",
    themes: d.checks && d.checks.theme_count_within_legend ? "ok" : "no",
    note: d.checks && d.checks.note_word_limit ? "ok" : "no"
  };
  document.getElementById("stages").innerHTML = CHECKS_DEF.map(([k, label]) =>
    '<span class="stage ' + (states[k] === "ok" ? "ok" : "bad") + '">' +
    '<span class="dot"></span>' + label + "</span>").join("");
}

function kpiCard(icon, label, value, sub) {
  return '<div class="kpi"><div class="kpi-icon">' + icon + "</div>" +
    '<div><span class="kpi-label">' + label + "</span>" +
    '<span class="kpi-value">' + value + "</span>" +
    '<span class="kpi-sub">' + (sub || "") + "</span></div></div>";
}

function starGlyph(filled) {
  return filled
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="#f5b301"><path d="M12 2l2.9 6.2 6.6.6-5 4.7 1.5 6.5L12 16.9 5.9 20l1.5-6.5-5-4.7 6.6-.6z"/></svg>'
    : '<svg viewBox="0 0 24 24" width="16" height="16" fill="#3a4056"><path d="M12 2l2.9 6.2 6.6.6-5 4.7 1.5 6.5L12 16.9 5.9 20l1.5-6.5-5-4.7 6.6-.6z"/></svg>';
}

function renderStars(rating) {
  let out = "";
  for (let i = 1; i <= 5; i++) out += starGlyph(i <= rating);
  return out;
}

function renderKpis() {
  const d = DATA;
  const unclassified = (d.coverage && d.coverage.unclassified != null) ? d.coverage.unclassified :
    (d.source_count - d.themes.reduce((s, t) => s + t.count, 0));
  const top = d.top3[0];
  const stars = Math.round(d.avg_rating);
  document.getElementById("stats").innerHTML =
    kpiCard("R", "Reviews scanned", d.source_count, "both stores") +
    kpiCard("★", "Average rating", d.avg_rating + "/5", renderStars(stars)) +
    kpiCard("T", "Themes detected", d.themes.length + " of " + d.legend.length, "fixed legend") +
    '<div class="kpi kpi-unclass"><div class="kpi-icon">?</div><div>' +
    '<span class="kpi-label">Unclassified</span>' +
    '<span class="kpi-value">' + unclassified + "</span>" +
    '<span class="kpi-sub">no theme match · see note below</span></div></div>' +
    '<div class="kpi kpi-lede"><span class="kpi-label">Top theme</span>' +
    '<span class="kpi-value">' + escapeHtml(top.theme) + "</span>" +
    '<span class="kpi-sub">priority score ' + top.priority_score + " · " + top.count + " reviews</span></div>";
}

function renderCoverage() {
  const d = DATA;
  const el = document.getElementById("coverageStrip");
  if (!el) return;
  const cov = d.coverage || {};
  const total = cov.total != null ? cov.total : d.source_count;
  const uncl = cov.unclassified != null ? cov.unclassified :
    (d.source_count - d.themes.reduce((s, t) => s + t.count, 0));
  const classified = total - uncl;
  const pct = total ? Math.round((uncl / total) * 100) : 0;
  el.innerHTML =
    '<span class="coverage-dot"></span>' +
    "<div><b>Signal basis:</b> themes are drawn from <b>" + classified + " of " + total +
    "</b> reviews (" + uncl + " — " + pct + "% — are short/no-signal reviews, largely one-line praise) " +
    "and sit outside the 5-theme legend. Ranks therefore reflect classified volume, not the full window.</div>";
}

function renderThemes() {
  const max = Math.max(...DATA.themes.map((t) => t.priority_score || 0), 1);
  const el = document.getElementById("themeCards");
  el.innerHTML = DATA.themes.map((t) => {
    const pct = Math.round(((t.priority_score || 0) / max) * 100);
    const top3 = t.rank <= 3;
    const rankBadge = top3
      ? '<span class="rank' + (t.rank === 1 ? " rank-1" : "") + '">#' + t.rank + "</span>"
      : '<span class="rank dim">—</span>';
    return '<article class="theme-card' + (top3 ? " hot" : "") + '">' +
      "<header><h3>" + escapeHtml(t.theme) + "</h3>" + rankBadge + "</header>" +
      '<div class="theme-meta"><span>' + t.count + " reviews</span><span>~" + t.avg_rating + '/5</span><span class="score">' +
      t.priority_score + " pts</span></div>" +
      '<div class="prio-bar"><div class="prio-fill' + (top3 ? " live" : "") + '" style="width:' + pct + '%"></div></div>' +
      (t.top_quote ? '<blockquote>“' + escapeHtml(t.top_quote) + "”</blockquote>" : "") +
      "</article>";
  }).join("");
}

function renderRatingChart() {
  const counts = [0, 0, 0, 0, 0];
  DATA.reviews.forEach((r) => { counts[r.rating - 1]++; });
  const max = Math.max(...counts, 1);
  const el = document.getElementById("ratingChart");
  el.innerHTML = counts.map((c, i) => {
    const pct = Math.round((c / max) * 100);
    const cls = i < 2 ? "bad" : i === 2 ? "mid" : "good";
    return '<div class="row"><span class="lab">' + (i + 1) + " &#9733;</span>" +
      '<div class="bar"><div class="fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
      '<span class="cnt">' + c + "</span></div>";
  }).join("");
}

function renderSourceChart() {
  const entries = Object.entries(DATA.source_breakdown).sort((a, b) => b[1] - a[1]);
  const total = DATA.source_count;
  const colors = ["#2dd4a7", "#4f8cff"];
  let segments = "";
  let offset = 0;
  entries.forEach(([, n], i) => {
    const pct = (n / total) * 360;
    segments += '<circle r="15.9" cx="21" cy="21" fill="none" stroke="' + colors[i % colors.length] +
      '" stroke-width="7" stroke-dasharray="' + pct + " 360" + '" stroke-dashoffset="' + (-offset) + '"></circle>';
    offset += pct;
  });
  const legendRows = entries.map(([p, n], i) =>
    '<div class="legend-row"><span class="swatch" style="background:' + colors[i % colors.length] + '"></span>' +
    escapeHtml(p) + "<b>" + n + "</b></div>").join("");
  document.getElementById("sourceChart").innerHTML =
    '<div class="donut"><svg viewBox="0 0 42 42">' + segments + "</svg>" +
    '<span class="donut-label">' + total + '</span></div>' + '<div class="legend">' + legendRows + "</div>";
}

function noteQuotes(n) {
  const src = (n && n.themes) || DATA.top3 || [];
  return src.map((t) => t && t.top_quote).filter(Boolean);
}

function noteHTML(text, quotes) {
  let html = escapeHtml(text);
  quotes.forEach((q) => {
    const eq = escapeHtml(q);
    if (html.indexOf(eq) === -1) return;
    html = html.split(eq).join('<span class="quote">' + eq + "</span>");
  });
  return html;
}

function renderNote() {
  const n = DATA.note;
  document.getElementById("noteText").innerHTML = noteHTML(n.text, noteQuotes(n));
  const badge = document.getElementById("noteBadge");
  badge.textContent = n.word_count + " words" + (n.word_count <= 250 ? " ✓ within limit" : " ⚠ OVER LIMIT");
  badge.classList.toggle("badge-warn", n.word_count > 250);
  document.getElementById("noteLimitation").textContent =
    n.is_preview && n.note_limitation ? n.note_limitation :
    "Note generated live with " + (n.used_api_key ? "Gemini" : "deterministic rules") + ".";
}

function setStatus(id, msg) {
  document.getElementById(id).textContent = msg;
}

async function postJson(url) {
  const res = await fetch(url, { method: "POST" });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "HTTP " + res.status);
  return data;
}

async function onGenerateNote() {
  const btn = document.getElementById("btnNote");
  btn.disabled = true;
  setStatus("noteStatus", "generating…");
  try {
    const note = await postJson("/api/note");
    DATA.note = note;
    document.getElementById("noteText").innerHTML = noteHTML(note.text, noteQuotes(note));
    const badge = document.getElementById("noteBadge");
    badge.textContent = note.word_count + " words" + (note.word_count <= 250 ? " ✓ within limit" : " ⚠ OVER LIMIT");
    badge.classList.toggle("badge-warn", note.word_count > 250);
    renderCoverage();
    setStatus("noteStatus", note.used_api_key
      ? "Generated with Gemini" + (note.truncated ? " — trimmed to 250 words" : "")
      : "set GEMINI_API_KEY (README) for LLM generation");
  } catch (e) {
    setStatus("noteStatus", "error: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

async function onGenerateEmail() {
  window.localStorage.setItem("pulse_recipient", document.getElementById("recipient").value);
  const btn = document.getElementById("btnEmail");
  const copyBtn = document.getElementById("btnCopy");
  const emlBtn = document.getElementById("btnEml");
  const sendBtn = document.getElementById("btnSend");
  [btn, copyBtn, emlBtn, sendBtn].forEach((b) => { b.disabled = true; });
  setStatus("emailStatus", "generating…");
  try {
    EMAIL = await postJson("/api/email");
    EMAIL.recipient = document.getElementById("recipient").value.trim() || "you@example.com";
    EMAIL.date = new Date().toUTCString();
    renderEmailHeader();
    document.getElementById("emailBody").textContent = EMAIL.body;
    document.getElementById("emailPreview").classList.add("visible");
    document.getElementById("emailPlaceholder").style.display = "none";
    setStatus("emailStatus", EMAIL.used_api_key
      ? "Generated with Gemini" + (EMAIL.smtp_configured ? " — Send enabled" : " — draft-only (set SMTP_EMAIL + SMTP_APP_PASSWORD to enable Send)")
      : "Deterministic fallback (no GEMINI_API_KEY)");
  } catch (e) {
    setStatus("emailStatus", "error: " + e.message);
  } finally {
    [btn, copyBtn, emlBtn, sendBtn].forEach((b) => { b.disabled = false; });
  }
}

async function onSendEmail() {
  if (!EMAIL) return setStatus("emailStatus", "generate an email first");
  const to = document.getElementById("recipient").value.trim();
  if (!to) return setStatus("emailStatus", "enter a recipient email first");
  const btn = document.getElementById("btnSend");
  btn.disabled = true;
  setStatus("emailStatus", "sending to " + to + "…");
  try {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: to, subject: EMAIL.subject, body: EMAIL.body })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "HTTP " + res.status);
    setStatus("emailStatus", "email sent to " + to);
  } catch (e) {
    setStatus("emailStatus", "not sent: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

function renderEmailHeader() {
  if (!EMAIL) return;
  const rows = [
    ["From", "Weekly Review Pulse <weekly-review-pulse@localhost>"],
    ["To", EMAIL.recipient],
    ["Subject", EMAIL.subject],
    ["Date", EMAIL.date]
  ];
  document.getElementById("emailHeader").innerHTML =
    '<header class="email-title">' + escapeHtml(EMAIL.subject) + "</header>" +
    rows.map(([k, v]) =>
      '<div class="hdr-row"><span class="hdr-k">' + k + "</span>" +
      '<span class="hdr-v' + (k === "Subject" ? " subject" : "") + '">' + escapeHtml(v) + "</span></div>"
    ).join("");
}

function copyEmailBody() {
  if (!EMAIL) return setStatus("emailStatus", "generate an email first");
  navigator.clipboard.writeText(EMAIL.body).then(() => setStatus("emailStatus", "body copied to clipboard"));
}

function downloadEml() {
  if (!EMAIL) return setStatus("emailStatus", "generate an email first");
  const to = document.getElementById("recipient").value.trim() || "you@example.com";
  const date = new Date().toUTCString();
  const eml = [
    "From: " + "Weekly Review Pulse <weekly-review-pulse@localhost>",
    "To: " + to,
    "Subject: " + EMAIL.subject,
    "Date: " + date,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    EMAIL.body.replace(/\r?\n/g, "\r\n")
  ].join("\r\n");
  const blob = new Blob([eml], { type: "message/rfc822" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "weekly-review-pulse-" + new Date().toISOString().slice(0, 10) + ".eml";
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus("emailStatus", ".eml downloaded — open it to review as a draft");
}

function openMailto() {
  if (!EMAIL) return setStatus("emailStatus", "generate an email first");
  const to = document.getElementById("recipient").value.trim();
  const url = "mailto:" + to + "?subject=" + encodeURIComponent(EMAIL.subject) + "&body=" + encodeURIComponent(EMAIL.body);
  const a = document.createElement("a");
  a.href = url;
  a.click();
  setStatus("emailStatus", "mail app opened with the draft — choose any recipient (e.g. yourself) and send");
}

document.getElementById("btnNote").addEventListener("click", onGenerateNote);
document.getElementById("btnEmail").addEventListener("click", onGenerateEmail);
document.getElementById("btnCopy").addEventListener("click", copyEmailBody);
document.getElementById("btnEml").addEventListener("click", downloadEml);
document.getElementById("btnMailto").addEventListener("click", openMailto);
document.getElementById("btnSend").addEventListener("click", onSendEmail);
document.getElementById("recipient").value = window.localStorage.getItem("pulse_recipient") || "";

function renderFilters() {
  const platforms = [...new Set(DATA.reviews.map((r) => r.platform))].sort();
  const themes = [...new Set(DATA.reviews.map((r) => r.theme))].sort();
  const platSel = document.getElementById("filterPlatform");
  const themeSel = document.getElementById("filterTheme");
  platforms.forEach((p) => platSel.add(new Option(p, p)));
  themes.forEach((t) => themeSel.add(new Option(t, t)));
}

function filteredReviews() {
  const plat = document.getElementById("filterPlatform").value;
  const theme = document.getElementById("filterTheme").value;
  const rating = document.getElementById("filterRating").value;
  const q = document.getElementById("filterSearch").value.toLowerCase();
  return DATA.reviews.filter((r) => {
    if (plat && r.platform !== plat) return false;
    if (theme && r.theme !== theme) return false;
    if (rating && String(r.rating) !== rating) return false;
    if (q && !(r.text.toLowerCase().includes(q) || (r.title || "").toLowerCase().includes(q))) return false;
    return true;
  });
}

function renderRows() {
  const rows = filteredReviews();
  const body = document.getElementById("reviewRows");
  body.innerHTML = rows.map((r) => {
    const title = r.title ? "<strong>" + escapeHtml(r.title) + "</strong><br />" : "";
    return "<tr>" +
      '<td><span class="stars">' + renderStars(r.rating) + "</span></td>" +
      '<td><span class="tag">' + escapeHtml(r.platform) + "</span></td>" +
      "<td>" + r.date + "</td>" +
      '<td><span class="theme-tag">' + escapeHtml(r.theme) + "</span></td>" +
      "<td>" + title + escapeHtml(r.text) + "</td>" +
      "</tr>";
  }).join("");
  if (!rows.length) body.innerHTML = '<tr><td colspan="5" class="hint">no reviews match</td></tr>';
  document.getElementById("rowCount").textContent = rows.length + " of " + DATA.reviews.length + " reviews";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

["filterPlatform", "filterTheme", "filterRating", "filterSearch"].forEach((id) => {
  document.getElementById(id).addEventListener("change", renderRows);
  document.getElementById(id).addEventListener("input", renderRows);
});

load();