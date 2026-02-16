const outputEl = document.getElementById('jsonOutput');
const metaEl = document.getElementById('meta');

chrome.storage.session.get('latestCheckoutData', (res) => {
  const data = res.latestCheckoutData;

  if (!data) {
    metaEl.textContent = 'No checkout data was found. Please run extraction again.';
    outputEl.textContent = '{}';
    return;
  }

  metaEl.textContent = `Source: ${data.pageUrl || 'Unknown page'} | Extracted: ${data.extractedAt || 'Unknown time'}`;
  outputEl.textContent = JSON.stringify(data, null, 2);
});
