// Safe message listener registration that auto-detects Manifest V3
// and chooses the Promise pattern when available. No-ops when
// running locally (no chrome.runtime present), so it is safe to
// include from any file path or when opened via file://.

export function registerMessageHandler(handler) {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) {
    // Not running as an extension context — nothing to register.
    return;
  }

  // Using the 3-argument signature with 'return true' is the most compatible and 
  // reliable way across both MV2 and MV3 for handling asynchronous responses.
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      const result = handler(request, sender);
      
      // Check if result is a Promise (thenable)
      if (result && typeof result.then === 'function') {
        result
          .then(res => {
            // Only attempt to send if the extension context is still valid
            if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
            
            // If we returned true, we MUST call sendResponse.
            // We send null if res is undefined to satisfy Chrome's requirement.
            sendResponse(res !== undefined ? res : null);
          })
          .catch(err => {
            if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
            
            sendResponse({ error: err?.message || String(err) || 'Async handler error' });
          });
        return true; // Keep the message channel open for the async response
      }
      
      if (result !== undefined) {
        sendResponse(result);
      }
    } catch (err) {
      sendResponse({ error: err?.message || String(err) });
    }
  });
}

export default registerMessageHandler;

// Example usage (commented):
// registerMessageHandler(async (request) => {
//   if (request.action === 'getData') {
//     const res = await fetch(request.url);
//     if (!res.ok) throw new Error(res.statusText || 'Network error');
//     const data = await res.json();
//     return { data };
//   }
// });
