import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const dateUrl = moduleUrl(await readFile(new URL('../date-filter.js', import.meta.url), 'utf8'));
const catalogSource = (await readFile(new URL('../catalog.js', import.meta.url), 'utf8'))
  .replace('./date-filter.js?v=4', dateUrl);
let instance = 0;
const current = new Date(Date.now() - 60_000).toISOString();
const old = '2020-01-01T00:00:00Z';
const video = (id, duration = 'PT12M', publishedAt = current) => ({
  id, snippet: { title: 'Daily highlights', channelTitle: 'Forsen Highlights', channelId: 'forsen', publishedAt,
    liveBroadcastContent: 'none' },
  status: { embeddable: true }, contentDetails: { duration },
});
const upload = (id, title = 'Daily highlights', channel = 'Forsen Highlights', publishedAt = current) => ({
  snippet: { title, videoOwnerChannelTitle: channel }, contentDetails: { videoId: id, videoPublishedAt: publishedAt },
});

async function setup(handler) {
  const requests = [];
  globalThis.google = { accounts: { oauth2: {
    hasGrantedAllScopes: () => true,
    initTokenClient: ({ callback }) => ({ requestAccessToken: () => callback({ access_token: 'mock', expires_in: 3600 }) }),
  } } };
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requests.push(url);
    const data = await handler(url.pathname.split('/').at(-1), url.searchParams);
    return { ok: true, status: 200, json: async () => data };
  };
  const catalog = await import(moduleUrl(catalogSource + '\n// instance ' + instance++));
  await catalog.connect('mock');
  return { catalog, requests };
}

// Match a channel even when none of its video titles repeat the search query.
// Simulate Shorts crowding the API and verify dates are applied to uploads,
// not to channel discovery.
test('entertainment discovers matching channel uploads, removes Shorts, preserves dates and deduplicates', async () => {
  const { catalog, requests } = await setup((resource, params) => {
    if (resource === 'search' && params.get('type') === 'channel') return { items: [
      { id: { channelId: 'forsen' }, snippet: { title: 'Forsen Highlights' } },
      { id: { channelId: 'unrelated' }, snippet: { title: 'Other Highlights' } },
    ] };
    if (resource === 'search') return { items: [{ id: { videoId: params.get('videoDuration') === 'medium' ? 'short' : 'long' } }] };
    if (resource === 'channels') {
      assert.equal(params.get('id'), 'forsen');
      return { items: [{ contentDetails: { relatedPlaylists: { uploads: 'forsen-uploads' } } }] };
    }
    if (resource === 'playlistItems') return { items: [upload('daily'), upload('short'), upload('old', undefined, undefined, old), upload('long')] };
    if (resource === 'videos') return { items: params.get('id').split(',').map(id => video(id,
      id === 'short' ? 'PT3M' : id === 'long' ? 'PT1H2M' : 'PT12M', id === 'old' ? old : current)) };
    throw new Error('Unexpected request: ' + resource);
  });
  const items = await catalog.searchYouTube('forsen highlights', false, 'today', 'entertainment');
  assert.deepEqual(items.map(item => item.id), ['daily', 'long']);
  assert.equal(new Set(items.map(item => item.id)).size, items.length);
  const searches = requests.filter(url => url.pathname.endsWith('/search'));
  assert(!searches.find(url => url.searchParams.get('type') === 'channel').searchParams.has('publishedAfter'));
  const videos = searches.filter(url => url.searchParams.get('type') === 'video');
  assert.deepEqual(videos.map(url => url.searchParams.get('videoDuration')).sort(), ['long', 'medium']);
  for (const url of videos) assert(url.searchParams.has('publishedAfter'));
});

test('subscription search ranks matching channel before the cap and filters Shorts before review', async () => {
  const { catalog } = await setup((resource, params) => {
    if (resource === 'subscriptions') return { items: [{ snippet: { resourceId: { channelId: 'forsen' } } }] };
    if (resource === 'channels') return { items: [{ contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] };
    if (resource === 'playlistItems') return { items: [
      ...Array.from({ length: 45 }, (_, i) => upload('other-' + i, 'Other upload', 'Unrelated', new Date(Date.now() - 1000).toISOString())),
      upload('daily'), upload('short'), upload('old', undefined, undefined, old),
    ] };
    if (resource === 'videos') return { items: params.get('id').split(',').map(id => video(id, id === 'short' ? 'PT59S' : 'PT10M')) };
    throw new Error('Unexpected request: ' + resource);
  });
  const items = await catalog.subscriptionVideos('today', 'forsen highlights');
  assert.equal(items[0].id, 'daily');
  assert.equal(items.length, 40);
  assert(!items.some(item => ['short', 'old'].includes(item.id)));
});

test('informative searches still allow short lessons; channel recommendations ignore video dates', async () => {
  const { catalog, requests } = await setup((resource, params) => {
    if (resource === 'search' && params.get('type') === 'channel') return { items: [{ id: { channelId: 'learn' }, snippet: { title: 'Learn' } }] };
    if (resource === 'search') return { items: [{ id: { videoId: 'lesson' } }] };
    if (resource === 'videos') return { items: [video('lesson', 'PT2M')] };
    throw new Error('Unexpected request: ' + resource);
  });
  assert.equal((await catalog.searchYouTube('lesson', false, 'any'))[0].id, 'lesson');
  assert.equal((await catalog.searchYouTube('lesson', true, 'today'))[0].id, 'learn');
  for (const url of requests.filter(url => url.pathname.endsWith('/search'))) {
    assert(!url.searchParams.has('publishedAfter'));
    assert(!url.searchParams.has('videoDuration'));
  }
});
