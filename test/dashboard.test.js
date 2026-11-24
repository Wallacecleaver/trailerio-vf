import assert from 'node:assert/strict';
import test from 'node:test';
import { createActivity, monitorFetch } from '../src/activity.js';
import { createDashboard } from '../src/dashboard.js';
import { createAddon } from '../src/index.js';

const auth = value => `Basic ${Buffer.from(value).toString('base64')}`;

test('le tableau et les logs exigent le mot de passe, et restent fermés sans configuration', async () => {
  const activity = createActivity({ write: () => {} });
  activity.error('TMDB', 'HTTP 503');
  const disabled = await createDashboard('', activity);
  assert.equal(disabled('/dashboard/api', 'GET', auth('admin:exemple')).status, 404);
  assert.equal(disabled('/manifest.json', 'GET'), null);

  const handle = await createDashboard('exemple', activity);
  const redirect = handle('/dashboard', 'GET');
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/dashboard/');
  for (const url of ['/dashboard/', '/dashboard/api', '/dashboard/app.js', '/dashboard/style.css']) {
    const response = handle(url, 'GET', auth('admin:incorrect'));
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /^Basic realm=/);
    assert.doesNotMatch(await response.text(), /TMDB|503/);
  }

  const page = handle('/dashboard/', 'GET', auth('admin:exemple'));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Journal d’activité/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const api = handle('/dashboard/api', 'GET', auth('admin:exemple'));
  assert.equal(api.headers.get('access-control-allow-origin'), null);
  assert.equal((await api.json()).entries[0].detail, 'HTTP 503');
});

test('les statistiques continuent au-delà de la taille maximale du journal', () => {
  const emitted = [];
  const activity = createActivity({ limit: 2, write: event => emitted.push(event) });
  const lookup = { id: 'tt1234567', type: 'movie', title: 'Exemple', durationMs: 12 };
  activity.lookup({ ...lookup, providers: [] });
  activity.lookup({ ...lookup, providers: ['AlloCiné · VF'] });
  activity.error('TMDB', 'HTTP 503');
  const snapshot = activity.snapshot();
  assert.deepEqual(snapshot.stats, { searches: 2, withVf: 1, withoutVf: 1, errors: 1 });
  assert.deepEqual(snapshot.entries.map(item => item.event), ['error', 'vf']);
  assert.equal(emitted.length, 3);
});

test('une recherche reste disponible si une source échoue et les logs masquent ses données sensibles', async () => {
  const emitted = [];
  const activity = createActivity({ write: event => emitted.push(event) });
  const fetcher = monitorFetch(activity, async () => { throw new Error('https://api.themoviedb.org?api_key=secret-test'); });
  const addon = createAddon({ fetcher, onLookup: activity.lookup });
  const request = new Request('http://example.test/meta/movie/tt1234567.json?private=secret-test');
  assert.deepEqual((await (await addon(request, { tmdbApiKey: 'secret-test' })).json()).meta.links, []);
  assert.deepEqual(emitted.map(item => item.event), ['error', 'empty']);
  assert.equal(emitted[0].source, 'TMDB');
  assert.doesNotMatch(JSON.stringify(emitted), /secret-test|api_key|private=/);
});
