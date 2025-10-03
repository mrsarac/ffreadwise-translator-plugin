FF Readwise Translator

An open-source browser extension that adds an inline “Translate (XX)” button to Readwise highlights on `https://readwise.io/bookreview/`. Translate the editable highlight text to your preferred language using Gemini, OpenAI, or OpenRouter.

Downloads
- Latest Chrome ZIP: https://github.com/mrsarac/ffreadwise-translator-plugin/releases/latest/download/ffreadwise-translator-plugin-chrome.zip
- Latest Firefox XPI: https://github.com/mrsarac/ffreadwise-translator-plugin/releases/latest/download/ffreadwise-translator-plugin-firefox.xpi

Features
- Inline translate button on Readwise edit view
- Multiple providers: Gemini, OpenAI, OpenRouter
- Custom target language code (ISO 639-1, e.g., en, tr, de)
- Configurable model per provider with sensible defaults
- Per-provider API keys stored locally in your browser
- Small control panel opened from the toolbar button (badge “R”)

Demo
Quick demo of translating a Readwise highlight:

![FF Readwise Translator Demo](assets/usage-demo.gif)

Providers and Models
- Defaults (editable in popup):
  - Gemini: gemini-1.5-flash
  - OpenAI: gpt-4o-mini
  - OpenRouter: openai/gpt-4o-mini
  You can override these in the extension popup. If a model becomes deprecated, just update the field; no code changes needed.

Permissions
- `activeTab`, `storage`
- Host permissions:
  - `https://generativelanguage.googleapis.com/*` (Gemini)
  - `https://api.openai.com/*` (OpenAI)
  - `https://openrouter.ai/*` (OpenRouter)

Installation
Firefox (Temporary Add-on)
1. Run `npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox`
3. Click “Load Temporary Add-on…” and select `build/firefox/manifest.json`
4. You should see a toolbar button with an “R” badge

Chromium/Chrome (Unpacked)
1. Open `chrome://extensions`
2. Enable “Developer mode”
3. Click “Load unpacked” and select `build/chrome` after running the build (see below)

Usage
1. Click the toolbar button to open the control panel
2. Select Provider (Gemini, OpenRouter, or OpenAI)
3. Paste the corresponding API key
4. Optionally set the Model (leave blank to use default shown). This makes future model changes easy without code updates.
5. Enter your target language code (ISO 639-1, e.g., `en`, `tr`, `de`). A reference list is available here:
   https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes
6. Click Save
7. Go to `https://readwise.io/bookreview/` or `https://readwise.io/dailyreview`, open a highlight in edit mode
8. Click the “Translate (XX)” button next to Save; the text is translated in place

Notes
- Keys and settings are saved locally via `chrome.storage.local`
- The extension observes the DOM to attach buttons to dynamically loaded highlights
- You can delete a stored key per provider from the control panel

Development
- Dual target setup (one repo → Chrome MV3 & Firefox MV2)
  - `manifest.chrome.json`: Chrome MV3 manifest (service worker background)
  - `manifest.firefox.json`: Firefox MV2 manifest (background script)
  - `scripts/build.mjs`: Copies sources into `build/{chrome|firefox}` with correct manifest
  - `background.js`: Handles badge + translation relay via messaging
  - `popup.html` / `popup.js`: Control panel for provider, API key, and language
  - `content.js`: Injects the Translate button; requests translation via background (avoids CORS)

Build & Publish
- Prereqs: Node 18+, `zip` CLI (for packaging). `web-ext` is optional and not required by the default scripts.

Build bundles
- `npm run build`       → builds both `build/chrome` and `build/firefox`
- `npm run build:chrome` → builds only Chrome bundle
- `npm run build:firefox` → builds only Firefox bundle

Pack bundles
- Chrome zip: `npm run pack:chrome` → `dist/chrome.zip`
- Firefox XPI: `npm run pack:firefox` → `dist/ffreadwise-translator-plugin-<version>.xpi`

Notes on Firefox packaging
- The `pack:firefox` script zips `build/firefox` into an `.xpi` using the system `zip` tool; no `web-ext` install is needed.
- If `build/firefox` does not exist, run `npm run build:firefox` first.

Repo hygiene
- Do not commit build outputs: `build/` and packaged zips are ignored.
- If you self-host Firefox updates, keep only `dist/updates.json` and the signed `.xpi` you link there.
- For Chrome, upload `dist/chrome.zip` to the Web Store; do not commit it.

Automated Releases
- Tag the repository with `vX.Y.Z` (for example `v1.0.5`) or run the workflow manually.
- GitHub Actions builds and attaches download assets to the tag’s Release:
  - `ffreadwise-translator-plugin-chrome.zip`
  - `ffreadwise-translator-plugin-firefox.xpi`
- The links in the Downloads section above always point to the latest release.

Load for local testing
- Chrome: `chrome://extensions` → Load unpacked → `build/chrome`
- Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `build/firefox/manifest.json`

Store submission notes
- Chrome Web Store: MV3 is required. Icons (at least 128×128) are recommended for listing quality.
- Firefox Add-ons (AMO): If publishing on AMO, remove or ignore `update_url` under `browser_specific_settings.gecko`.
  Self-hosted updates use that field; AMO-managed updates do not.

Security & Privacy
- API keys are stored locally on your machine via browser storage
- Requests are relayed from the background (service worker/page) to avoid CORS issues, over HTTPS
- No usage analytics or external calls beyond the chosen provider

License
This project is intended to be open source under the MIT License.
If you want, we can add a `LICENSE` file to the repository explicitly.
