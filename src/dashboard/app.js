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
