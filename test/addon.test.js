import assert from 'node:assert/strict';
import test from 'node:test';
import { frenchApplePlaylist } from '../src/apple-hls.js';
import { createAddon } from '../src/index.js';

const applePreview = 'https://play-edge.itunes.apple.com/preview.m3u8';
const allocineMp4 = 'https://fr.vid.web.acsta.net/trailer.mp4';
const movieMaster = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="mixed",NAME="Anglais",LANGUAGE="en",DEFAULT=YES,URI="en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="mixed",NAME="Français, France",LANGUAGE="fr-FR",DEFAULT=NO,URI="fr.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="english",NAME="Anglais",LANGUAGE="en",DEFAULT=YES,URI="only-en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",NAME="Français",LANGUAGE="fr",URI="sub.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="mixed",SUBTITLES="sub",CODECS="avc1.64001f,mp4a.40.2"
video.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1500000,AUDIO="english"
video-en.m3u8
`;

test('Apple TV ne conserve que l’audio français et ne prend pas une piste de sous-titres pour de l’audio', () => {
  const playlist = frenchApplePlaylist(movieMaster, applePreview);
  assert.match(playlist, /LANGUAGE="fr-FR",DEFAULT=YES,URI="https:\/\/play-edge\.itunes\.apple\.com\/fr\.m3u8"/);
  assert.match(playlist, /CODECS="avc1\.64001f,mp4a\.40\.2"/);
  assert.match(playlist, /https:\/\/play-edge\.itunes\.apple\.com\/video\.m3u8/);
  assert.doesNotMatch(playlist, /LANGUAGE="en"|SUBTITLES|video-en|only-en/);
  assert.equal(frenchApplePlaylist(movieMaster.replace('LANGUAGE="fr-FR"', 'LANGUAGE="en"'), applePreview), null);
  assert.equal(frenchApplePlaylist(movieMaster.replace('URI="fr.m3u8"', 'URI="https://example.test/fr.m3u8"'), applePreview), null);
});

test('Fusion reçoit des liens directs VF, y compris une playlist Apple TV filtrée', async () => {
  const seen = [];
  const addon = createAddon({ fetcher: async input => {
    const url = new URL(input);
    seen.push(url);
    if (url.pathname === '/3/find/tt1234567') {
      assert.equal(url.searchParams.get('language'), 'fr-FR');
      assert.equal(url.searchParams.get('api_key'), 'clé de test');
      return Response.json({ movie_results: [{ id: 11, title: 'Titre français' }] });
    }
    if (url.pathname === '/3/movie/11/external_ids') return Response.json({ wikidata_id: 'Q11' });
    if (url.hostname === 'www.wikidata.org') {
      const claim = value => ({ mainsnak: { datavalue: { value } } });
      return Response.json({ entities: { Q11: { claims: { P1265: [claim('88')], P9586: [claim('umc.cmc.abc')] } } } });
    }
    if (url.pathname === '/videos/fichefilm-88/toutes/') {
      return new Response(`
        <a href="/video/player_gen_cmedia=1&amp;cfilm=88.html">Titre Bande-annonce VF</a>
        <a href="/video/player_gen_cmedia=2&amp;cfilm=88.html">Titre Bande-annonce VOSTFR</a>
        <a href="/video/player_gen_cmedia=3&amp;cfilm=77.html">Autre film Bande-annonce VF</a>
        <a href="/video/player_gen_cmedia=4&amp;cfilm=88.html">Titre Teaser VF</a>`);
    }
    if (url.pathname === '/video/player_gen_cmedia=1&cfilm=88.html') {
      return new Response(`<script type="application/ld+json">{"@type":"VideoObject","name":"Titre Bande-annonce VF","contentUrl":"${allocineMp4}"}</script>`);
    }
    if (url.pathname === '/video/player_gen_cmedia=4&cfilm=88.html') {
      return new Response('<script type="application/ld+json">{"@type":"VideoObject","name":"Titre Teaser VO","contentUrl":"https://fr.vid.web.acsta.net/vo.mp4"}</script>');
    }
    if (url.pathname === '/fr/movie/umc.cmc.abc') return new Response(`<meta property="og:video" content="${applePreview}">`);
    if (url.href === applePreview) return new Response(movieMaster);
    assert.fail(`URL inattendue ${url.hostname}${url.pathname}`);
  } });

  const base = 'https://trailers.example.com';
  const config = { tmdbApiKey: 'clé de test' };
  const meta = await addon(new Request(`${base}/meta/movie/tt1234567.json`), config);
  assert.equal(meta.headers.get('x-trailerio-cache'), 'MISS');
  const appleLink = `${base}/bande-annonce/movie/tt1234567.m3u8`;
  assert.deepEqual(await meta.json(), { meta: {
    id: 'tt1234567', type: 'movie', name: 'Titre français', links: [
      { trailers: allocineMp4, provider: 'AlloCiné · VF' },
      { trailers: appleLink, provider: 'Apple TV · VF' }
    ]
  } });
  assert.equal(seen.filter(url => url.pathname.startsWith('/video/player')).length, 2);
  const requestCount = seen.length;
  const hls = await addon(new Request(appleLink), config);
  assert.equal(hls.headers.get('content-type'), 'application/vnd.apple.mpegurl');
  assert.match(await hls.text(), /LANGUAGE="fr-FR"/);
  assert.equal(seen.length, requestCount);
  const repeated = await addon(new Request(`${base}/meta/movie/tt1234567.json`), config);
  assert.equal(repeated.headers.get('x-trailerio-cache'), 'HIT');
  assert.equal(seen.length, requestCount);
});

test('Une série sans source VF renvoie une liste vide et garde son titre localisé', async () => {
  const addon = createAddon({ fetcher: async input => {
    const { pathname, searchParams } = new URL(input);
    if (pathname === '/3/find/tt1234567') return Response.json({ tv_results: [{ id: 12, name: 'Série française' }] });
    if (pathname === '/3/tv/12/external_ids') return Response.json({ wikidata_id: null });
    if (searchParams.get('srsearch') === 'haswbstatement:P345=tt1234567') return Response.json({ query: { search: [] } });
    assert.fail(`URL inattendue ${pathname}`);
  } });
  const base = 'https://trailers.example.com';
  const response = await addon(new Request(`${base}/meta/series/tt1234567%3a1%3A2.json`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    meta: { id: 'tt1234567', type: 'series', name: 'Série française', links: [] }
  });
  const missing = await addon(new Request(`${base}/bande-annonce/series/tt1234567.m3u8`));
  assert.equal(missing.status, 404);
});

test('Wikidata retrouve les sources VF avec un IMDb exact quand TMDB ne répond pas', async () => {
  const visited = [];
  const claim = (value, rank = 'normal') => ({ rank, mainsnak: { datavalue: { value } } });
  const addon = createAddon({ fetcher: async input => {
    const url = new URL(input);
    visited.push(url.pathname);
    if (url.hostname === 'api.themoviedb.org') return new Response(null, { status: 503 });
    if (url.searchParams.get('srsearch') === 'haswbstatement:P345=tt1234567') {
      return Response.json({ query: { search: [{ title: 'Q1' }, { title: 'Q2' }] } });
    }
    if (url.searchParams.get('ids') === 'Q1|Q2') {
      return Response.json({ entities: {
        Q1: { claims: { P345: [claim('tt1234567', 'deprecated')], P1265: [claim('999')] } },
        Q2: { labels: { fr: { value: 'Le titre français' } }, claims: {
          P345: [claim('tt1234567')],
          P1265: [claim('777', 'deprecated'), claim('888'), claim('66', 'preferred')]
        } }
      } });
    }
    if (url.pathname === '/videos/fichefilm-66/toutes/') {
      return new Response('<a href="/video/player_gen_cmedia=1&amp;cfilm=66.html">Titre Bande-annonce VF</a>');
    }
    if (url.pathname === '/video/player_gen_cmedia=1&cfilm=66.html') {
      return new Response(`<script type="application/ld+json">{"@type":"VideoObject","name":"Titre Bande-annonce VF","contentUrl":"${allocineMp4}"}</script>`);
    }
    assert.fail(`URL inattendue ${url.hostname}${url.pathname}`);
  } });
  const response = await addon(new Request('https://trailers.example.com/meta/movie/tt1234567.json'));
  assert.deepEqual((await response.json()).meta, {
    id: 'tt1234567', type: 'movie', name: 'Le titre français', links: [{ trailers: allocineMp4, provider: 'AlloCiné · VF' }]
  });
  assert.deepEqual(visited.filter(path => path.startsWith('/videos/')), ['/videos/fichefilm-66/toutes/']);
});
