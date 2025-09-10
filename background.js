// Placeholder background service worker (MV3)
// Set an 'R' badge to mimic an icon
try {
  if (chrome?.action?.setBadgeText) {
    chrome.action.setBadgeBackgroundColor({ color: '#111827' });
    chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
    chrome.action.setBadgeText({ text: 'R' });
  }
} catch (_) {}

// MV2-style background script for Firefox compatibility; no extra logic required
