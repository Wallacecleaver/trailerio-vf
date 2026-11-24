import { findTrailers } from './providers.js';
import { findNuvioMeta } from './nuvio.js';

const TMDB_API_KEY = 'bfe73358661a995b992ae9a812aa0d2f';
const TYPES = ['movie', 'series'];
const CACHE_LIMIT = 512;
const SUCCESS_TTL = 15 * 60_000;
const EMPTY_TTL = 60_000;
const MANIFEST = {
  id: 'io.trailerio.lite',
  version: '1.4.0',
  name: 'Trailerio VF',
  description: 'Bandes-annonces en français pour les films et séries dans Fusion.',
  resources: [{ name: 'meta', types: TYPES, idPrefixes: ['tt'] }],
  types: TYPES,
  idPrefixes: ['tt'],
  catalogs: []
};
const NUVIO_PREFIXES = ['tt', 'tmdb:'];
const NUVIO_MANIFEST = {
  ...MANIFEST,
  id: 'io.trailerio.nuvio',
  name: 'Trailerio VF pour Nuvio',
  description: 'Bandes-annonces et teasers YouTube en français pour Nuvio.',
  idPrefixes: NUVIO_PREFIXES,
  resources: [{ name: 'meta', types: TYPES, idPrefixes: NUVIO_PREFIXES }]
};
const MANIFESTS = new Map([
  ['/manifest.json', MANIFEST],
  ['/nuvio/manifest.json', NUVIO_MANIFEST],
  ['/nuvio-strict/manifest.json', {
    ...NUVIO_MANIFEST,
    id: 'io.trailerio.nuvio.strict',
    name: 'Trailerio VF strict pour Nuvio',
    description: 'Fiches Nuvio avec les bandes-annonces YouTube confirmées en VF.'
  }]
]);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { ...CORS, ...headers } });
}

export function createAddon({ fetcher = (...args) => fetch(...args), coalesce = true, onLookup } = {}) {
  const cache = new Map();
  const pending = new Map();

  async function getCached(key, resolve, hasResults) {
    const cached = cache.get(key);
    if (cached?.expiresAt > Date.now()) return { result: cached.result, cache: 'HIT' };
    if (pending.has(key)) return { result: await pending.get(key), cache: 'SHARED' };

    const lookup = resolve().then(result => {
      const ttl = hasResults(result) ? SUCCESS_TTL : EMPTY_TTL;
      cache.delete(key);
      cache.set(key, { result, expiresAt: Date.now() + ttl });
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
      return result;
    });
    if (coalesce) pending.set(key, lookup);

    try {
      return { result: await lookup, cache: 'MISS' };
    } finally {
      pending.delete(key);
    }
  }

  function getTrailers(imdbId, type, tmdbApiKey) {
    return getCached(`fusion:${type}:${imdbId}`, () => findTrailers(fetcher, imdbId, type, tmdbApiKey), result => result.apple || result.allocine.length);
  }

  return async function handleRequest(request, { tmdbApiKey = TMDB_API_KEY, icon } = {}) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'Méthode non autorisée' }, 405, { Allow: 'GET, HEAD, OPTIONS' });
    }

    if (url.pathname === '/health') return json({ status: 'ok' });
    const manifest = MANIFESTS.get(url.pathname);
    if (manifest) {
      const logo = icon
        ? new URL('/icon.png', url).href
        : 'https://raw.githubusercontent.com/Wallacecleaver/trailerio-vf/main/icon.png';
      return json({ ...manifest, logo });
    }
    if (url.pathname === '/icon.png' && icon) {
      return new Response(icon, { headers: { ...CORS, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
    }

    const nuvio = url.pathname.match(/^\/(nuvio(?:-strict)?)\/meta\/(movie|series)\/(tt\d{7,12}|tmdb(?::|%3[aA])\d{1,10})(?:(?::|%3[aA])\d+){0,2}\.json$/);
    if (nuvio) {
      const startedAt = performance.now();
      const [, variant, type, encodedId] = nuvio;
      const id = encodedId.replace(/%3a/gi, ':');
      const { result, cache } = await getCached(`${variant}:${type}:${id}`,
        () => findNuvioMeta(fetcher, id, type, tmdbApiKey, { allowEmptyTrailers: variant === 'nuvio-strict' }),
        meta => meta?.trailers.length > 0);
      if (request.method === 'GET') {
        onLookup?.({ id, type, title: result?.name || id, providers: result?.trailers.length ? ['YouTube · VF'] : [], durationMs: Math.round(performance.now() - startedAt) });
      }
      return json({ meta: result }, 200, { 'X-Trailerio-Cache': cache });
    }

    const meta = url.pathname.match(/^\/meta\/(movie|series)\/(tt\d{7,12})(?:(?::|%3[aA])\d+){0,2}\.json$/);
    if (meta) {
      const startedAt = performance.now();
      const [, type, id] = meta;
      const { result: { title, allocine, apple }, cache } = await getTrailers(id, type, tmdbApiKey);
      const links = allocine.map(trailers => ({ trailers, provider: 'AlloCiné · VF' }));
      if (apple) {
        const trailers = new URL(`/bande-annonce/${type}/${id}.m3u8`, url).href;
        links.push({ trailers, provider: 'Apple TV · VF' });
      }
      if (request.method === 'GET') {
        onLookup?.({ id, type, title, providers: [...new Set(links.map(link => link.provider))], durationMs: Math.round(performance.now() - startedAt) });
      }
      return json({ meta: { id, type, name: title, links } }, 200, { 'X-Trailerio-Cache': cache });
    }

    const trailer = url.pathname.match(/^\/bande-annonce\/(movie|series)\/(tt\d{7,12})\.m3u8$/);
    if (trailer) {
      const [, type, id] = trailer;
      const { result: { apple } } = await getTrailers(id, type, tmdbApiKey);
      if (apple) {
        return new Response(apple, {
          headers: { ...CORS, 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'public, max-age=300' }
        });
      }
    }

    return json({ error: 'Ressource introuvable' }, 404);
  };
}

const worker = createAddon({ coalesce: false });

export default {
  fetch(request, env) {
    return worker(request, { tmdbApiKey: env?.TMDB_API_KEY });
  }
};
