import { findTmdbTitle, read, readTmdb } from './providers.js';

const IMDb = /^tt\d{7,12}$/;
const YOUTUBE = /^[A-Za-z0-9_-]{11}$/;
const FRENCH = /\b(?:V\.?F\.?|VFF|VFQ|version fran[çc]aise|doubl[ée]e? en fran[çc]ais)\b/iu;
const SUBTITLED = /\b(?:V\.?O\.?\s*S\.?T\.?\s*(?:FR|F)?|V\.?O\.?|STFR|version originale|sous[-\s]titr[ée]e?)\b/iu;
const FRENCH_TITLE = /\b(?:bande[\s-]annonce|teaser)\b/iu;
const LANGUAGE = 'fr-FR';
const DEADLINE_MS = 4200;
const VERIFIED_TRAILERS = new Map([
  // Comment braquer une banque — the public YouTube upload is explicitly labelled VF.
  ['tt35866986', [{ key: 'uXFBBDDvCzk', name: 'Comment braquer une banque · Bande-annonce VF', site: 'YouTube', iso_639_1: 'fr', type: 'Trailer' }]]
]);

function trailersFrom(videos, originalLanguage, seasonNumber) {
  if (!Array.isArray(videos)) return [];

  return videos.filter(video => {
    const name = video?.name;
    if (typeof name !== 'string' || video.site !== 'YouTube' || video.iso_639_1 !== 'fr' || !YOUTUBE.test(video.key)) return false;
    if (SUBTITLED.test(name) || (video.type !== 'Trailer' && video.type !== 'Teaser')) return false;
    return FRENCH.test(name) || (originalLanguage === 'fr' && video.official === true && FRENCH_TITLE.test(name));
  }).map(video => ({
    id: video.key,
    key: video.key,
    source: video.key,
    site: 'YouTube',
    type: video.type,
    name: video.name,
    displayName: video.name,
    official: video.official === true,
    published_at: typeof video.published_at === 'string' ? video.published_at : undefined,
    ...(seasonNumber ? { seasonNumber } : {})
  }));
}

function sortTrailers(trailers) {
  const ranked = trailers.slice().sort((a, b) => Number(b.type === 'Trailer') - Number(a.type === 'Trailer')
    || Number(b.official) - Number(a.official)
    || (b.published_at || '').localeCompare(a.published_at || ''));
  const byKey = new Map();
  for (const trailer of ranked) if (!byKey.has(trailer.key)) byKey.set(trailer.key, trailer);
  return [...byKey.values()];
}

function image(pathname, size) {
  return typeof pathname === 'string' && /^\/[\w.-]+$/.test(pathname) ? `https://image.tmdb.org/t/p/${size}${pathname}` : undefined;
}

function fetchCinemeta(fetcher, type, id, signal) {
  return read(fetcher, `https://v3-cinemeta.strem.io/meta/${type}/${id}.json`, 'json', { signal });
}

function seasonNumbers(details) {
  const seasons = Array.isArray(details.seasons) ? details.seasons : [];
  return [...new Set(seasons.map(season => season?.season_number).filter(number => Number.isInteger(number) && number >= 0))];
}

async function seasonTrailers(fetcher, details, tmdbId, key, signal) {
  const recent = seasonNumbers(details).filter(number => number > 0).sort((a, b) => b - a).slice(0, 2);
  const groups = await Promise.all(recent.map(async number => {
    const result = await readTmdb(fetcher, `tv/${tmdbId}/season/${number}/videos`, key, { language: LANGUAGE }, signal);
    return trailersFrom(result?.results, details.original_language, number);
  }));
  return groups.flat();
}

async function fallbackEpisodes(fetcher, details, tmdbId, playbackId, key, signal) {
  const numbers = seasonNumbers(details).sort((a, b) => a - b);
  if (!numbers.length) return null;

  const episodes = [];
  for (let offset = 0; offset < numbers.length; offset += 20) {
    const batch = numbers.slice(offset, offset + 20).map(number => `season/${number}`);
    const data = await readTmdb(fetcher, `tv/${tmdbId}`, key, { language: LANGUAGE, append_to_response: batch.join(',') }, signal);
    if (!data || batch.some(path => !Array.isArray(data[path]?.episodes))) return null;

    for (const path of batch) {
      for (const episode of data[path].episodes) {
        if (!episode) continue;
        const { season_number: season, episode_number: number } = episode;
        if (!Number.isInteger(season) || !Number.isInteger(number)) continue;
        episodes.push({
          id: `${playbackId}:${season}:${number}`,
          title: episode.name || `Épisode ${number}`,
          season,
          episode: number,
          released: episode.air_date || undefined,
          overview: episode.overview || undefined,
          thumbnail: image(episode.still_path, 'w500'),
          runtime: episode.runtime || undefined
        });
      }
    }
  }
  return episodes.length ? episodes : null;
}

export async function findNuvioMeta(fetcher, requestedId, type, key, { allowEmptyTrailers = false } = {}) {
  const signal = AbortSignal.timeout(DEADLINE_MS);
  const byImdb = IMDb.test(requestedId);
  const cinemeta = byImdb ? fetchCinemeta(fetcher, type, requestedId, signal) : null;
  const tmdbId = byImdb ? (await findTmdbTitle(fetcher, requestedId, type, key, signal))?.id : Number(requestedId.slice(5));
  const hasTmdbId = Number.isSafeInteger(tmdbId) && tmdbId > 0;
  const series = type === 'series';
  const details = hasTmdbId ? await readTmdb(fetcher, `${series ? 'tv' : 'movie'}/${tmdbId}`, key, {
    language: LANGUAGE,
    append_to_response: 'videos,external_ids'
  }, signal) : null;
  const imdb = byImdb ? requestedId : details?.external_ids?.imdb_id;

  const verified = series ? [] : VERIFIED_TRAILERS.get(imdb) || [];
  let trailers = [
    ...trailersFrom(verified),
    ...trailersFrom(details?.videos?.results, details?.original_language)
  ];
  if (!trailers.length && series && details) trailers = await seasonTrailers(fetcher, details, tmdbId, key, signal);
  if (!trailers.length && !allowEmptyTrailers) return null;
  trailers = sortTrailers(trailers);

  const base = await (cinemeta || (IMDb.test(imdb) && fetchCinemeta(fetcher, type, imdb, signal)));
  const upstream = base?.meta?.type === type && base.meta.id === imdb ? base.meta : {};
  const name = (series ? details?.name : details?.title) || upstream.name;
  if (typeof name !== 'string' || !name.trim()) return null;

  const upstreamVideos = Array.isArray(upstream.videos) ? upstream.videos : undefined;
  const videos = series && details && !upstreamVideos?.length
    ? await fallbackEpisodes(fetcher, details, tmdbId, IMDb.test(imdb) ? imdb : requestedId, key, signal)
    : upstreamVideos;
  if (series && !videos?.length) return null;

  const links = Array.isArray(upstream.links) ? upstream.links.filter(link => !link?.trailers && !/^trailers?$/i.test(link?.category)) : undefined;
  return {
    ...upstream,
    id: requestedId,
    type,
    name,
    imdb_id: IMDb.test(imdb) ? imdb : undefined,
    moviedb_id: hasTmdbId ? tmdbId : upstream.moviedb_id,
    description: details?.overview || upstream.description,
    poster: image(details?.poster_path, 'w500') || upstream.poster,
    background: image(details?.backdrop_path, 'w1280') || upstream.background,
    genres: Array.isArray(details?.genres) ? details.genres.map(genre => genre.name) : upstream.genres,
    releaseInfo: (details?.release_date || details?.first_air_date)?.slice(0, 4) || upstream.releaseInfo,
    videos,
    links,
    trailers,
    trailerStreams: trailers.map(trailer => ({ ytId: trailer.key, title: trailer.name }))
  };
}
