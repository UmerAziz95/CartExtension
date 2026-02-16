function looksLikeCheckoutPage(url, textBlob) {
  const source = `${url} ${textBlob}`.toLowerCase();
  const keywords = [
    'checkout',
    'payment',
    'place order',
    'order summary',
    'shipping',
    'billing'
  ];
  return keywords.some((key) => source.includes(key));
}

function findFieldValue(selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!el) continue;

    if ('value' in el && el.value) {
      return el.value.trim();
    }

    const text = el.textContent?.trim();
    if (text) return text;
  }
  return '';
}

function extractItems() {
  const rows = Array.from(
    document.querySelectorAll('[class*="cart"], [class*="item"], [data-testid*="cart"], [data-testid*="item"]')
  );

  const seen = new Set();
  const items = [];

  for (const row of rows) {
    const nameEl = row.querySelector('h1, h2, h3, h4, [class*="name"], [data-testid*="name"], a');
    const priceEl = row.querySelector('[class*="price"], [data-testid*="price"]');
    const qtyEl = row.querySelector('[class*="qty"], [class*="quantity"], [data-testid*="qty"]');

    const name = nameEl?.textContent?.trim();
    if (!name || name.length < 2) continue;

    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    items.push({
      name,
      price: priceEl?.textContent?.trim() || '',
      quantity: qtyEl?.textContent?.trim() || ''
    });
  }

  return items;
}

function extractCheckoutData() {
  const bodyText = document.body?.innerText?.slice(0, 10000) || '';

  if (!looksLikeCheckoutPage(window.location.href, bodyText)) {
    return {
      ok: false,
      error: 'This page does not look like a checkout page.'
    };
  }

  const data = {
    pageTitle: document.title,
    pageUrl: window.location.href,
    extractedAt: new Date().toISOString(),
    customer: {
      name: findFieldValue([
        'input[name*="name"]',
        '[autocomplete="name"]',
        '[class*="name"] input'
      ]),
      email: findFieldValue([
        'input[type="email"]',
        'input[name*="email"]',
        '[autocomplete="email"]'
      ]),
      phone: findFieldValue([
        'input[type="tel"]',
        'input[name*="phone"]',
        '[autocomplete="tel"]'
      ])
    },
    shippingAddress: {
      line1: findFieldValue([
        'input[name*="address"]',
        '[autocomplete="address-line1"]'
      ]),
      city: findFieldValue([
        'input[name*="city"]',
        '[autocomplete="address-level2"]'
      ]),
      state: findFieldValue([
        'input[name*="state"]',
        '[autocomplete="address-level1"]'
      ]),
      postalCode: findFieldValue([
        'input[name*="zip"]',
        'input[name*="postal"]',
        '[autocomplete="postal-code"]'
      ]),
      country: findFieldValue([
        'input[name*="country"]',
        '[autocomplete="country"]'
      ])
    },
    pricing: {
      subtotal: findFieldValue(['[class*="subtotal"]', '[data-testid*="subtotal"]']),
      shipping: findFieldValue(['[class*="shipping"]', '[data-testid*="shipping"]']),
      tax: findFieldValue(['[class*="tax"]', '[data-testid*="tax"]']),
      total: findFieldValue([
        '[class*="total"]',
        '[data-testid*="total"]',
        'strong'
      ])
    },
    items: extractItems()
  };

  return { ok: true, data };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'EXTRACT_CHECKOUT') {
    return;
  }

  sendResponse(extractCheckoutData());
});
