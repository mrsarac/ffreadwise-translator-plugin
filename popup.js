function storageAPI() {
  const hasBrowser = typeof browser !== 'undefined' && browser?.storage?.local;
  const api = hasBrowser ? browser.storage.local : (chrome?.storage?.local);
  function promisify(method) {
    if (!api || typeof api[method] !== 'function') {
      return () => Promise.reject(new Error('storage API unavailable'));
    }
    // If Promise-based (Firefox browser.* or chrome with promise support)
    if (hasBrowser || api[method].length <= 1) {
      return (...args) => api[method](...args);
    }
    // Callback-based (older chrome alias)
    return (...args) => new Promise((resolve, reject) => {
      api[method](...args, (res) => {
        const err = (chrome && chrome.runtime && chrome.runtime.lastError) ? chrome.runtime.lastError : null;
        if (err) reject(err);
        else resolve(res);
      });
    });
  }
  return {
    get: promisify('get'),
    set: promisify('set'),
    remove: promisify('remove'),
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const storage = storageAPI();
  const input = document.getElementById('apiKey');
  const lang = document.getElementById('language');
  const provider = document.getElementById('provider');
  const btn = document.getElementById('save');
  const delBtn = document.getElementById('deleteKey');
  const apiKeyLabel = document.getElementById('apiKeyLabel');
  const msgBox = document.getElementById('msg');

  const PROVIDER_KEYS = {
    gemini: 'geminiApiKey',
    openrouter: 'openrouterApiKey',
    openai: 'openaiApiKey',
  };

  function updateKeyLabel() {
    const p = provider.value;
    if (p === 'gemini') apiKeyLabel.textContent = 'Gemini API Key';
    else if (p === 'openrouter') apiKeyLabel.textContent = 'OpenRouter API Key';
    else apiKeyLabel.textContent = 'OpenAI API Key';
  }

  async function loadForProvider() {
    updateKeyLabel();
    const keyName = PROVIDER_KEYS[provider.value];
    const stored = await storage.get([keyName]);
    input.value = stored?.[keyName] || '';
  }

  try {
    const stored = await storage.get([
      'provider',
      'targetLanguage',
      'geminiApiKey',
      'openrouterApiKey',
      'openaiApiKey',
    ]);
    provider.value = stored?.provider || 'gemini';
    if (stored?.targetLanguage) lang.value = stored.targetLanguage;
    await loadForProvider();
  } catch (e) {
    console.error('Storage get error', e);
  }

  provider.addEventListener('change', async () => {
    await storage.set({ provider: provider.value });
    await loadForProvider();
  });

  function showMsg(text, type = 'success', timeout = 1800) {
    if (!msgBox) return;
    msgBox.textContent = text;
    msgBox.className = `msg show ${type}`;
    if (timeout) {
      setTimeout(() => {
        msgBox.className = 'msg';
        msgBox.textContent = '';
      }, timeout);
    }
  }

  btn.addEventListener('click', async () => {
    const apiKey = input.value.trim();
    const targetLanguage = (lang.value || '').trim().toLowerCase() || 'en';
    const keyName = PROVIDER_KEYS[provider.value];
    if (!apiKey) {
      showMsg('Please enter a valid API key.', 'error');
      return;
    }
    try {
      await storage.set({ [keyName]: apiKey, targetLanguage, provider: provider.value });
      showMsg('Saved.', 'success');
    } catch (e) {
      console.error('Storage set error', e);
      showMsg('Could not save.', 'error');
    }
  });

  delBtn.addEventListener('click', async () => {
    const keyName = PROVIDER_KEYS[provider.value];
    try {
      await storage.remove([keyName]);
      input.value = '';
      showMsg('Key deleted.', 'success');
    } catch (e) {
      console.error('Storage remove error', e);
      showMsg('Could not delete key.', 'error');
    }
  });
});
