(() => {
  function storageAPI() {
    const hasBrowser = typeof browser !== 'undefined' && browser?.storage?.local;
    const api = hasBrowser ? browser.storage.local : (chrome?.storage?.local);
    function promisify(method) {
      if (!api || typeof api[method] !== 'function') {
        return () => Promise.reject(new Error('storage API unavailable'));
      }
      if (hasBrowser || api[method].length <= 1) {
        return (...args) => api[method](...args);
      }
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

  const storage = storageAPI();

  const BUTTON_CLASS = 'rw-translate-btn';
  // Support both book review and daily review detail containers
  const CONTAINER_SELECTOR = '.highlights-white-container.highlight-detail-list, .highlights-white-container.highlight-detail-review';
  const CONTAINER_ROOT_SELECTOR = '.highlights-white-container';
  const ACTIONS_SELECTOR = '.highlight-top-bar .edit-highlight-area .highlight-top-bar-actions';
  const EDITABLE_SELECTOR = '.highlight-text.editing-text';

  function log(...args) {
    // Lightweight namespaced logger
    // console.debug('[RW-TR]', ...args);
  }

  async function getSettings() {
    try {
      const result = await storage.get([
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
          await storage.set(saveObj);
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
    // Prefer background relay to avoid CORS issues (Chrome MV3)
    try {
      if (chrome?.runtime?.sendMessage) {
        const res = await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage(
              { type: 'rw.translate', text, provider, apiKey, targetLanguage },
              (response) => resolve(response)
            );
          } catch (e) {
            resolve(null);
          }
        });
        if (res && typeof res === 'object') {
          if (res.ok) return res.text;
          if (res.ok === false && res.error) throw new Error(res.error);
        }
      }
    } catch (_) {
      // Fallback to direct fetch below
    }

    // Fallback: direct fetch from content script
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
        const { targetLanguage } = await storage.get(['targetLanguage']);
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
          } else if (node.matches?.(ACTIONS_SELECTOR)) {
            // Actions area appeared after entering edit mode; attach to its container
            const container = node.closest(CONTAINER_ROOT_SELECTOR);
            if (container) attachButton(container);
          } else if (node.querySelector?.(ACTIONS_SELECTOR)) {
            node.querySelectorAll(ACTIONS_SELECTOR).forEach((act) => {
              const container = act.closest(CONTAINER_ROOT_SELECTOR);
              if (container) attachButton(container);
            });
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
    (browser?.storage?.onChanged || chrome?.storage?.onChanged)?.addListener((changes, area) => {
      if (area !== 'local' || !changes.targetLanguage) return;
      const newLang = String(changes.targetLanguage.newValue || 'en').toUpperCase();
      document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((btn) => {
        if (btn && btn.textContent) {
          btn.textContent = `Translate (${newLang})`;
        }
      });
    });
  } catch (_) {}

  // Make the "Edit" label act like the Edit icon (open edit area)
  // Some parts of the page only bind click on the icon, not the label.
  // We delegate to capture clicks on the label and forward to the icon/parent.
  document.addEventListener('click', (evt) => {
    const target = evt.target;
    if (!(target instanceof HTMLElement)) return;

    // Find a label within icon area
    const labelEl = target.closest('.icon-label');
    if (!labelEl) return;

    const labelText = (labelEl.textContent || '').trim().toLowerCase();
    let isEdit = labelText === 'edit';
    // Fallback for localized UI: identify the Edit item by its icon (note.svg)
    if (!isEdit) {
      const p = labelEl.closest('.icon-parent');
      if (p && p.querySelector('img[src*="note."]')) isEdit = true;
    }
    if (!isEdit) return;

    const iconParent = labelEl.closest('.icon-parent');
    if (!iconParent) return;

    // Prefer clicking an interactive child (img/button/svg), else the parent itself
    const clickable = iconParent.querySelector('button, [role="button"], img, svg');
    const toClick = clickable || iconParent;

    // Avoid recursion if our synthetic click bubbles back
    if (toClick.dataset && toClick.dataset.rwSyntheticClick === '1') return;
    try {
      if (toClick instanceof HTMLElement) {
        toClick.dataset.rwSyntheticClick = '1';
        toClick.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        // Clean up the marker shortly after to allow future clicks
        setTimeout(() => {
          if (toClick.dataset) delete toClick.dataset.rwSyntheticClick;
        }, 0);
      }
    } catch (_) {}
  }, true);
})();
