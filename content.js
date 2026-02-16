function cleanText(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function looksLikeCheckoutPage(url, textBlob) {
  const source = `${url} ${textBlob}`.toLowerCase();
  const keywords = [
    'checkout',
    'payment',
    'place order',
    'order summary',
    'shipping',
    'billing',
    'delivery',
    'cart total'
  ];
  return keywords.some((key) => source.includes(key));
}

function findFieldValue(selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!el) continue;

    if ('value' in el && el.value) {
      return cleanText(el.value);
    }

    const text = cleanText(el.textContent || '');
    if (text) return text;
  }
  return '';
}

function findPriceInText(text) {
  const match = text.match(/(?:Rs\.?|PKR|USD|EUR|£|€|\$)\s?[\d,]+(?:\.\d{2})?/i);
  return match ? cleanText(match[0]) : '';
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractItemsFromStructuredData() {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  const items = [];

  for (const script of scripts) {
    try {
      const json = JSON.parse(script.textContent || '{}');
      const nodes = Array.isArray(json) ? json : [json];

      for (const node of nodes) {
        const possibleItems = [
          ...(Array.isArray(node?.itemListElement) ? node.itemListElement : []),
          ...(Array.isArray(node?.offers?.itemOffered) ? node.offers.itemOffered : []),
          ...(Array.isArray(node?.hasPart) ? node.hasPart : [])
        ];

        for (const entry of possibleItems) {
          const data = entry.item || entry.itemOffered || entry;
          const name = cleanText(data?.name || '');
          if (!name) continue;
          items.push({
            name,
            quantity: cleanText(String(data?.quantity || entry?.quantity || '')),
            price: cleanText(String(data?.price || entry?.price || data?.offers?.price || '')),
            source: 'json-ld'
          });
        }
      }
    } catch (_error) {
      // Ignore invalid JSON-LD blocks.
    }
  }

  return items;
}

function extractItemsFromDom() {
  const selectors = [
    '[data-product-title]',
    '[data-order-summary-section="line-items"] tr',
    '[class*="product"]',
    '[class*="line-item"]',
    '[class*="order-item"]',
    '[class*="cart-item"]',
    '[class*="checkout-item"]',
    '[data-testid*="item"]',
    'li'
  ];

  const rows = Array.from(document.querySelectorAll(selectors.join(', ')));
  const items = [];

  for (const row of rows) {
    const rowText = cleanText(row.textContent || '');
    if (!rowText || rowText.length < 3 || rowText.length > 300) continue;

    const name = cleanText(
      row.getAttribute('data-product-title') ||
      row.querySelector('[data-product-title], [class*="name"], [class*="title"], a, h1, h2, h3, h4, strong')?.textContent ||
      ''
    );

    const price = cleanText(
      row.querySelector('[class*="price"], [data-checkout-subtotal-price-target], [data-testid*="price"]')?.textContent ||
      findPriceInText(rowText)
    );

    const quantity = cleanText(
      row.querySelector('[class*="qty"], [class*="quantity"], [data-testid*="qty"]')?.textContent ||
      (rowText.match(/(?:qty|quantity)\s*[:x]?\s*(\d+)/i)?.[1] || '')
    );

    if (!name) continue;

    items.push({
      name,
      price,
      quantity,
      source: 'dom'
    });
  }

  return uniqueBy(items, (item) => item.name.toLowerCase());
}

function extractPricingFromText(bodyText) {
  const lines = bodyText
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean);

  const findNearKeyword = (keyword) => {
    const line = lines.find((entry) => entry.toLowerCase().includes(keyword));
    return line ? findPriceInText(line) : '';
  };

  return {
    subtotal: findNearKeyword('subtotal'),
    shipping: findNearKeyword('shipping'),
    tax: findNearKeyword('tax'),
    total: findNearKeyword('total')
  };
}

function extractFormDataSnapshot() {
  const fields = Array.from(document.querySelectorAll('input, select, textarea'));
  const data = {};

  for (const field of fields) {
    const value = 'value' in field ? cleanText(field.value || '') : '';
    if (!value) continue;

    const key = cleanText(
      field.name || field.id || field.getAttribute('autocomplete') || field.getAttribute('placeholder') || 'unnamedField'
    );

    if (!data[key]) {
      data[key] = value;
    }
  }

  return data;
}

function extractCheckoutData() {
  const bodyText = document.body?.innerText || '';

  if (!looksLikeCheckoutPage(window.location.href, bodyText.slice(0, 15000))) {
    return {
      ok: false,
      error: 'This page does not look like a checkout page.'
    };
  }

  const items = uniqueBy(
    [...extractItemsFromDom(), ...extractItemsFromStructuredData()],
    (item) => `${item.name.toLowerCase()}|${item.price}|${item.quantity}`
  );

  const pricingFromSelectors = {
    subtotal: findFieldValue(['[class*="subtotal"]', '[data-testid*="subtotal"]', '[data-checkout-subtotal-price-target]']),
    shipping: findFieldValue(['[class*="shipping"]', '[data-testid*="shipping"]']),
    tax: findFieldValue(['[class*="tax"]', '[data-testid*="tax"]']),
    total: findFieldValue(['[class*="total"]', '[data-testid*="total"]', '[data-checkout-payment-due-target]', 'strong'])
  };

  const pricingFromText = extractPricingFromText(bodyText);

  const data = {
    pageTitle: document.title,
    pageUrl: window.location.href,
    extractedAt: new Date().toISOString(),
    customer: {
      name: findFieldValue(['input[name*="name"]', '[autocomplete="name"]', '[class*="name"] input']),
      email: findFieldValue(['input[type="email"]', 'input[name*="email"]', '[autocomplete="email"]']),
      phone: findFieldValue(['input[type="tel"]', 'input[name*="phone"]', '[autocomplete="tel"]'])
    },
    shippingAddress: {
      line1: findFieldValue(['input[name*="address"]', '[autocomplete="address-line1"]']),
      city: findFieldValue(['input[name*="city"]', '[autocomplete="address-level2"]']),
      state: findFieldValue(['input[name*="state"]', '[autocomplete="address-level1"]']),
      postalCode: findFieldValue(['input[name*="zip"]', 'input[name*="postal"]', '[autocomplete="postal-code"]']),
      country: findFieldValue(['input[name*="country"]', '[autocomplete="country"]'])
    },
    pricing: {
      subtotal: pricingFromSelectors.subtotal || pricingFromText.subtotal,
      shipping: pricingFromSelectors.shipping || pricingFromText.shipping,
      tax: pricingFromSelectors.tax || pricingFromText.tax,
      total: pricingFromSelectors.total || pricingFromText.total
    },
    items,
    pageData: {
      allFormFields: extractFormDataSnapshot(),
      pageTextExcerpt: cleanText(bodyText).slice(0, 20000),
      htmlExcerpt: (document.body?.outerHTML || '').slice(0, 100000)
    }
  };

  return { ok: true, data };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'EXTRACT_CHECKOUT') {
    return;
  }

  sendResponse(extractCheckoutData());
});
