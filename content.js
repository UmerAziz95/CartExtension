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

var SUMMARY_PHRASES = /Subtotal|Total\s+PKR|Cost summary|Item Value|Scroll for more|Discount code|Apply\s+Submit|^\s*Shipping\s*$|Opens external|Updated total price|Your order|Opens in a new window/im;
var PRICE_REGEX = /(?:Rs\.?|PKR|USD|EUR|£|€|\$)\s*[\d,]+(?:\.\d{2})?/gi;

function extractItemsFromPageText(bodyText) {
  const items = [];
  const text = cleanText(bodyText);
  if (!text) return items;

  const lower = text.toLowerCase();
  let segmentStart = text.length;
  for (const marker of ['order summary', 'shopping cart', 'quantity 1 ']) {
    const idx = lower.indexOf(marker);
    if (idx >= 0 && idx < segmentStart) segmentStart = idx;
  }
  if (segmentStart >= text.length) segmentStart = 0;

  const afterStart = text.slice(segmentStart);
  const segmentEndMarkers = ['scroll for more', 'cost summary', 'subtotal ·', 'discount code'];
  let segmentEnd = text.length;
  for (const marker of segmentEndMarkers) {
    const idx = afterStart.toLowerCase().indexOf(marker);
    if (idx >= 0) {
      segmentEnd = segmentStart + idx;
      break;
    }
  }
  const segment = text.slice(segmentStart, segmentEnd);
  if (segment.length < 10) return items;

  const priceMatches = [];
  let m;
  PRICE_REGEX.lastIndex = 0;
  while ((m = PRICE_REGEX.exec(segment)) !== null) {
    priceMatches.push({ index: segmentStart + m.index, length: m[0].length, price: cleanText(m[0]) });
  }

  for (let i = 0; i < priceMatches.length; i++) {
    const curr = priceMatches[i];
    const prevEnd = i === 0 ? segmentStart : priceMatches[i - 1].index + priceMatches[i - 1].length;
    const snippet = text.slice(prevEnd, curr.index).trim();

    if (SUMMARY_PHRASES.test(snippet)) continue;
    if (!/[A-Za-z]/.test(snippet)) continue;
    if (/^\s*(Subtotal|Shipping|Tax|Total|Discount|Item Value|Cost summary)/i.test(snippet)) continue;

    let name = snippet
      .replace(/^(?:Product image\s*)?(?:Description\s*)?(?:Quantity\s*Price\s*)?(?:Quantity|Qty)\s*[:x]?\s*\d+\s*/i, '')
      .replace(/\s*(Quantity|Qty)\s*[:x]?\s*\d*$/i, '')
      .trim();
    const trailingNum = name.match(/\s+(\d+)\s*$/);
    const quantity = (snippet.match(/(?:Quantity|Qty)\s*[:x]?\s*(\d+)/i) || trailingNum)?.[1] || '1';
    if (trailingNum) name = name.slice(0, -trailingNum[0].length).trim();
    name = cleanText(name);

    if (name.length < 2 || name.length > 180) continue;

    items.push({ name, quantity, price: curr.price, source: 'pageText' });
  }

  return uniqueBy(items, (i) => `${i.name.toLowerCase()}|${i.price}`);
}

function extractPricingFromText(bodyText) {
  const text = cleanText(bodyText);
  const priceRegex = /(?:Rs\.?|PKR|USD|EUR|£|€|\$)\s*[\d,]+(?:\.\d{2})?/gi;

  function findPriceAfterKeyword(keyword) {
    const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (idx === -1) return '';
    const after = text.slice(idx + keyword.length);
    const match = after.match(priceRegex);
    return match ? cleanText(match[0]) : '';
  }

  function findShippingInSummary() {
    const costSummaryIdx = text.toLowerCase().indexOf('cost summary');
    const subtotalIdx = text.toLowerCase().indexOf('subtotal');
    const start = Math.max(costSummaryIdx >= 0 ? costSummaryIdx : 0, subtotalIdx >= 0 ? subtotalIdx : 0);
    const slice = text.slice(start, start + 400);
    const shipIdx = slice.toLowerCase().indexOf('shipping');
    if (shipIdx === -1) return findPriceAfterKeyword('shipping');
    const afterShip = slice.slice(shipIdx + 8).trim();
    if (/^FREE\b/i.test(afterShip)) return 'FREE';
    const match = afterShip.match(priceRegex);
    return match ? cleanText(match[0]) : '';
  }

  return {
    subtotal: findPriceAfterKeyword('subtotal') || findPriceAfterKeyword('item value'),
    shipping: findShippingInSummary(),
    tax: findPriceAfterKeyword('tax'),
    total: findPriceAfterKeyword('total pkr') || findPriceAfterKeyword('total') || findPriceAfterKeyword('pay now')
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

// ----- Normalization -----

const COUNTRY_CODE_TO_NAME = {
  PK: 'Pakistan', US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia',
  IN: 'India', AE: 'United Arab Emirates', SA: 'Saudi Arabia', DE: 'Germany', FR: 'France'
};

function getFormValue(form, ...keys) {
  for (const key of keys) {
    const v = form[key];
    if (v != null && String(v).trim()) return cleanText(String(v));
  }
  return '';
}

function normalizeCustomer(raw, form) {
  const email = getFormValue(form, 'email', 'checkout[email]', 'contact[email]', 'customer_email') || raw.email;
  const firstName = getFormValue(form, 'firstName', 'first_name', 'checkout[shipping_address][first_name]', 'checkout[billing_address][first_name]');
  const lastName = getFormValue(form, 'lastName', 'last_name', 'checkout[shipping_address][last_name]', 'checkout[billing_address][last_name]');
  const name = raw.name || [firstName, lastName].filter(Boolean).join(' ').trim();
  const phone = getFormValue(form, 'phone', 'checkout[shipping_address][phone]', 'checkout[billing_address][phone]', 'tel') || raw.phone;
  return {
    email: email || '',
    name: name || '',
    phone: phone || '',
    firstName: firstName || '',
    lastName: lastName || ''
  };
}

function normalizeShippingAddress(raw, form) {
  const countryCode = getFormValue(form, 'countryCode', 'country', 'checkout[shipping_address][country]') || raw.country || '';
  const countryName = COUNTRY_CODE_TO_NAME[countryCode] || countryCode;
  return {
    line1: getFormValue(form, 'address1', 'address_line1', 'checkout[shipping_address][address1]') || raw.line1 || '',
    line2: getFormValue(form, 'address2', 'address_line2', 'checkout[shipping_address][address2]') || '',
    city: getFormValue(form, 'city', 'checkout[shipping_address][city]') || raw.city || '',
    state: getFormValue(form, 'state', 'zone', 'province', 'checkout[shipping_address][province]') || raw.state || '',
    postalCode: getFormValue(form, 'postalCode', 'zip', 'postal_code', 'checkout[shipping_address][zip]') || raw.postalCode || '',
    country: countryName || '',
    countryCode: countryCode || ''
  };
}

function parsePrice(formatted) {
  if (!formatted || !String(formatted).trim()) return { amount: null, currency: '', formatted: '' };
  const str = String(formatted).trim();
  const currencyMatch = str.match(/^(Rs\.?|PKR|USD|EUR|£|€|\$|GBP|INR)\s*/i);
  const currencyKey = currencyMatch ? currencyMatch[0].replace(/\s/g, '').replace(/\./g, '').toLowerCase() : '';
  const currencyMap = { 'rs': 'PKR', 'pkr': 'PKR', 'usd': 'USD', 'eur': 'EUR', 'gbp': 'GBP', 'inr': 'INR' };
  const currency = currencyMap[currencyKey] || (currencyMatch ? currencyMatch[0].trim() : '');
  const numStr = str.replace(/[^\d.,]/g, '').replace(/,/g, '');
  const amount = numStr ? parseFloat(numStr) : null;
  return { amount: isNaN(amount) ? null : amount, currency, formatted: str };
}

function normalizePricing(raw) {
  const totalParsed = parsePrice(raw.total);
  const subtotalParsed = parsePrice(raw.subtotal);
  const shippingParsed = parsePrice(raw.shipping);
  const taxParsed = parsePrice(raw.tax);
  return {
    subtotal: raw.subtotal || '',
    subtotalAmount: subtotalParsed.amount,
    subtotalCurrency: subtotalParsed.currency,
    shipping: raw.shipping || '',
    shippingAmount: shippingParsed.amount,
    shippingCurrency: shippingParsed.currency,
    tax: raw.tax || '',
    taxAmount: taxParsed.amount,
    taxCurrency: taxParsed.currency,
    total: raw.total || '',
    totalAmount: totalParsed.amount,
    totalCurrency: totalParsed.currency
  };
}

function normalizeItem(item) {
  const priceParsed = parsePrice(item.price);
  let qty = 1;
  if (item.quantity != null && item.quantity !== '') {
    const n = parseInt(String(item.quantity).replace(/\D/g, ''), 10);
    if (!isNaN(n)) qty = n;
  }
  return {
    name: cleanText(item.name || ''),
    quantity: qty,
    price: item.price || '',
    priceAmount: priceParsed.amount,
    priceCurrency: priceParsed.currency,
    source: item.source || 'unknown'
  };
}

function normalizeCheckoutData(raw) {
  const form = raw.pageData?.allFormFields || {};
  return {
    extractedAt: raw.extractedAt,
    pageTitle: raw.pageTitle,
    pageUrl: raw.pageUrl,
    customer: normalizeCustomer(raw.customer || {}, form),
    shippingAddress: normalizeShippingAddress(raw.shippingAddress || {}, form),
    billingAddress: raw.billingAddress ? normalizeShippingAddress(raw.billingAddress, form) : null,
    pricing: normalizePricing(raw.pricing || {}),
    items: (raw.items || []).map(normalizeItem),
    pageData: {
      allFormFields: raw.pageData?.allFormFields ?? {},
      pageTextExcerpt: (raw.pageData?.pageTextExcerpt || '').slice(0, 5000),
      htmlExcerpt: undefined
    }
  };
}

function extractCheckoutData() {
  const bodyText = document.body?.innerText || '';

  if (!looksLikeCheckoutPage(window.location.href, bodyText.slice(0, 15000))) {
    return {
      ok: false,
      error: 'This page does not look like a checkout page.'
    };
  }

  let items = uniqueBy(
    [...extractItemsFromDom(), ...extractItemsFromStructuredData()],
    (item) => `${item.name.toLowerCase()}|${item.price}|${item.quantity}`
  );
  if (items.length === 0 && bodyText) {
    items = extractItemsFromPageText(bodyText);
  }

  const pricingFromSelectors = {
    subtotal: findFieldValue(['[class*="subtotal"]', '[data-testid*="subtotal"]', '[data-checkout-subtotal-price-target]']),
    shipping: findFieldValue(['[class*="shipping"]', '[data-testid*="shipping"]']),
    tax: findFieldValue(['[class*="tax"]', '[data-testid*="tax"]']),
    total: findFieldValue(['[class*="total"]', '[data-testid*="total"]', '[data-checkout-payment-due-target]', 'strong'])
  };

  const pricingFromText = extractPricingFromText(bodyText);

  const rawData = {
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
      country: findFieldValue(['select[name*="country"]', 'input[name*="country"]', '[autocomplete="country"]'])
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

  // If we have pricing in text but not from selectors, re-run text extraction (e.g. "Total PKR Rs 3,943.00")
  if (!rawData.pricing.total && rawData.pageData.pageTextExcerpt) {
    const fromText = extractPricingFromText(rawData.pageData.pageTextExcerpt);
    rawData.pricing.subtotal = rawData.pricing.subtotal || fromText.subtotal;
    rawData.pricing.shipping = rawData.pricing.shipping || fromText.shipping;
    rawData.pricing.tax = rawData.pricing.tax || fromText.tax;
    rawData.pricing.total = rawData.pricing.total || fromText.total;
  }

  const data = normalizeCheckoutData(rawData);
  return { ok: true, data };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'EXTRACT_CHECKOUT') {
    return;
  }

  sendResponse(extractCheckoutData());
});
