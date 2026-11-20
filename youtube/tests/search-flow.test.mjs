import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const moduleUrl = (text) => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const item = (id) => ({ id, title: 'Highlight ' + id, channel: 'Forsen Highlights', duration: 'PT12M', kind: 'video' });
let instance = 0;

async function search({ count = 1, fail = false } = {}) {
  const elements = new Map();
  function element() {
    return { value: '', textContent: '', disabled: false, children: [], listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      querySelector() { return this.button ||= element(); },
    };
  }
  const get = (id) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  globalThis.document = { getElementById: get, createElement: element, addEventListener() {} };
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = { getItem: () => '', setItem() {} };
  const calls = [];
  const subscriptions = Array.from({ length: count }, (_, index) => item('sub-' + index));
  globalThis.__searchTest = {
    connected: () => true, loadGoogle: async () => {}, connect: async () => {},
    subscriptionVideos: async (...args) => { calls.push(['subscriptions', ...args]); return subscriptions; },
    searchYouTube: async (...args) => {
      calls.push(['search', ...args]);
      if (fail) throw new Error('mock quota');
      return [subscriptions[0], item('broad')].filter(Boolean);
    },
  };
  globalThis.chrome = { runtime: { sendMessage(_id, payload, callback) {
    if (payload.action === 'youtubeStatus') callback({ ready: true });
    else callback({ picks: payload.candidates.map((_, index) => ({ index, reason: 'Matches request' })) });
  } } };
  const adapted = source
    .replace(/import \{ extensionId \} from [^;]+;/, 'const extensionId = "mock";')
    .replace(/import \{ connect, connected, loadGoogle, searchYouTube, subscriptionVideos \} from [^;]+;/,
      'const { connect, connected, loadGoogle, searchYouTube, subscriptionVideos } = globalThis.__searchTest;')
    .replace(/import \{ balance, watch \} from [^;]+;/, 'const balance = () => 1000; const watch = () => {};')
    .replace('setInterval(displayBudgets, 30_000);', '');
  await import(moduleUrl(adapted + '\n// instance ' + instance++));
  get('query').value = 'forsen highlights';
  get('mode').value = 'entertainment';
  get('upload-date').value = 'today';
  get('search').listeners.submit({ preventDefault() {} });
  for (let attempt = 0; attempt < 100 && get('refresh').disabled; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(get('refresh').disabled, false, 'search completed');
  return { calls, cards: get('results').children, status: get('status').textContent };
}

test('partial subscription matches are first and are supplemented with deduplicated broader matches', async () => {
  const { calls, cards, status } = await search();
  assert.deepEqual(calls, [['subscriptions', 'today', 'forsen highlights'], ['search', 'forsen highlights', false, 'today', 'entertainment']]);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].children[0].children[0].textContent, 'Highlight sub-0');
  assert.equal(cards[1].children[0].children[0].textContent, 'Highlight broad');
  assert.equal(status, '2 matches.');
});

test('six subscription matches keep subscription priority without a broader API search', async () => {
  const { calls, cards } = await search({ count: 6 });
  assert.equal(calls.length, 1);
  assert.equal(cards.length, 6);
});

test('a broader API failure preserves useful subscription results and reports the error', async () => {
  const { cards, status } = await search({ fail: true });
  assert.equal(cards.length, 1);
  assert.match(status, /Broader search failed: mock quota/);
});
