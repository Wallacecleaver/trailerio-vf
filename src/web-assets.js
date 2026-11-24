import { readFile } from 'node:fs/promises';

export const PAGE_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};

export async function loadAssets(directory, routes) {
  return new Map(await Promise.all(Object.entries(routes).map(async ([route, [file, contentType]]) => {
    const body = await readFile(new URL(file, directory));
    return [route, { body, contentType }];
  })));
}

export function serveAsset(asset, headers = PAGE_HEADERS) {
  return new Response(asset.body, { headers: { ...headers, 'Content-Type': asset.contentType } });
}
