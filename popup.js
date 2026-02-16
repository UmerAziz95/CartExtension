const extractBtn = document.getElementById('extractBtn');
const statusEl = document.getElementById('status');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b91c1c' : '#475569';
}

extractBtn.addEventListener('click', async () => {
  setStatus('Extracting checkout data...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus('No active tab found.', true);
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CHECKOUT' });

    if (!response?.ok) {
      setStatus(response?.error || 'Unable to extract data from this page.', true);
      return;
    }

    await chrome.runtime.sendMessage({ type: 'OPEN_RESULTS_TAB', payload: response.data });
    setStatus('Done! Opened extracted data in a new tab.');
  } catch (error) {
    setStatus('Failed to extract. Make sure this is a checkout page.', true);
  }
});
