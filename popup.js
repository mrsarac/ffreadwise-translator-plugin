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
  const modelSelect = document.getElementById('modelSelect');
  const modelCustom = document.getElementById('modelCustom');
  const lang = document.getElementById('language');
  const provider = document.getElementById('provider');
  const btn = document.getElementById('save');
  const delBtn = document.getElementById('deleteKey');
  const apiKeyLabel = document.getElementById('apiKeyLabel');
  const modelLabel = document.getElementById('modelLabel');
  const msgBox = document.getElementById('msg');
  const apiKeyHint = document.getElementById('apiKeyHint');
  const modelHint = document.getElementById('modelHint');

  const PROVIDER_KEYS = {
    gemini: 'geminiApiKey',
    openrouter: 'openrouterApiKey',
    openai: 'openaiApiKey',
  };
  const PROVIDER_MODELS = {
    gemini: 'geminiModel',
    openrouter: 'openrouterModel',
    openai: 'openaiModel',
  };
  const DEFAULT_MODELS = {
    gemini: 'gemini-1.5-flash',
    openrouter: 'openai/gpt-4o-mini',
    openai: 'gpt-4o-mini',
  };

  // Provider info: API key and model links
  const PROVIDER_INFO = {
    gemini: {
      apiKey: { url: 'https://aistudio.google.com/app/apikey', text: 'Get a Gemini API key' },
      models: { url: 'https://ai.google.dev/models/gemini', text: 'Gemini model overview' },
    },
    openai: {
      apiKey: { url: 'https://platform.openai.com/api-keys', text: 'Create an OpenAI API key' },
      models: { url: 'https://platform.openai.com/docs/models', text: 'OpenAI models documentation' },
    },
    openrouter: {
      apiKey: { url: 'https://openrouter.ai/keys', text: 'Create an OpenRouter API key' },
      models: { url: 'https://openrouter.ai/models', text: 'OpenRouter model catalog' },
    },
  };

  // Curated model lists per provider
  const MODELS = {
    gemini: [
      { id: 'gemini-1.5-flash', label: 'gemini-1.5-flash (default)', link: 'https://ai.google.dev/models/gemini#gemini-1-5', desc: 'Fast, cost-efficient 1.5 family; good for general translation.' },
      { id: 'gemini-1.5-pro', label: 'gemini-1.5-pro', link: 'https://ai.google.dev/models/gemini#gemini-1-5', desc: 'More capable than Flash; higher quality and cost.' },
    ],
    openai: [
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini (default)', link: 'https://platform.openai.com/docs/models#gpt-4o-mini', desc: 'Fast, lower-cost 4o variant; strong quality/cost balance.' },
      { id: 'gpt-4o', label: 'gpt-4o', link: 'https://platform.openai.com/docs/models#gpt-4o', desc: 'High-quality 4o; better accuracy, higher cost.' },
    ],
    openrouter: [
      { id: 'openai/gpt-4o-mini', label: 'openai/gpt-4o-mini (default)', link: 'https://openrouter.ai/models/openai/gpt-4o-mini', desc: 'OpenAI 4o-mini via OpenRouter.' },
      { id: 'anthropic/claude-3-haiku', label: 'anthropic/claude-3-haiku', link: 'https://openrouter.ai/models/anthropic/claude-3-haiku', desc: 'Fast, cost-effective Claude 3; good for translation.' },
    ],
  };

  function renderApiKeyHint() {
    const p = provider.value;
    const info = PROVIDER_INFO[p]?.apiKey;
    const extra = PROVIDER_INFO[p]?.models;
    if (!apiKeyHint) return;
    if (info) {
      apiKeyHint.innerHTML = `API key help: <a href="${info.url}" target="_blank" rel="noopener noreferrer">${info.text}</a>`;
    } else {
      apiKeyHint.textContent = '';
    }
  }

  function renderModelHint() {
    const p = provider.value;
    const selected = modelSelect.value;
    const modelsEntry = PROVIDER_INFO[p]?.models;
    if (!modelHint) return;
    let details = '';
    if (modelsEntry) {
      details += `Models: <a href="${modelsEntry.url}" target="_blank" rel="noopener noreferrer">${modelsEntry.text}</a>`;
    }
    const list = MODELS[p] || [];
    const found = list.find(m => m.id === selected);
    if (selected === '__custom__') {
      const customVal = modelCustom.value.trim();
      if (customVal) {
        details += `<br/>Selected: <code>${customVal}</code>`;
      } else {
        details += `<br/>Selected: <em>Custom (enter a model ID)</em>`;
      }
    } else if (found) {
      if (found.link) details += `<br/>Selected: <a href="${found.link}" target="_blank" rel="noopener noreferrer"><code>${found.id}</code></a>`;
      else details += `<br/>Selected: <code>${found.id}</code>`;
      if (found.desc) details += ` — ${found.desc}`;
    }
    modelHint.innerHTML = details;
  }

  function populateModelOptions() {
    const p = provider.value;
    const defaults = MODELS[p] || [];
    modelSelect.innerHTML = '';
    // Add curated options
    for (const m of defaults) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label || m.id;
      modelSelect.appendChild(opt);
    }
    // Add custom option
    const optCustom = document.createElement('option');
    optCustom.value = '__custom__';
    optCustom.textContent = 'Custom…';
    modelSelect.appendChild(optCustom);
  }

  function updateKeyLabel() {
    const p = provider.value;
    if (p === 'gemini') apiKeyLabel.textContent = 'Gemini API Key';
    else if (p === 'openrouter') apiKeyLabel.textContent = 'OpenRouter API Key';
    else apiKeyLabel.textContent = 'OpenAI API Key';
    modelLabel.textContent = 'Model (' + (DEFAULT_MODELS[p] || 'override') + ')';
    renderApiKeyHint();
  }

  async function loadForProvider() {
    updateKeyLabel();
    const keyName = PROVIDER_KEYS[provider.value];
    const modelName = PROVIDER_MODELS[provider.value];
    populateModelOptions();
    const stored = await storage.get([keyName, modelName]);
    input.value = stored?.[keyName] || '';
    const storedModel = stored?.[modelName] || '';
    const list = MODELS[provider.value] || [];
    const exists = list.some(m => m.id === storedModel);
    if (storedModel && exists) {
      modelSelect.value = storedModel;
      modelCustom.style.display = 'none';
    } else if (storedModel && !exists) {
      modelSelect.value = '__custom__';
      modelCustom.style.display = '';
      modelCustom.value = storedModel;
    } else {
      // No stored model → select default
      modelSelect.value = (DEFAULT_MODELS[provider.value] || (list[0]?.id) || '__custom__');
      if (modelSelect.value === '__custom__') modelCustom.style.display = '';
      else modelCustom.style.display = 'none';
      modelCustom.value = '';
    }
    renderModelHint();
  }

  try {
    const stored = await storage.get([
      'provider',
      'targetLanguage',
      'geminiApiKey',
      'openrouterApiKey',
      'openaiApiKey',
      'geminiModel',
      'openrouterModel',
      'openaiModel',
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

  modelSelect.addEventListener('change', () => {
    const isCustom = modelSelect.value === '__custom__';
    modelCustom.style.display = isCustom ? '' : 'none';
    renderModelHint();
  });

  modelCustom.addEventListener('input', () => {
    renderModelHint();
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
    const modelName = PROVIDER_MODELS[provider.value];
    if (!apiKey) {
      showMsg('Please enter a valid API key.', 'error');
      return;
    }
    try {
      const selected = modelSelect.value;
      const modelVal = selected === '__custom__' ? (modelCustom.value || '').trim() : selected;
      const toSave = { [keyName]: apiKey, targetLanguage, provider: provider.value };
      await storage.set(toSave);
      if (modelVal) {
        await storage.set({ [modelName]: modelVal });
      } else {
        // no model provided → revert to default by removing stored override
        await storage.remove([modelName]);
      }
      showMsg('Saved.', 'success');
    } catch (e) {
      console.error('Storage set error', e);
      showMsg('Could not save.', 'error');
    }
  });

  delBtn.addEventListener('click', async () => {
    const keyName = PROVIDER_KEYS[provider.value];
    const modelName = PROVIDER_MODELS[provider.value];
    try {
      await storage.remove([keyName, modelName]);
      input.value = '';
      // reset model selection to default
      populateModelOptions();
      modelSelect.value = DEFAULT_MODELS[provider.value] || (MODELS[provider.value]?.[0]?.id) || '__custom__';
      modelCustom.value = '';
      modelCustom.style.display = modelSelect.value === '__custom__' ? '' : 'none';
      renderModelHint();
      showMsg('Key deleted.', 'success');
    } catch (e) {
      console.error('Storage remove error', e);
      showMsg('Could not delete key.', 'error');
    }
  });
});
