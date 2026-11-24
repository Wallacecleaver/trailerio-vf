import { loadAssets, serveAsset } from './web-assets.js';

export async function createSite(dashboardEnabled = false) {
  const assets = await loadAssets(new URL('./site/', import.meta.url), {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/site/style.css': ['style.css', 'text/css; charset=utf-8'],
    '/site/app.js': ['app.js', 'text/javascript; charset=utf-8']
  });
  const home = assets.get('/');
  const dashboard = dashboardEnabled ? '<a class="admin" href="/dashboard/">Tableau de bord</a>' : '';
  home.body = home.body.toString('utf8').replace('<!-- dashboard -->', dashboard);

  return (pathname, method) => {
    const asset = assets.get(pathname);
    return asset && (method === 'GET' || method === 'HEAD') ? serveAsset(asset) : null;
  };
}
