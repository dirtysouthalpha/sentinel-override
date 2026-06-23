// agent-screenshot.js
// Extracted from agent-engine.js — Step Screenshot Capture + Zoom & Inspect.

async function captureStepScreenshot(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const windowId = tab.windowId;
    const dataUrl = await new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 }, (result) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(result);
      });
    });
    return dataUrl;
  } catch (_e) { return null; }
}

let _zoomRegion = null;

function setZoomRegion(region) {
  _zoomRegion = region || null;
}

function getZoomRegion() {
  return _zoomRegion;
}

function formatZoomRegion(region) {
  if (!region || typeof region !== 'object') return '';
  const { x, y, width, height } = region;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') return '';
  return `\n[ZOOM REGION] Focus on viewport area: x=${Math.round(x)}, y=${Math.round(y)}, width=${Math.round(width)}, height=${Math.round(height)}. The relevant content is in this region — pay extra attention to detail here.`;
}

export {
  captureStepScreenshot,
  setZoomRegion,
  getZoomRegion,
  formatZoomRegion,
};
