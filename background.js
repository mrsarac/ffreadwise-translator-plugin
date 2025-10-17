// Background / Service Worker (MV2/MV3 compatible)
// Set an 'R' badge if supported by the browser
try {
  const ba = chrome?.browserAction || chrome?.action;
  if (ba?.setBadgeText) {
    ba.setBadgeBackgroundColor?.({ color: '#111827' });
    ba.setBadgeText({ text: 'R' });
  }
} catch (_) {}

const DEFAULT_TRANSLATION_PROMPT = [
  'Translate the following text to {{targetLanguage}}.',
  'Preserve meaning, tone, and basic formatting.',
  'Only return the translated {{targetLanguage}} text without comments.',
].join('\n');

function normalizePromptTemplate(value) {
  if (typeof value === 'string' && value.trim()) return value;
  return DEFAULT_TRANSLATION_PROMPT;
}

function resolvePrompt(template, targetLanguage) {
  return normalizePromptTemplate(template).replace(/\{\{\s*targetLanguage\s*\}\}/gi, targetLanguage);
}

async function translateWithGemini(text, apiKey, targetLanguage = 'en', model = 'gemini-1.5-flash', promptTemplate = DEFAULT_TRANSLATION_PROMPT) {
  const modelId = String(model || 'gemini-1.5-flash');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const instructions = resolvePrompt(promptTemplate, targetLanguage);
  const prompt = [instructions, '', text].join('\n');
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

async function translateWithOpenAI(text, apiKey, targetLanguage = 'en', model = 'gpt-4o-mini', promptTemplate = DEFAULT_TRANSLATION_PROMPT) {
  const endpoint = 'https://api.openai.com/v1/chat/completions';
  const instructions = resolvePrompt(promptTemplate, targetLanguage);
  const body = {
    model: String(model || 'gpt-4o-mini'),
    messages: [
      { role: 'system', content: instructions },
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

async function translateWithOpenRouter(text, apiKey, targetLanguage = 'en', model = 'openai/gpt-4o-mini', promptTemplate = DEFAULT_TRANSLATION_PROMPT) {
  const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  const instructions = resolvePrompt(promptTemplate, targetLanguage);
  const body = {
    model: String(model || 'openai/gpt-4o-mini'),
    messages: [
      { role: 'system', content: instructions },
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

async function translateWithProvider(text, provider, apiKey, targetLanguage, model, promptTemplate) {
  if (provider === 'gemini') return translateWithGemini(text, apiKey, targetLanguage, model, promptTemplate);
  if (provider === 'openai') return translateWithOpenAI(text, apiKey, targetLanguage, model, promptTemplate);
  if (provider === 'openrouter') return translateWithOpenRouter(text, apiKey, targetLanguage, model, promptTemplate);
  throw new Error(`Unsupported provider: ${provider}`);
}

// Message relay so content scripts can avoid CORS issues (Chrome MV3)
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'rw.translate') return;
    (async () => {
      try {
        const { text, provider, apiKey, targetLanguage, model, promptTemplate } = msg;
        const out = await translateWithProvider(text, provider, apiKey, targetLanguage, model, promptTemplate);
        sendResponse({ ok: true, text: out });
      } catch (e) {
        // Provide a helpful hint if the model looks invalid
        const hint = (e?.message || '').toLowerCase().includes('model') ? ' (Check the selected model in the extension settings.)' : '';
        sendResponse({ ok: false, error: (e?.message || String(e)) + hint });
      }
    })();
    return true; // keep the channel open for async response
  });
} catch (_) {}
