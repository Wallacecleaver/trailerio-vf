import assert from 'node:assert/strict';
import test from 'node:test';
import { createAddon } from '../src/index.js';

const base = 'https://trailers.example.com';
const frenchTrailer = (key, name, options = {}) => ({
  key, name, site: 'YouTube', iso_639_1: 'fr', type: 'Trailer', official: true, ...options
});

test('le manifeste Nuvio est distinct et annonce les identifiants IMDb et TMDB', async () => {
  const addon = createAddon();
  const fusion = await (await addon(new Request(`${base}/manifest.json`))).json();
  const nuvio = await (await addon(new Request(`${base}/nuvio/manifest.json`))).json();
  assert.equal(fusion.id, 'io.trailerio.lite');
  assert.deepEqual(fusion.idPrefixes, ['tt']);
  assert.equal(nuvio.id, 'io.trailerio.nuvio');
  assert.deepEqual(nuvio.resources, [{ name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'] }]);
});

test('Nuvio reçoit des identifiants YouTube VF et conserve la fiche du film', async () => {
  const addon = createAddon({ fetcher: async input => {
    const url = new URL(input);
    if (url.hostname === 'v3-cinemeta.strem.io') return Response.json({ meta: {
      id: 'tt15398776', type: 'movie', name: 'Original', cast: ['Acteur'],
      links: [{ category: 'cast', name: 'Acteur', url: 'https://example.test/actor' }, { category: 'Trailer', url: 'https://example.test/vo' }],
      trailerStreams: [{ ytId: 'videoVO1234' }]
    } });
    if (url.pathname === '/3/find/tt15398776') return Response.json({ movie_results: [{ id: 42 }] });
    assert.equal(url.pathname, '/3/movie/42');
    assert.equal(url.searchParams.get('language'), 'fr-FR');
    return Response.json({ title: 'Titre français', original_language: 'en', overview: 'Résumé en français', videos: { results: [
      frenchTrailer('videoVO1234', 'Bande-annonce (VOSTFR)'),
      frenchTrailer('doubt123456', 'Bande-annonce officielle'),
      frenchTrailer('videoVF1234', 'Bande-annonce [VF]'),
      frenchTrailer('videoVF1234', 'Bande-annonce VF'),
      frenchTrailer('bad', 'Bande-annonce VF'),
      frenchTrailer('videoVfEng0', 'Bande-annonce VF', { iso_639_1: 'en' }),
      frenchTrailer('mixed123456', 'Bande-annonce VF / VO'),
      frenchTrailer('other123456', 'Bande-annonce VF', { site: 'Dailymotion' })
    ] } });
  } });
  const request = new Request(`${base}/nuvio/meta/movie/tt15398776.json`);
  const response = await addon(request);
  const { meta } = await response.json();
  assert.equal(meta.name, 'Titre français');
  assert.equal(meta.description, 'Résumé en français');
  assert.deepEqual(meta.cast, ['Acteur']);
  assert.equal(meta.links.length, 1);
  assert.deepEqual(meta.trailers.map(({ site, key, source }) => ({ site, key, source })), [
    { site: 'YouTube', key: 'videoVF1234', source: 'videoVF1234' }
  ]);
  assert.deepEqual(meta.trailerStreams, [{ ytId: 'videoVF1234' }]);
  assert.equal(response.headers.get('x-trailerio-cache'), 'MISS');
  assert.equal((await addon(request)).headers.get('x-trailerio-cache'), 'HIT');
});

test('un identifiant TMDB encodé trouve une VF de saison et garde les épisodes Cinemeta', async () => {
  const episode = { id: 'tt3581920:2:1', title: 'Épisode 1', season: 2, episode: 1 };
  const addon = createAddon({ fetcher: async input => {
    const url = new URL(input);
    if (url.pathname === '/3/tv/100088') return Response.json({
      name: 'The Last of Us', original_language: 'en', external_ids: { imdb_id: 'tt3581920' },
      seasons: [{ season_number: 0 }, { season_number: 1 }, { season_number: 2 }],
      videos: { results: [frenchTrailer('videoVO1234', 'Bande-annonce V.O.S.T.FR')] }
    });
    if (url.pathname === '/3/tv/100088/season/1/videos') return Response.json({ results: [] });
    if (url.pathname === '/3/tv/100088/season/2/videos') {
      return Response.json({ results: [frenchTrailer('videoVF1234', 'Teaser (VF)', { type: 'Teaser' })] });
    }
    if (url.pathname === '/meta/series/tt3581920.json') {
      return Response.json({ meta: { id: 'tt3581920', type: 'series', videos: [episode] } });
    }
    assert.fail(`URL inattendue ${url.hostname}${url.pathname}`);
  } });
  const response = await addon(new Request(`${base}/nuvio/meta/series/tmdb%3A100088%3A2%3A1.json`));
  const { meta } = await response.json();
  assert.equal(meta.id, 'tmdb:100088');
  assert.equal(meta.imdb_id, 'tt3581920');
  assert.deepEqual(meta.videos, [episode]);
  assert.equal(meta.trailers[0].seasonNumber, 2);
  assert.equal(meta.trailers[0].key, 'videoVF1234');
});

test('les saisons TMDB complètent une série française si Cinemeta est indisponible', async () => {
  const addon = createAddon({ fetcher: async input => {
    const url = new URL(input);
    if (url.hostname === 'v3-cinemeta.strem.io') return new Response(null, { status: 503 });
    if (url.pathname === '/3/find/tt2531336') return Response.json({ tv_results: [{ id: 55 }] });
    if (url.searchParams.get('append_to_response') === 'season/1,season/2') return Response.json({
      'season/1': { episodes: [{ season_number: 1, episode_number: 1, name: 'Chapitre 1' }] },
      'season/2': { episodes: [{ season_number: 2, episode_number: 1, name: 'Chapitre 2' }] }
    });
    return Response.json({ name: 'Lupin', original_language: 'fr', seasons: [{ season_number: 1 }, { season_number: 2 }],
      videos: { results: [frenchTrailer('videoVF1234', 'Bande-annonce officielle')] } });
  } });
  const response = await addon(new Request(`${base}/nuvio/meta/series/tt2531336.json`));
  const { meta } = await response.json();
  assert.deepEqual(meta.videos.map(episode => [episode.id, episode.title]), [
    ['tt2531336:1:1', 'Chapitre 1'], ['tt2531336:2:1', 'Chapitre 2']
  ]);
  assert.equal(meta.trailers[0].key, 'videoVF1234');
});

test('une VO sous-titrée seule laisse Nuvio passer au fournisseur de fiches suivant', async () => {
  const addon = createAddon({ fetcher: async input => {
    const url = new URL(input);
    if (url.hostname === 'v3-cinemeta.strem.io') return Response.json({ meta: { name: 'Exemple' } });
    if (url.pathname.startsWith('/3/find/')) return Response.json({ movie_results: [{ id: 42 }] });
    return Response.json({ title: 'Exemple', original_language: 'en', videos: { results: [frenchTrailer('videoVO1234', 'Bande-annonce VOST')] } });
  } });
  const response = await addon(new Request(`${base}/nuvio/meta/movie/tt1234567.json`));
  assert.deepEqual(await response.json(), { meta: null });
});
