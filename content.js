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
  const BULK_BUTTON_ID = 'rw-translate-all-btn';
  const SAVE_ALL_BUTTON_ID = 'rw-save-all-btn';
  const BULK_WRAPPER_CLASS = 'rw-translate-bulk-wrapper';
  const BULK_TARGET_SELECTOR = '.list-book-metadata';
  const TRANSLATED_MARKER = 'rwTranslated';
  const WAIT_TIMEOUT_MS = 4000;
  const WAIT_INTERVAL_MS = 120;
  const FULL_SCROLL_MAX_ITERATIONS = 40;
  const FULL_SCROLL_STABLE_ROUNDS = 3;
  const FULL_SCROLL_DELAY_MS = 250;
  // Support bookreview, dailyreview, and reviews/review detail containers
  const CONTAINER_SELECTOR = '.highlights-white-container.highlight-detail-list, .highlights-white-container.highlight-detail-review';
  const CONTAINER_ROOT_SELECTOR = '.highlights-white-container';
  const SCAN_INTERVAL_MS = 1500; // periodic safety scan
  const ACTIONS_SELECTOR = '.highlight-top-bar .edit-highlight-area .highlight-top-bar-actions';
  const EDITABLE_SELECTOR = '.highlight-text.editing-text';
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

  function log() {
    // Lightweight namespaced logger
    // console.debug('[RW-TR]', ...arguments);
  }

  async function getSettings() {
    try {
      const result = await storage.get([
        'provider',
        'targetLanguage',
        'geminiApiKey',
        'openrouterApiKey',
        'openaiApiKey',
        'geminiModel',
        'openrouterModel',
        'openaiModel',
        'translationPrompt',
      ]);

      const provider = result?.provider || 'gemini';
      const targetLanguage = result?.targetLanguage || 'en';
      const keyMap = {
        gemini: result?.geminiApiKey || '',
        openrouter: result?.openrouterApiKey || '',
        openai: result?.openaiApiKey || '',
      };
      let apiKey = keyMap[provider] || '';
      // Provider-default models with override from storage
      const defaultModels = {
        gemini: 'gemini-1.5-flash',
        openrouter: 'openai/gpt-4o-mini',
        openai: 'gpt-4o-mini',
      };
      const modelMap = {
        gemini: result?.geminiModel || defaultModels.gemini,
        openrouter: result?.openrouterModel || defaultModels.openrouter,
        openai: result?.openaiModel || defaultModels.openai,
      };
      const model = modelMap[provider];
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
      const promptTemplate = normalizePromptTemplate(result?.translationPrompt);
      return { provider, apiKey, targetLanguage, model, promptTemplate };
    } catch (e) {
      throw e;
    }
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
    return textOut.trim();
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
    const { provider, apiKey, targetLanguage, model, promptTemplate } = settings;
    // Prefer background relay to avoid CORS issues (Chrome MV3)
    try {
      if (chrome?.runtime?.sendMessage) {
        const res = await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage(
              { type: 'rw.translate', text, provider, apiKey, targetLanguage, model, promptTemplate },
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
    if (provider === 'gemini') return translateWithGemini(text, apiKey, targetLanguage, model, promptTemplate);
    if (provider === 'openai') return translateWithOpenAI(text, apiKey, targetLanguage, model, promptTemplate);
    if (provider === 'openrouter') return translateWithOpenRouter(text, apiKey, targetLanguage, model, promptTemplate);
    throw new Error(`Unsupported provider: ${provider}`);
  }

  function setEditableText(editable, newText) {
    // Update contenteditable and notify any listeners (React, etc.)
    editable.focus();
    editable.textContent = newText;
    const inputEvt = new InputEvent('input', { bubbles: true, cancelable: true });
    editable.dispatchEvent(inputEvt);

    // Mark the container as translated
    const container = editable.closest(CONTAINER_ROOT_SELECTOR);
    if (container) {
      container.dataset[TRANSLATED_MARKER] = '1';
      // Update Save All button visibility
      setTimeout(() => updateSaveAllButtonVisibility(), 100);
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForElement(getter, timeout = WAIT_TIMEOUT_MS, interval = WAIT_INTERVAL_MS) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const value = getter();
        if (value) return value;
      } catch (_) { }
      await delay(interval);
    }
    return null;
  }

  async function ensureAllHighlightsLoaded(updateStatus) {
    if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') return;
    let stableRounds = 0;
    let lastCount = -1;
    let lastHeight = -1;

    for (let i = 0; i < FULL_SCROLL_MAX_ITERATIONS; i++) {
      const body = document?.body;
      const target = body ? body.scrollHeight : 0;
      window.scrollTo(0, target);
      await delay(FULL_SCROLL_DELAY_MS);

      const count = document.querySelectorAll(CONTAINER_SELECTOR).length;
      const height = body ? body.scrollHeight : 0;

      if (typeof updateStatus === 'function') {
        try {
          updateStatus(count, i);
        } catch (_) { }
      }

      if (count === lastCount && height === lastHeight) {
        stableRounds += 1;
        if (stableRounds >= FULL_SCROLL_STABLE_ROUNDS) break;
      } else {
        stableRounds = 0;
        lastCount = count;
        lastHeight = height;
      }
    }

    await delay(FULL_SCROLL_DELAY_MS);
    window.scrollTo(0, 0);
    await delay(200);
  }

  function triggerEditMode(container) {
    const labels = Array.from(container.querySelectorAll('.icon-column .icon-label'));
    const editLabel = labels.find((label) => (label.textContent || '').trim().toLowerCase() === 'edit');
    let clickable = null;
    if (editLabel) {
      const parent = editLabel.closest('.icon-parent');
      if (parent) {
        clickable = parent.querySelector('button, [role="button"], img, svg') || parent;
      }
    }
    if (!clickable) {
      clickable = container.querySelector('.icon-column .icon-parent img[src*="note"], .icon-column .icon-parent svg[src*="note"]');
      if (clickable && clickable.closest) {
        const parent = clickable.closest('.icon-parent');
        if (parent) clickable = parent;
      }
    }
    if (!clickable || !(clickable instanceof HTMLElement)) return false;
    try {
      clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    } catch (e) {
      log('triggerEditMode error', e);
      return false;
    }
  }

  function createButton(langLabel) {
    const btn = document.createElement('button');
    btn.textContent = `Translate (${(langLabel || 'EN').toUpperCase()})`;
    btn.className = `button ${BUTTON_CLASS}`;
    btn.style.marginLeft = '8px';
    btn.title = 'Translate to the target language';
    return btn;
  }

  function createBulkButton() {
    const btn = document.createElement('button');
    btn.id = BULK_BUTTON_ID;
    btn.className = 'button is-small is-primary';
    btn.textContent = 'Edit All Highlights';
    btn.title = 'Open every highlight on this page in edit mode';
    return btn;
  }

  function createSaveAllButton() {
    const btn = document.createElement('button');
    btn.id = SAVE_ALL_BUTTON_ID;
    btn.className = 'button is-small is-success';
    btn.textContent = 'Save All Translated';
    btn.title = 'Save all translated highlights';
    return btn;
  }

  function updateSaveAllButtonVisibility() {
    const saveBtn = document.getElementById(SAVE_ALL_BUTTON_ID);
    if (!saveBtn) return;

    // Check if there are any translated highlights in edit mode
    const containers = Array.from(document.querySelectorAll(CONTAINER_SELECTOR));
    const hasTranslatedEditable = containers.some(container => {
      const editable = container.querySelector(EDITABLE_SELECTOR) || container.querySelector('[contenteditable="true"]');
      const isTranslated = container.dataset[TRANSLATED_MARKER] === '1';
      return editable !== null && isTranslated;
    });

    saveBtn.style.display = hasTranslatedEditable ? '' : 'none';
  }

  async function bulkEnterEditMode(btn) {
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Loading all highlights...';

    await ensureAllHighlightsLoaded((count, i) => {
      btn.textContent = `Loading... (${count} highlights found, scroll ${i})`;
    });

    const containers = Array.from(document.querySelectorAll(CONTAINER_SELECTOR));
    if (!containers.length) {
      alert('No highlights found to edit.');
      btn.textContent = originalLabel;
      btn.disabled = false;
      return;
    }

    btn.textContent = 'Opening editors...';

    const total = containers.length;
    let processed = 0;
    let opened = 0;
    let failures = 0;
    const pending = [];

    for (const container of containers) {
      processed += 1;
      try {
        const editable = container.querySelector(EDITABLE_SELECTOR) || container.querySelector('[contenteditable="true"]');
        if (editable) {
          opened += 1;
        } else if (triggerEditMode(container)) {
          pending.push(
            waitForElement(
              () => container.querySelector(EDITABLE_SELECTOR) || container.querySelector('[contenteditable="true"]'),
              WAIT_TIMEOUT_MS * 3,
              WAIT_INTERVAL_MS
            )
          );
        } else {
          failures += 1;
        }
      } catch (err) {
        console.error('Bulk edit error', err);
        failures += 1;
      }
      btn.textContent = `Opening editors... (${processed}/${total})`;
      await delay(40);
    }

    if (pending.length) {
      btn.textContent = 'Finalizing editors...';
      const results = await Promise.all(pending.map((promise) => promise.catch(() => null)));
      results.forEach((editable) => {
        if (editable) opened += 1;
        else failures += 1;
      });
    }

    btn.textContent = originalLabel;
    btn.disabled = false;

    if (failures) {
      console.warn(`Edit mode activated for ${opened} highlight(s). ${failures} highlight(s) may need manual opening.`);
    } else {
      console.log(`All ${opened} highlight(s) are now in edit mode.`);
    }
  }

  function triggerSaveMode(container) {
    // First try: Look for the Save button in the actions area
    const saveButton = container.querySelector('.highlight-top-bar-actions .button:not(.rw-translate-btn)');
    if (saveButton && saveButton.textContent && saveButton.textContent.toLowerCase().includes('save')) {
      try {
        saveButton.click();
        return true;
      } catch (e) {
        log('triggerSaveMode save button error', e);
      }
    }

    // Second try: Look for check/save icon in icon column
    const labels = Array.from(container.querySelectorAll('.icon-column .icon-label'));
    const saveLabel = labels.find((label) => {
      const text = (label.textContent || '').trim().toLowerCase();
      return text === 'save' || text === 'check' || text === 'done';
    });

    if (saveLabel) {
      const parent = saveLabel.closest('.icon-parent');
      if (parent) {
        try {
          parent.click();
          return true;
        } catch (e) {
          log('triggerSaveMode icon parent error', e);
        }
      }
    }

    // Third try: Look for check icon directly
    const checkIcon = container.querySelector('.icon-column .icon-parent img[src*="check"], .icon-column .icon-parent svg[data-icon*="check"]');
    if (checkIcon) {
      const parent = checkIcon.closest('.icon-parent');
      if (parent) {
        try {
          parent.click();
          return true;
        } catch (e) {
          log('triggerSaveMode check icon error', e);
        }
      }
    }

    // Fourth try: Press Escape to exit edit mode (this often saves)
    const editable = container.querySelector(EDITABLE_SELECTOR) || container.querySelector('[contenteditable="true"]');
    if (editable) {
      try {
        editable.focus();
        const escapeEvent = new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true
        });
        editable.dispatchEvent(escapeEvent);
        return true;
      } catch (e) {
        log('triggerSaveMode escape error', e);
      }
    }

    // Final fallback: try pressing Enter
    if (editable) {
      try {
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        });
        editable.dispatchEvent(enterEvent);
        return true;
      } catch (e) {
        log('triggerSaveMode enter fallback error', e);
      }
    }

    return false;
  }

  async function bulkSaveAll(btn) {
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Saving...';

    // Find all containers that are currently in edit mode AND have been translated
    const containers = Array.from(document.querySelectorAll(CONTAINER_SELECTOR));
    const translatedEditableContainers = containers.filter(container => {
      const editable = container.querySelector(EDITABLE_SELECTOR) || container.querySelector('[contenteditable="true"]');
      const isTranslated = container.dataset[TRANSLATED_MARKER] === '1';
      return editable !== null && isTranslated;
    });

    if (!translatedEditableContainers.length) {
      alert('No translated highlights found to save. Use the Translate button first.');
      btn.textContent = originalLabel;
      btn.disabled = false;
      return;
    }

    const total = translatedEditableContainers.length;
    let processed = 0;
    let saved = 0;
    let failures = 0;

    for (const container of translatedEditableContainers) {
      processed += 1;
      try {
        if (triggerSaveMode(container)) {
          saved += 1;
          // Remove the translated marker after successful save
          delete container.dataset[TRANSLATED_MARKER];
        } else {
          failures += 1;
        }
      } catch (err) {
        console.error('Bulk save error', err);
        failures += 1;
      }

      btn.textContent = `Saving... (${processed}/${total})`;
      await delay(200); // Slightly longer delay to ensure save completes
    }

    btn.textContent = originalLabel;
    btn.disabled = false;

    if (failures > 0) {
      alert(`Saved ${saved} translated highlight(s). ${failures} highlight(s) could not be saved automatically - please save them manually.`);
    }
  }

  function attachBulkButton() {
    try {
      if (document.getElementById(BULK_BUTTON_ID)) return;
      const target = document.querySelector(BULK_TARGET_SELECTOR) || document.querySelector('.main-list-column');
      if (!target) return;

      let wrapper = target.querySelector(`.${BULK_WRAPPER_CLASS}`);
      if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = BULK_WRAPPER_CLASS;
        wrapper.style.marginTop = '0.5rem';
        wrapper.style.display = 'flex';
        wrapper.style.justifyContent = 'flex-end';
        wrapper.style.flexWrap = 'wrap';
        wrapper.style.gap = '8px';
        target.appendChild(wrapper);
      }

      // Create and add Edit All button
      const editBtn = createBulkButton();
      editBtn.addEventListener('click', () => {
        if (!editBtn.disabled) {
          bulkEnterEditMode(editBtn);
        }
      });
      wrapper.appendChild(editBtn);

      // Create and add Save All button
      const saveBtn = createSaveAllButton();
      saveBtn.style.display = 'none'; // Initially hidden
      saveBtn.addEventListener('click', () => {
        if (!saveBtn.disabled) {
          bulkSaveAll(saveBtn);
        }
      });
      wrapper.appendChild(saveBtn);
    } catch (e) {
      log('attachBulkButton error', e);
    }
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
      } catch (_) { }

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
    attachBulkButton();
    document.querySelectorAll(CONTAINER_SELECTOR).forEach((el) => {
      // attachButton is async; don't await to avoid blocking mutation observer
      attachButton(el);
    });
    // Update Save All button visibility
    updateSaveAllButtonVisibility();
  }

  // Initial scan
  attachBulkButton();
  scan();

  // Observe DOM changes to handle dynamically loaded highlights
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.(BULK_TARGET_SELECTOR) || node.querySelector?.(BULK_TARGET_SELECTOR)) {
            attachBulkButton();
          }
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
      } else if (m.type === 'attributes' && m.attributeName === 'class') {
        const el = m.target;
        if (!(el instanceof HTMLElement)) continue;
        // If a container's visibility or state toggled, try attaching again
        if (el.matches(CONTAINER_SELECTOR)) {
          attachButton(el);
        } else if (el.matches(ACTIONS_SELECTOR)) {
          const container = el.closest(CONTAINER_ROOT_SELECTOR);
          if (container) attachButton(container);
        }
      }
    }
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
    subtree: true,
  });

  // Periodic scan as a fallback for SPA updates or non-childList changes
  setInterval(scan, SCAN_INTERVAL_MS);

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
  } catch (_) { }

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
    } catch (_) { }
  }, true);
})();
