import { findTrailers } from './providers.js';

const TMDB_API_KEY = 'bfe73358661a995b992ae9a812aa0d2f';
const TYPES = ['movie', 'series'];
const CACHE_LIMIT = 512;
const SUCCESS_TTL = 15 * 60_000;
const EMPTY_TTL = 60_000;
const MANIFEST = {
  id: 'io.trailerio.lite',
  version: '1.1.0',
  name: 'Trailerio VF',
  description: 'Bandes-annonces en français pour les films et séries dans Fusion.',
  resources: [{ name: 'meta', types: TYPES, idPrefixes: ['tt'] }],
  types: TYPES,
  idPrefixes: ['tt'],
  catalogs: []
};

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

  async function getTrailers(imdbId, type, tmdbApiKey) {
    const key = `${type}:${imdbId}`;
    const cached = cache.get(key);
    if (cached?.expiresAt > Date.now()) return cached.result;
    if (pending.has(key)) return pending.get(key);

    const lookup = findTrailers(fetcher, imdbId, type, tmdbApiKey).then(result => {
      const ttl = result.apple || result.allocine.length ? SUCCESS_TTL : EMPTY_TTL;
      cache.delete(key);
      cache.set(key, { result, expiresAt: Date.now() + ttl });
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
      return result;
    });
    if (coalesce) pending.set(key, lookup);

    try {
      return await lookup;
    } finally {
      pending.delete(key);
    }
  }

  return async function handleRequest(request, { tmdbApiKey = TMDB_API_KEY, icon } = {}) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'Méthode non autorisée' }, 405, { Allow: 'GET, HEAD, OPTIONS' });
    }

    if (url.pathname === '/health') return json({ status: 'ok' });
    if (url.pathname === '/manifest.json') {
      const logo = icon
        ? new URL('/icon.png', url).href
        : 'https://raw.githubusercontent.com/Wallacecleaver/trailerio-vf/main/icon.png';
      return json({ ...MANIFEST, logo });
    }
    if (url.pathname === '/icon.png' && icon) {
      return new Response(icon, { headers: { ...CORS, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
    }

    const meta = url.pathname.match(/^\/meta\/(movie|series)\/(tt\d{7,12})(?::\d+){0,2}\.json$/);
    if (meta) {
      const startedAt = performance.now();
      const [, type, id] = meta;
      const { title, allocine, apple } = await getTrailers(id, type, tmdbApiKey);
      const links = allocine.map(trailers => ({ trailers, provider: 'AlloCiné · VF' }));
      if (apple) {
        const trailers = new URL(`/bande-annonce/${type}/${id}.m3u8`, url).href;
        links.push({ trailers, provider: 'Apple TV · VF' });
      }
      if (request.method === 'GET') {
        onLookup?.({ id, type, title, providers: [...new Set(links.map(link => link.provider))], durationMs: Math.round(performance.now() - startedAt) });
      }
      return json({ meta: { id, type, name: title, links } });
    }

    const trailer = url.pathname.match(/^\/bande-annonce\/(movie|series)\/(tt\d{7,12})\.m3u8$/);
    if (trailer) {
      const [, type, id] = trailer;
      const { apple } = await getTrailers(id, type, tmdbApiKey);
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
