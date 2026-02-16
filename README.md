# Checkout Data Extractor (Chrome Extension)

This extension helps you extract checkout information from ecommerce checkout pages.

## What it does

1. Open any ecommerce checkout page.
2. Click the extension icon.
3. Press **Extract Checkout Data**.
4. The extension extracts available checkout info and opens a new tab with the data in JSON format.

## Install locally in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.

## Notes

- The extension uses best-effort selectors, so extracted fields may vary by website structure.
- It only runs extraction when you click the button (manual activation).
