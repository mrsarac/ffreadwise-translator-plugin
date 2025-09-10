// MV2 background script
// Set an 'R' badge if supported by the browser
try {
  const ba = chrome?.browserAction || chrome?.action;
  if (ba?.setBadgeText) {
    ba.setBadgeBackgroundColor?.({ color: '#111827' });
    ba.setBadgeText({ text: 'R' });
  }
} catch (_) {}
