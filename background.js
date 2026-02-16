chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'OPEN_RESULTS_TAB') {
    return;
  }

  const checkoutData = message.payload || {};

  chrome.storage.session.set({ latestCheckoutData: checkoutData }, () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('results.html') }, () => {
      sendResponse({ ok: true });
    });
  });

  return true;
});
