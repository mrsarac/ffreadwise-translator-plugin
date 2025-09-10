(() => {
  const TARGET_PREFIX = 'https://readwise.io/bookreview/';
  if (!location.href.startsWith(TARGET_PREFIX)) return;

  const BUTTON_CLASS = 'rw-translate-btn';
  const CONTAINER_SELECTOR = '.highlights-white-container.highlight-detail-list';
  const ACTIONS_SELECTOR = '.highlight-top-bar .edit-highlight-area .highlight-top-bar-actions';
  const EDITABLE_SELECTOR = '.highlight-text.editing-text';

  function log(...args) {
    // Lightweight namespaced logger
    // console.debug('[RW-TR]', ...args);
  }

  async function getSettings() {
    try {
      const result = await chrome.storage.local.get([
        'provider',
        'targetLanguage',
        'geminiApiKey',
        'openrouterApiKey',
        'openaiApiKey',
      ]);

      const provider = result?.provider || 'gemini';
      const targetLanguage = result?.targetLanguage || 'en';
      const keyMap = {
        gemini: result?.geminiApiKey || '',
        openrouter: result?.openrouterApiKey || '',
        openai: result?.openaiApiKey || '',
      };
      let apiKey = keyMap[provider] || '';
      if (!apiKey) {
        apiKey = prompt(`Enter ${provider} API key (stored locally):`) || '';
        if (apiKey.trim()) {
          const saveObj = {};
          if (provider === 'gemini') saveObj.geminiApiKey = apiKey.trim();
          if (provider === 'openrouter') saveObj.openrouterApiKey = apiKey.trim();
          if (provider === 'openai') saveObj.openaiApiKey = apiKey.trim();
          await chrome.storage.local.set(saveObj);
        } else {
          throw new Error(`${provider} API key is required.`);
        }
      }
      return { provider, apiKey, targetLanguage };
    } catch (e) {
      throw e;
    }
  }

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
    return textOut.trim();
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
      'HTTP-Referer': location.origin,
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

  async function translateWithProvider(text, settings) {
    const { provider, apiKey, targetLanguage } = settings;
    if (provider === 'gemini') return translateWithGemini(text, apiKey, targetLanguage);
    if (provider === 'openai') return translateWithOpenAI(text, apiKey, targetLanguage);
    if (provider === 'openrouter') return translateWithOpenRouter(text, apiKey, targetLanguage);
    throw new Error(`Unsupported provider: ${provider}`);
  }

  function setEditableText(editable, newText) {
    // Update contenteditable and notify any listeners (React, etc.)
    editable.focus();
    editable.textContent = newText;
    const inputEvt = new InputEvent('input', { bubbles: true, cancelable: true });
    editable.dispatchEvent(inputEvt);
  }

  function createButton(langLabel) {
    const btn = document.createElement('button');
    btn.textContent = `Translate (${(langLabel || 'EN').toUpperCase()})`;
    btn.className = `button ${BUTTON_CLASS}`;
    btn.style.marginLeft = '8px';
    btn.title = 'Translate to the target language';
    return btn;
  }

  async function attachButton(container) {
    try {
      if (!container || container.dataset.rwTranslateAttached === '1') return;
      const actions = container.querySelector(ACTIONS_SELECTOR) || container.querySelector('.highlight-top-bar-actions');
      if (!actions) return;
      if (actions.querySelector(`.${BUTTON_CLASS}`)) return;

      // Read target language for label
      let lang = 'en';
      try {
        const { targetLanguage } = await chrome.storage.local.get(['targetLanguage']);
        if (targetLanguage) lang = String(targetLanguage).toLowerCase();
      } catch (_) {}

      const btn = createButton(lang);
      actions.appendChild(btn);

      btn.addEventListener('click', async () => {
        const editable = container.querySelector(EDITABLE_SELECTOR) || container.querySelector('[contenteditable="true"]');
        if (!editable) {
          alert('Editable text field not found.');
          return;
        }
        const original = (editable.innerText || editable.textContent || '').trim();
        if (!original) {
          alert('Nothing to translate.');
          return;
        }

        btn.disabled = true;
        const prevLabel = btn.textContent;
        btn.textContent = 'Translating...';
        try {
          const settings = await getSettings();
          const translated = await translateWithProvider(original, settings);
          setEditableText(editable, translated);
        } catch (err) {
          console.error(err);
          alert(err?.message || 'An error occurred during translation.');
        } finally {
          btn.textContent = prevLabel;
          btn.disabled = false;
        }
      });

      container.dataset.rwTranslateAttached = '1';
    } catch (e) {
      log('attachButton error', e);
    }
  }

  function scan() {
    document.querySelectorAll(CONTAINER_SELECTOR).forEach((el) => {
      // attachButton is async; don't await to avoid blocking mutation observer
      attachButton(el);
    });
  }

  // Initial scan
  scan();

  // Observe DOM changes to handle dynamically loaded highlights
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.(CONTAINER_SELECTOR)) {
            attachButton(node);
          } else if (node.querySelector?.(CONTAINER_SELECTOR)) {
            node.querySelectorAll(CONTAINER_SELECTOR).forEach(attachButton);
          }
        });
      }
    }
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
  });

  // Update button labels if target language changes from the control panel
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.targetLanguage) return;
      const newLang = String(changes.targetLanguage.newValue || 'en').toUpperCase();
      document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((btn) => {
        if (btn && btn.textContent) {
          btn.textContent = `Translate (${newLang})`;
        }
      });
    });
  } catch (_) {}
})();
