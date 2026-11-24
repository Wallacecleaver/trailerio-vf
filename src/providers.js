import { frenchApplePlaylist } from './apple-hls.js';

const ALLOCINE_ORIGIN = 'https://www.allocine.fr';
const APPLE_PREVIEW_HOSTS = new Set(['play.itunes.apple.com', 'play-edge.itunes.apple.com']);
const FRENCH_TRAILER = /\b(?:bande[\s-]annonce|teaser)(?:\s*\(\d+\))?\s+(?:VF|VFF|VFQ)\s*$/i;
const ALLOCINE_ID = /^\d+$/;
const APPLE_ID = /^umc\.cmc\.[a-z0-9]+$/i;
const WIKIDATA_ID = /^Q[1-9]\d*$/;
const WIKIDATA_HEADERS = { 'User-Agent': 'Trailerio-VF/1.2 (https://github.com/Wallacecleaver/trailerio-vf)' };
const TIMEOUT_MS = 4500;

async function read(fetcher, url, format, options = {}) {
  try {
    const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    return await response[format]();
  } catch {
    return null;
  }
}

function tmdbUrl(path, key, params = {}) {
  const url = new URL(`/3/${path}`, 'https://api.themoviedb.org');
  url.search = new URLSearchParams({ api_key: key, ...params });
  return url;
}

async function findMetadata(fetcher, imdbId, type, key) {
  const lookup = await read(fetcher, tmdbUrl(`find/${imdbId}`, key, {
    external_source: 'imdb_id',
    language: 'fr-FR'
  }), 'json', { redirect: 'error' });
  const series = type === 'series';
  const result = (series ? lookup?.tv_results : lookup?.movie_results)?.[0];
  if (!Number.isSafeInteger(result?.id)) return {};

  const media = series ? 'tv' : 'movie';
  const ids = await read(fetcher, tmdbUrl(`${media}/${result.id}/external_ids`, key), 'json', { redirect: 'error' });
  return { title: series ? result.name : result.title, wikidataId: ids?.wikidata_id };
}

function readWikidata(fetcher, params) {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.search = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  return read(fetcher, url, 'json', { headers: WIKIDATA_HEADERS });
}

async function findWikidataCandidates(fetcher, imdbId) {
  const data = await readWikidata(fetcher, {
    action: 'query', list: 'search', srsearch: `haswbstatement:P345=${imdbId}`, srnamespace: '0', srlimit: '4', srprop: ''
  });
  const matches = data?.query?.search;
  return Array.isArray(matches)
    ? [...new Set(matches.map(item => item?.title).filter(id => typeof id === 'string' && WIKIDATA_ID.test(id)))].slice(0, 4)
    : [];
}

function claimValues(entity, property) {
  const claims = entity?.claims?.[property];
  if (!Array.isArray(claims)) return [];

  return claims
    .filter(claim => claim && claim.rank !== 'deprecated')
    .sort((left, right) => Number(right.rank === 'preferred') - Number(left.rank === 'preferred'))
    .map(claim => claim.mainsnak?.datavalue?.value)
    .filter(value => typeof value === 'string' && value.length > 0);
}

async function findProviderIds(fetcher, imdbId, wikidataId, type) {
  const knownId = typeof wikidataId === 'string' && WIKIDATA_ID.test(wikidataId);
  const ids = knownId ? [wikidataId] : await findWikidataCandidates(fetcher, imdbId);
  if (!ids.length) return {};

  const data = await readWikidata(fetcher, { action: 'wbgetentities', ids: ids.join('|'), props: 'claims|labels', languages: 'fr' });
  const series = type === 'series';
  const candidates = [];
  for (const id of ids) {
    const entity = data?.entities?.[id];
    if (!entity || (!knownId && !claimValues(entity, 'P345').includes(imdbId))) continue;

    candidates.push({
      title: entity.labels?.fr?.value,
      allocineId: claimValues(entity, series ? 'P1267' : 'P1265').find(value => ALLOCINE_ID.test(value)),
      appleId: claimValues(entity, series ? 'P9751' : 'P9586').find(value => APPLE_ID.test(value))
    });
  }
  return candidates.find(candidate => candidate.allocineId || candidate.appleId) || candidates[0] || {};
}

function decodeHtml(value) {
  const entities = { amp: '&', quot: '"', apos: "'", nbsp: ' ', '#38': '&', '#39': "'", '#160': ' ' };
  return value.replace(/&(amp|quot|apos|nbsp|#38|#39|#160);/g, (_, entity) => entities[entity]);
}

function allocineVideoPages(html, id, type) {
  const videos = new Map();
  const parameter = type === 'series' ? 'cserie' : 'cfilm';
  const path = new RegExp(`^/video/player_gen_cmedia=(\\d+)&${parameter}=${id}\\.html$`);
  for (const [, href, content] of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const match = decodeHtml(href).match(path);
    const title = decodeHtml(content.replace(/<[^>]*>/g, '')).trim();
    if (match && FRENCH_TRAILER.test(title)) videos.set(match[1], match[0]);
  }
  return [...videos.values()].slice(0, 4);
}

function allocineMediaUrl(html) {
  for (const [, script] of html.matchAll(/<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const video = JSON.parse(script);
      if (video['@type'] !== 'VideoObject' || !FRENCH_TRAILER.test(video.name)) continue;

      const url = new URL(video.contentUrl);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.acsta.net') || url.username || url.password) continue;
      if (/\.mp4$/i.test(url.pathname)) return url.href;
    } catch {
      continue;
    }
  }
  return null;
}

async function resolveAllocine(fetcher, id, type) {
  if (!id) return [];

  const listing = type === 'series' ? `/series/ficheserie-${id}/videos/` : `/videos/fichefilm-${id}/toutes/`;
  const html = await read(fetcher, new URL(listing, ALLOCINE_ORIGIN), 'text');
  if (!html) return [];

  const pages = allocineVideoPages(html, id, type);
  const direct = await Promise.all(pages.map(async page => {
    const player = await read(fetcher, new URL(page, ALLOCINE_ORIGIN), 'text');
    return player && allocineMediaUrl(player);
  }));
  return [...new Set(direct.filter(Boolean))];
}

function applePreviewUrl(html) {
  for (const [, content] of html.matchAll(/<meta\b[^>]*\bproperty=["']og:video(?::secure_url)?["'][^>]*\bcontent=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(decodeHtml(content));
      if (url.protocol === 'https:' && APPLE_PREVIEW_HOSTS.has(url.hostname) && url.pathname.endsWith('.m3u8') && !url.username && !url.password) {
        return url;
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function resolveApple(fetcher, id, type) {
  if (!id) return null;

  const path = type === 'series' ? 'show' : 'movie';
  const html = await read(fetcher, `https://tv.apple.com/fr/${path}/${id}`, 'text');
  const url = applePreviewUrl(html || '');
  if (!url) return null;

  const playlist = await read(fetcher, url, 'text', { redirect: 'error' });
  return playlist && frenchApplePlaylist(playlist, url);
}

export async function findTrailers(fetcher, imdbId, type, key) {
  const metadata = await findMetadata(fetcher, imdbId, type, key);
  const { title, allocineId, appleId } = await findProviderIds(fetcher, imdbId, metadata.wikidataId, type);
  const [allocine, apple] = await Promise.all([
    resolveAllocine(fetcher, allocineId, type),
    resolveApple(fetcher, appleId, type)
  ]);
  return { title: metadata.title || title || imdbId, allocine, apple };
}
