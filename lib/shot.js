'use strict';

// Screenshots: render a local HTML file to PNG with the bundled Chromium.
// A missing browser degrades to HTML-only evidence instead of failing the run.

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function browserAvailable() {
  try {
    const { chromium } = require('playwright');
    const exe = chromium.executablePath();
    return Boolean(exe && fs.existsSync(exe));
  } catch {
    return false;
  }
}

async function renderToPng({ htmlFile, pngFile, fullPage = true }) {
  const { chromium } = require('playwright');
  fs.mkdirSync(path.dirname(pngFile), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 2,
    });
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
    await page.screenshot({ path: pngFile, fullPage });
    return pngFile;
  } finally {
    await browser.close();
  }
}

// Render every HTML file listed and return the PNG paths that exist.
async function renderAll(pairs) {
  if (!browserAvailable()) {
    return {
      skipped: true,
      pngs: [],
      reason: 'Chromium chua duoc cai (chay: npx playwright install chromium)',
    };
  }
  const pngs = [];
  for (const { htmlFile, pngFile } of pairs) {
    pngs.push(await renderToPng({ htmlFile, pngFile }));
  }
  return { skipped: false, pngs };
}

module.exports = { renderAll, renderToPng, browserAvailable };
