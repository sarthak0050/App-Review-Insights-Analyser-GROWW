function geminiGenerate(systemPrompt, userPrompt, opts) {
  const apiKey = prop(CONFIG.GEMINI_KEY_PROP, '');
  if (!apiKey) throw new Error('Set GEMINI_API_KEY in Script Properties');
  const url = CONFIG.GEMINI_URL.replace('{MODEL}', CONFIG.GEMINI_MODEL)
    + '?key=' + apiKey;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: opts && opts.temperature != null ? opts.temperature : 0.4,
      maxOutputTokens: opts && opts.maxOutputTokens ? opts.maxOutputTokens : 1024
    }
  });
  for (let attempt = 0; attempt <= CONFIG.GEMINI_RETRY_MAX; attempt++) {
    try {
      const resp = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: body,
        muteHttpExceptions: true
      });
      const code = resp.getResponseCode();
      if (code === 200) {
        const data = JSON.parse(resp.getContentText());
        const parts = data.candidates && data.candidates[0] && data.candidates[0].content
          && data.candidates[0].content.parts;
        if (parts && parts.length) {
          return parts.map(function(p) { return p.text || ''; }).join('');
        }
        throw new Error('Gemini returned empty content: ' + JSON.stringify(data).slice(0,300));
      }
      if (code === 429) {
        Utilities.sleep(CONFIG.GEMINI_RETRY_DELAY_MS * (attempt + 1) * 2);
        continue;
      }
      const txt = resp.getContentText().slice(0, 300);
      throw new Error('Gemini HTTP ' + code + ': ' + txt);
    } catch (e) {
      if (attempt === CONFIG.GEMINI_RETRY_MAX) throw e;
      Utilities.sleep(CONFIG.GEMINI_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw new Error('Gemini: exhausted retries');
}

function geminiGenerateJSON(systemPrompt, userPrompt, opts) {
  const raw = geminiGenerate(systemPrompt, userPrompt, opts);
  const m = raw.match(/\[[\s\S]*\]/);
  if (m) return JSON.parse(m[0]);
  return JSON.parse(raw);
}
