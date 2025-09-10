document.addEventListener('DOMContentLoaded', async () => {
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
    const stored = await chrome.storage.local.get([keyName]);
    input.value = stored?.[keyName] || '';
  }

  try {
    const stored = await chrome.storage.local.get([
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
    await chrome.storage.local.set({ provider: provider.value });
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
      await chrome.storage.local.set({ [keyName]: apiKey, targetLanguage, provider: provider.value });
      showMsg('Saved.', 'success');
    } catch (e) {
      console.error('Storage set error', e);
      showMsg('Could not save.', 'error');
    }
  });

  delBtn.addEventListener('click', async () => {
    const keyName = PROVIDER_KEYS[provider.value];
    try {
      await chrome.storage.local.remove([keyName]);
      input.value = '';
      showMsg('Key deleted.', 'success');
    } catch (e) {
      console.error('Storage remove error', e);
      showMsg('Could not delete key.', 'error');
    }
  });
});
