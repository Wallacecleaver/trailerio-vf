const byId = id => document.getElementById(id);
const connection = byId('connection');
const filter = byId('filter');
const refreshButton = byId('refresh');
const time = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'medium' });
const dateTime = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const number = new Intl.NumberFormat('fr-FR');
const labels = { vf: 'VF trouvée', empty: 'Sans VF', error: 'Erreur' };
let snapshot;

function cell(row, value) {
  const td = row.insertCell();
  td.textContent = value;
  return td;
}

function logRow(entry) {
  const row = document.createElement('tr');
  const clock = document.createElement('time');
  clock.dateTime = new Date(entry.at).toISOString();
  clock.textContent = time.format(entry.at);
  clock.title = dateTime.format(entry.at);
  row.insertCell().append(clock);

  const tag = document.createElement('span');
  tag.classList.add('tag', entry.event);
  tag.textContent = labels[entry.event];
  row.insertCell().append(tag);

  const error = entry.event === 'error';
  const title = entry.title === entry.id ? '' : entry.title;
  const detail = cell(row, error ? entry.detail : title);
  if (!error) {
    const id = document.createElement('span');
    if (title) id.className = 'meta';
    id.textContent = `${entry.type === 'series' ? 'Série' : 'Film'} · ${entry.id}`;
    detail.append(id);
  }
  cell(row, error ? entry.source : entry.providers.join(', ') || '–');
  cell(row, error ? '–' : `${number.format(entry.durationMs)} ms`);
  return row;
}

function renderJournal() {
  if (!snapshot) return;
  const events = snapshot.entries.filter(entry => filter.value === 'all' || entry.event === filter.value);
  byId('entries').replaceChildren(...events.map(logRow));
  byId('table').hidden = events.length === 0;
  byId('empty').hidden = events.length !== 0;
  byId('empty').textContent = snapshot.entries.length ? 'Aucun événement pour ce filtre.' : 'Les recherches Fusion apparaîtront ici.';
}

async function refresh() {
  if (refreshButton.disabled) return;
  refreshButton.disabled = true;
  try {
    const response = await fetch('/dashboard/api', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    snapshot = await response.json();
    const { searches, withVf, withoutVf, errors } = snapshot.stats;
    for (const [id, value] of Object.entries({ searches, 'with-vf': withVf, 'without-vf': withoutVf, errors })) {
      byId(id).textContent = number.format(value);
    }
    byId('started-at').textContent = `Serveur démarré le ${dateTime.format(snapshot.startedAt)}`;
    byId('updated-at').textContent = `Actualisé à ${time.format(Date.now())}`;
    connection.dataset.state = 'online';
    connection.textContent = 'En ligne';
    renderJournal();
  } catch {
    connection.dataset.state = 'offline';
    connection.textContent = 'Connexion perdue';
    if (!snapshot) byId('empty').textContent = 'Le journal n’a pas pu être chargé.';
  } finally {
    refreshButton.disabled = false;
  }
}

filter.addEventListener('change', renderJournal);
refreshButton.addEventListener('click', refresh);
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 5000);

function imdbId(input) {
  const value = input.trim();
  if (/^tt\d{7,12}$/i.test(value)) return value.toLowerCase();
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['imdb.com', 'www.imdb.com', 'm.imdb.com'].includes(url.hostname)) return null;
    return url.pathname.match(/^\/(?:[a-z]{2}\/)?title\/(tt\d{7,12})(?:\/|$)/i)?.[1].toLowerCase() || null;
  } catch {
    return null;
  }
}

function resultLink(label, url) {
  const item = document.createElement('li');
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.textContent = label;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  item.append(anchor);
  return item;
}

byId('test-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = byId('test-submit');
  if (submit.disabled) return;
  const id = imdbId(byId('test-id').value);
  const result = byId('test-result');
  const links = byId('test-links');
  links.hidden = true;
  result.hidden = false;
  if (!id) {
    result.dataset.state = 'error';
    result.textContent = 'Saisis un identifiant IMDb de titre, par exemple tt15398776, ou un lien imdb.com/title/…';
    return;
  }

  const type = byId('test-type').value;
  const endpoint = `/meta/${type}/${id}.json`;
  const start = performance.now();
  submit.disabled = true;
  result.dataset.state = 'loading';
  result.textContent = 'Recherche VF en cours…';

  try {
    const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { meta } = await response.json();
    const count = meta.links.length;
    const duration = number.format(Math.round(performance.now() - start));
    const cached = response.headers.get('X-Trailerio-Cache') === 'HIT' ? ' · En cache' : '';
    const outcome = count ? `${count} lien${count > 1 ? 's' : ''} VF` : 'Aucune VF trouvée';
    result.dataset.state = 'done';
    result.textContent = `${meta.name} · ${outcome} · ${duration} ms${cached}`;

    const videos = meta.links.map(({ provider, trailers }, index) => {
      const url = new URL(trailers);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      return resultLink(`${provider} (${index + 1})`, url.href);
    }).filter(Boolean);
    links.replaceChildren(...videos, resultLink('Voir le JSON', endpoint));
    links.hidden = false;
    refresh();
  } catch {
    result.dataset.state = 'error';
    result.textContent = 'La recherche n’a pas abouti. Consulte le journal ou réessaie.';
  } finally {
    submit.disabled = false;
  }
});
