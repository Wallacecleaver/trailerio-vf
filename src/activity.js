const SOURCE_NAMES = {
  'api.themoviedb.org': 'TMDB',
  'v3-cinemeta.strem.io': 'Cinemeta',
  'www.wikidata.org': 'Wikidata',
  'www.allocine.fr': 'AlloCiné',
  'tv.apple.com': 'Apple TV',
  'play.itunes.apple.com': 'Apple TV',
  'play-edge.itunes.apple.com': 'Apple TV'
};

export function createActivity({ limit = 200, write = entry => console.log(JSON.stringify(entry)) } = {}) {
  const startedAt = Date.now();
  const stats = { searches: 0, withVf: 0, withoutVf: 0, errors: 0 };
  const entries = [];

  function record(event) {
    const entry = { at: Date.now(), ...event };
    entries.push(entry);
    if (entries.length > limit) entries.shift();
    write(entry);
  }

  return {
    lookup({ id, type, title, providers, durationMs }) {
      const found = providers.length > 0;
      stats.searches++;
      stats[found ? 'withVf' : 'withoutVf']++;
      const name = typeof title === 'string' ? title.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160) : id;
      record({ event: found ? 'vf' : 'empty', id, type, title: name, providers, durationMs });
    },
    error(source, detail) {
      stats.errors++;
      record({ event: 'error', source, detail });
    },
    snapshot() {
      return { startedAt, stats: { ...stats }, entries: entries.slice().reverse() };
    }
  };
}

export function monitorFetch(activity, fetcher = (...args) => fetch(...args)) {
  return async (input, options) => {
    const source = SOURCE_NAMES[new URL(input).hostname];
    try {
      const response = await fetcher(input, options);
      if (source && !response.ok) activity.error(source, `HTTP ${response.status}`);
      return response;
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      if (source) activity.error(source, timedOut ? 'Délai dépassé' : 'Connexion interrompue');
      throw error;
    }
  };
}
