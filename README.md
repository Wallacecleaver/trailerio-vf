# Trailerio VF

Addon Fusion pour les bandes-annonces de films et de séries en français. Les titres sont demandés à TMDB en `fr-FR`. L’addon accepte les MP4 explicitement marqués VF par AlloCiné et ne conserve que les pistes audio françaises des bandes-annonces Apple TV. Si aucune source VF n’est confirmée, Fusion reçoit une liste vide.

## Démarrer sur un VPS

Avec Node.js 22 ou plus récent, aucune dépendance à installer pour le serveur.

```sh
git clone https://github.com/Wallacecleaver/trailerio-vf.git
cd trailerio-vf
PUBLIC_URL=https://trailers.example.com npm start
```

Le serveur écoute par défaut sur `127.0.0.1:7000`. Pour un test local, lance `npm start` sans `PUBLIC_URL` et ouvre `http://127.0.0.1:7000/manifest.json`.

### Docker

```sh
docker build -t trailerio-vf .
docker run -d --name trailerio-vf --restart unless-stopped \
  -p 127.0.0.1:7000:7000 \
  -e PUBLIC_URL=https://trailers.example.com \
  trailerio-vf
```

### HTTPS et installation dans Fusion

Fais pointer le domaine vers le VPS et configure un reverse proxy HTTPS vers le port `7000`. Avec Caddy, ajoute ce bloc à ton `Caddyfile` en remplaçant le domaine par le tien.

```caddyfile
trailers.example.com {
  reverse_proxy 127.0.0.1:7000
}
```

Utilise la même adresse HTTPS pour `PUBLIC_URL`. Elle sert à construire les liens de lecture HLS sur le VPS. Dans Fusion, ajoute `https://trailers.example.com/manifest.json` dans **Addons**.

### Variables d’environnement

| Variable | Valeur par défaut | Rôle |
|---|---|---|
| `HOST` | `127.0.0.1` hors Docker | Adresse d’écoute |
| `PORT` | `7000` | Port d’écoute |
| `PUBLIC_URL` | `http://127.0.0.1:7000` avec le port configuré | Adresse de l’addon visible par Fusion |
| `TMDB_API_KEY` | Clé du projet | Remplace la clé utilisée pour les requêtes TMDB |

### Vérifier le service

```sh
curl https://trailers.example.com/health
curl https://trailers.example.com/manifest.json
curl https://trailers.example.com/meta/movie/tt15398776.json
```

Pour lancer les tests du projet, utilise `npm test`.

## Cloudflare Workers

L’entrée `src/index.js` reste compatible avec le Worker configuré dans `wrangler.toml`. Avec Wrangler installé, utilise `npm run deploy`.

## Licence

MIT
