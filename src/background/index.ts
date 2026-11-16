// Service worker: opens the side panel when the toolbar icon is clicked. Extraction runs
// in the side panel, which renders the PDF pages it sends to the KKU GenAI gateway.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
