import { createHash, timingSafeEqual } from 'node:crypto';
import { loadAssets, PAGE_HEADERS, serveAsset } from './web-assets.js';

const ASSETS = {
  '/dashboard': ['index.html', 'text/html; charset=utf-8'],
  '/dashboard/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/dashboard/app.js': ['app.js', 'text/javascript; charset=utf-8']
};
const HEADERS = { ...PAGE_HEADERS, 'X-Robots-Tag': 'noindex' };

const digest = value => createHash('sha256').update(value).digest();

function authenticated(authorization, expected) {
  const token = /^Basic ([a-z\d+/]+=*)$/i.exec(authorization || '')?.[1];
  return Boolean(token && timingSafeEqual(digest(Buffer.from(token, 'base64')), expected));
}

export async function createDashboard(password, activity) {
  const expected = password ? digest(`admin:${password}`) : null;
  const assets = expected ? await loadAssets(new URL('./dashboard/', import.meta.url), ASSETS) : new Map();

  return (pathname, method, authorization) => {
    if (pathname !== '/dashboard' && !pathname.startsWith('/dashboard/')) return null;
    if (!expected) return new Response('Ressource introuvable', { status: 404, headers: HEADERS });
    if (pathname === '/dashboard' && (method === 'GET' || method === 'HEAD')) {
      return new Response(null, { status: 308, headers: { ...HEADERS, Location: '/dashboard/' } });
    }
    if (!authenticated(authorization, expected)) {
      const headers = { ...HEADERS, 'WWW-Authenticate': 'Basic realm="Trailerio VF", charset="UTF-8"' };
      return new Response('Identifiants requis', { status: 401, headers });
    }
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response('Méthode non autorisée', { status: 405, headers: { ...HEADERS, Allow: 'GET, HEAD' } });
    }
    if (pathname === '/dashboard/api') return Response.json(activity.snapshot(), { headers: HEADERS });

    const asset = assets.get(pathname === '/dashboard/' ? '/dashboard' : pathname);
    if (!asset) return new Response('Ressource introuvable', { status: 404, headers: HEADERS });
    return serveAsset(asset, HEADERS);
  };
}
