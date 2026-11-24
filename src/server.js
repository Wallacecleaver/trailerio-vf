import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createActivity, monitorFetch } from './activity.js';
import { createDashboard } from './dashboard.js';
import { createAddon } from './index.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 7000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT doit être compris entre 1 et 65535.');

const publicUrl = new URL(process.env.PUBLIC_URL || `http://127.0.0.1:${port}`);
if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) {
  throw new Error('PUBLIC_URL doit être une URL de base HTTP ou HTTPS.');
}

const activity = createActivity();
const addon = createAddon({ fetcher: monitorFetch(activity), onLookup: activity.lookup });
const dashboard = await createDashboard(process.env.DASHBOARD_PASSWORD, activity);
const icon = await readFile(new URL('../icon.png', import.meta.url));
const tmdbApiKey = process.env.TMDB_API_KEY || undefined;

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, publicUrl);
    if (url.origin !== publicUrl.origin) {
      outgoing.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      outgoing.end(JSON.stringify({ error: 'URL invalide' }));
      return;
    }

    const response = dashboard(url.pathname, incoming.method, incoming.headers.authorization)
      || await addon({ url: url.href, method: incoming.method }, { icon, tmdbApiKey });
    const body = incoming.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer());
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(body);
  } catch {
    activity.error('Serveur', 'Erreur pendant le traitement d’une requête');
    outgoing.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    outgoing.end(JSON.stringify({ error: 'Erreur interne' }));
  }
});

server.listen(port, host, () => console.log(`Trailerio VF écoute sur ${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
