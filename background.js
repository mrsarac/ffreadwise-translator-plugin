// Background / Service Worker (MV2/MV3 compatible)
// Set an 'R' badge if supported by the browser
try {
  const ba = chrome?.browserAction || chrome?.action;
  if (ba?.setBadgeText) {
    ba.setBadgeBackgroundColor?.({ color: '#111827' });
    ba.setBadgeText({ text: 'R' });
  }
} catch (_) {}

async function translateWithGemini(text, apiKey, targetLanguage = 'en') {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = [
    `Translate the following text to ${targetLanguage}.`,
    'Preserve meaning, tone, and basic formatting.',
    `Only return the translated ${targetLanguage} text without comments.`,
    '',
    text,
  ].join('\n');
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Gemini API error: ${res.status} ${msg}`);
  }
  const data = await res.json();
  const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOut) throw new Error('Gemini returned an unexpected response.');
  return String(textOut).trim();
}

async function translateWithOpenAI(text, apiKey, targetLanguage = 'en') {
  const endpoint = 'https://api.openai.com/v1/chat/completions';
  const body = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: `You are a translation engine. Translate user text to ${targetLanguage}. Return only the translated text.` },
      { role: 'user', content: text },
    ],
    temperature: 0.2,
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`OpenAI API error: ${res.status} ${msg}`);
  }
  const data = await res.json();
  const textOut = data?.choices?.[0]?.message?.content;
  if (!textOut) throw new Error('OpenAI did not return expected content.');
  return String(textOut).trim();
}

async function translateWithOpenRouter(text, apiKey, targetLanguage = 'en') {
  const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  const body = {
    model: 'openai/gpt-4o-mini',
    messages: [
      { role: 'system', content: `You are a translation engine. Translate user text to ${targetLanguage}. Return only the translated text.` },
      { role: 'user', content: text },
    ],
    temperature: 0.2,
  };
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'X-Title': 'FF Readwise Translator',
    'HTTP-Referer': 'https://readwise.io',
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`OpenRouter API error: ${res.status} ${msg}`);
  }
  const data = await res.json();
  const textOut = data?.choices?.[0]?.message?.content;
  if (!textOut) throw new Error('OpenRouter did not return expected content.');
  return String(textOut).trim();
}

async function translateWithProvider(text, provider, apiKey, targetLanguage) {
  if (provider === 'gemini') return translateWithGemini(text, apiKey, targetLanguage);
  if (provider === 'openai') return translateWithOpenAI(text, apiKey, targetLanguage);
  if (provider === 'openrouter') return translateWithOpenRouter(text, apiKey, targetLanguage);
  throw new Error(`Unsupported provider: ${provider}`);
}

// Message relay so content scripts can avoid CORS issues (Chrome MV3)
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'rw.translate') return;
    (async () => {
      try {
        const { text, provider, apiKey, targetLanguage } = msg;
        const out = await translateWithProvider(text, provider, apiKey, targetLanguage);
        sendResponse({ ok: true, text: out });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true; // keep the channel open for async response
  });
} catch (_) {}
