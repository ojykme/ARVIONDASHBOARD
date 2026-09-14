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

test('video ranges share one row without merging states, tabs, query strings or images', () => {
  const source = readFileSync(join(__dirname, '../src/background/background.js'), 'utf8');
  let receive;
  const imageDataMap = new Map();
  const context = vm.createContext({ URL, imageDataMap, logNetworkEvent() {}, chrome: {
    webRequest: { onResponseStarted: { addListener(fn) { receive = fn; } } },
    runtime: { sendMessage() {} },
  }});
  vm.runInContext(source.slice(source.indexOf('chrome.webRequest.onResponseStarted.addListener'), source.indexOf('// webNavigation.onCommitted:')), context);
  const send = (tabId = 1, status = 'HIT-S3', url = 'https://example.test/a.mp4', contentType = 'video/mp4', range = 'bytes 0-1/649638') => receive({
    tabId, type: contentType.startsWith('video') ? 'media' : 'image', url, statusCode: 206,
    responseHeaders: [
      { name: 'Content-Type', value: contentType }, { name: 'X-Arvion-Cache', value: status },
      { name: 'Content-Length', value: '2' }, { name: 'Content-Range', value: range },
    ],
  });
  send(); send(1, 'HIT-S3', 'https://example.test/a.mp4', 'video/mp4', 'bytes 200-201/649638'); send(); send();
  assert.equal(imageDataMap.get(1).length, 1);
  assert.equal(imageDataMap.get(1)[0].requestCount, 4);
  assert.equal(imageDataMap.get(1)[0].compressedSize, '649638');
  assert.equal(imageDataMap.get(1).reduce((n, row) => n + Number(row.compressedSize), 0), 649638);
  send(1, 'MISS-ASYNC-QUEUED');
  assert.equal(imageDataMap.get(1).length, 2);
  assert.equal(imageDataMap.get(1)[1].cacheStatus, 'MISS-ASYNC-QUEUED');
  send(2); assert.equal(imageDataMap.get(2).length, 1);
  send(1, 'HIT-S3', 'https://example.test/a.mp4?v=2');
  assert.equal(imageDataMap.get(1).length, 3);
  send(1, 'HIT-S3', 'https://example.test/a.png', 'image/png');
  send(1, 'HIT-S3', 'https://example.test/a.png', 'image/png');
  assert.equal(imageDataMap.get(1).length, 5);
});
