// Generates every diagram (diagrams/*.js except helpers) and renders its SVG to
// figures/<name>.png at 2x with the monorepo's Playwright Chromium.
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright'));

const HELPERS = new Set(['svg.js', 'render.js']);

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && !HELPERS.has(f))) {
      const name = path.basename(file, '.js');
      require(path.join(__dirname, file));
      const svg = fs.readFileSync(path.join(__dirname, `${name}.svg`), 'utf8');
      await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
      await page.locator('svg').screenshot({ path: path.join(__dirname, '..', 'figures', `${name}.png`) });
      console.log(`Rendered figures/${name}.png`);
    }
  } finally {
    await browser.close();
  }
})();
