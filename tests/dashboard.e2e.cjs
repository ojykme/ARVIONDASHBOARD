const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const os = require('node:os');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const item = { url: 'https://example.test/a.png', originUrl: 'https://example.test/original.png', originalSize: 10000, compressedSize: 4000, originalFormat: 'png', convertedFormat: 'png', cacheStatus: 'HIT-S3' };
      window.fixture = item;
      window.chrome = {
        devtools: { inspectedWindow: { tabId: 1 } },
        storage: { local: {
          get: (_, cb) => cb(JSON.parse(sessionStorage.getItem('fixturePreferences') || '{}')),
          set(values, cb) {
            sessionStorage.setItem('fixturePreferences', JSON.stringify({ ...JSON.parse(sessionStorage.getItem('fixturePreferences') || '{}'), ...values }));
            cb?.();
          },
        } },
        runtime: {
          id: 'fixture', onMessage: { addListener: fn => { window.receive = fn; } },
          sendMessage(message, cb) {
            if (message.type === 'getInitialData') return setTimeout(() => cb({ data: [item] }), 0);
            if (message.type === 'fetchPreview') {
              if (window.failPreview) return setTimeout(() => cb({ ok: false, status: 503, message: 'Fixture unavailable' }), 0);
              const color = message.url.includes('original') ? '#2255aa' : '#228855';
              const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="${color}"/><circle cx="800" cy="600" r="200" fill="white"/></svg>`;
              return setTimeout(() => cb({ ok: true, status: 200, contentType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,' + btoa(svg) }), 0);
            }
            cb?.({});
          },
        },
      };
    });
    await page.goto(pathToFileURL(path.resolve('view.html')).href);
    await page.locator('tr[data-url]').waitFor();
    await page.locator('tr[data-url]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.modal-image')].every(img => img.naturalWidth === 1600));
    assert.equal(await page.locator('.image-meta').isVisible(), false);
    await page.locator('[data-view="2"]').click();
    assert.deepEqual(await page.locator('.zoom-badge').allTextContents(), ['200%', '200%']);
    const image = page.locator('.modal-image').first();
    assert.equal(await image.evaluate(img => img.style.width), '1600px');
    const region = page.locator('.image-preview').first();
    const box = await region.boundingBox();
    assert.ok(box.height > 600, 'images should use most of the viewport height');
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.6);
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(() => document.querySelector('.zoom-badge').textContent !== '200%');
    const transforms = await page.locator('.modal-image').evaluateAll(imgs => imgs.map(img => img.style.transform));
    assert.equal(transforms[0], transforms[1]);
    assert.ok(!transforms[0].startsWith('translate(0px, 0px)'), 'zoom anchors to cursor');
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75 + 40, box.y + box.height * 0.6 + 20);
    await page.mouse.up();
    const dragged = await page.locator('.modal-image').evaluateAll(imgs => imgs.map(img => img.style.transform));
    assert.equal(dragged[0], dragged[1]);
    assert.notEqual(dragged[0], transforms[0]);
    await page.locator('#syncPreview').uncheck();
    await page.locator('[data-view="4"]').click();
    assert.equal(await page.locator('.zoom-badge').first().textContent(), '400%');
    assert.notEqual(await page.locator('.zoom-badge').nth(1).textContent(), '400%');
    await page.locator('#syncPreview').check();
    await page.locator('#compareMode').selectOption('slider');
    assert.equal(await page.locator('.wipe-control').isVisible(), true);
    await page.locator('.wipe-control input').fill('70');
    assert.equal(await page.locator('.comparison-wrapper').evaluate(el => el.style.getPropertyValue('--wipe')), '70%');
    await page.locator('#compareMode').selectOption('optimized');
    assert.equal(await page.locator('.img-box').first().isVisible(), false);
    await page.locator('#toggleInfo').click();
    assert.equal(await page.locator('.image-meta').isVisible(), true);
    await page.locator('#toggleInfo').click();
    await page.locator('#compareMode').selectOption('split');
    await page.locator('#fullscreenPreview').click();
    await page.waitForFunction(() => document.fullscreenElement || document.querySelector('.modal.expanded'));
    await page.screenshot({ path: path.join(os.tmpdir(), 'arvion-viewer-fullscreen.png') });
    await page.evaluate(() => window.receive({ type: 'newData', tabId: 1, data: [window.fixture, { ...window.fixture, url: 'https://example.test/b.png' }] }));
    assert.equal(await page.locator('tr[data-url]').count(), 1);
    await page.locator('.close').click();
    await page.waitForFunction(() => document.querySelectorAll('tr[data-url]').length === 2);
    assert.equal(await page.locator('.incoming-row').count(), 1);
    await page.waitForTimeout(350);
    assert.match(await page.locator('[data-stat="actual"]').textContent(), /7.81/);
    await page.screenshot({ path: path.join(os.tmpdir(), 'arvion-dashboard-live.png') });
    await page.locator('tr[data-url]').first().click();
    await page.locator('[data-view="4"]').click();
    await page.locator('.close').click();
    await page.setViewportSize({ width: 700, height: 700 });
    await page.locator('tr[data-url]').first().click();
    await page.locator('[data-view="fit"]').click();
    assert.equal(await page.locator('#fullscreenPreview').isVisible(), true);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(os.tmpdir(), 'arvion-viewer-compact.png') });
    await page.locator('.close').click();
    await page.evaluate(() => { window.failPreview = true; });
    await page.locator('tr[data-url]').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.preview-error.visible').length === 2);
    assert.equal(await page.locator('#compareMode option[value="slider"]').isDisabled(), true);
    await page.locator('.close').click();
    await page.evaluate(() => { window.failPreview = false; });
    await page.locator('tr[data-url]').first().click();
    await page.waitForFunction(() => !document.querySelector('#compareMode option[value="slider"]').disabled);
    await page.locator('#compareMode').selectOption('slider');
    await page.locator('.close').click();
    await page.locator('tr[data-url]').nth(1).click();
    await page.waitForFunction(() => document.querySelector('#compareMode').value === 'slider');
    await page.locator('.close').click();
    await page.reload();
    await page.locator('tr[data-url]').first().click();
    await page.waitForFunction(() => document.querySelector('#compareMode').value === 'slider');
    await page.locator('.close').click();
    await page.evaluate(() => { window.failPreview = true; });
    await page.locator('tr[data-url]').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.preview-error.visible').length === 2);
    assert.equal(await page.locator('#compareMode').inputValue(), 'split');
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('fixturePreferences')).comparisonMode), 'slider');
    await page.locator('.close').click();
    await page.evaluate(() => { window.failPreview = false; });
    await page.locator('tr[data-url]').first().click();
    await page.waitForFunction(() => document.querySelector('#compareMode').value === 'slider');
    assert.deepEqual(errors, []);
    console.log('PASS: comparison preference persists across images/reload and survives unavailable slider fallback');
    console.log('PASS: zoom, cursor anchor, sync, comparison modes, fullscreen, pending traffic, counters, reopen, compact layout');
    console.log('Screenshots: ' + path.join(os.tmpdir(), 'arvion-viewer-{fullscreen,compact}.png'));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
