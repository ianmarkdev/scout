/**
 * Clicking the toolbar icon opens Career Clipper in the browser's side panel, which stays open
 * as the user switches tabs. Nothing else runs in the background.
 */

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
