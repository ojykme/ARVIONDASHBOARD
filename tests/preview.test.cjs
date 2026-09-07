const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

test('simultaneous previews use independent rules and clean up after fetch failure', async () => {
  const source = readFileSync(join(__dirname, '../src/background/background.js'), 'utf8');
  const active = new Set();
  const added = [];
  const context = vm.createContext({
    URL, Uint8Array, btoa,
    Date: { now: () => 12345 },
    console: { debug() {} },
    chrome: {
      tabs: { TAB_ID_NONE: -1 },
      runtime: {},
      declarativeNetRequest: {
        updateSessionRules({ addRules, removeRuleIds }, callback) {
          for (const id of removeRuleIds) active.delete(id);
          for (const rule of addRules) {
            assert.ok(!added.includes(rule.id), 'parallel requests must not share IDs');
            added.push(rule.id);
            active.add(rule.id);
          }
          queueMicrotask(callback);
        },
      },
    },
    async fetch(url) {
      assert.equal(active.size, 2);
      if (url.includes('/fail')) throw new Error('network failure');
      return {
        ok: true, status: 200, statusText: 'OK', redirected: false, url,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    },
  });
  vm.runInContext(source.split('chrome.runtime.onMessage.addListener')[0], context);
  const results = await Promise.allSettled([
    context.fetchPreviewResource('https://example.com/image'),
    context.fetchPreviewResource('https://example.com/fail'),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[0].value.dataUrl, 'data:image/png;base64,AQID');
  assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /network failure/);
  assert.equal(active.size, 0);
});
