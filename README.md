# Trailerio VF

Addon Fusion pour les bandes-annonces de films et de séries en français. Les titres sont demandés à TMDB en `fr-FR`. Si TMDB ne fournit pas de lien Wikidata, l’addon recherche le titre directement dans Wikidata à partir de son identifiant IMDb. Il accepte les MP4 explicitement marqués VF par AlloCiné et ne conserve que les pistes audio françaises des bandes-annonces Apple TV. Si aucune source VF n’est confirmée, Fusion reçoit une liste vide.

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

Utilise la même adresse HTTPS pour `PUBLIC_URL`. Elle sert à construire les liens de lecture HLS sur le VPS. La page d’accueil de l’addon permet de copier le lien du manifeste. Colle-le dans **Fusion → Addons**.

## Installer dans Nuvio Mobile

Ajoute `https://trailers.example.com/nuvio/manifest.json` dans **Nuvio → Addons**, puis place **Trailerio VF pour Nuvio** au-dessus de tes autres addons de métadonnées. Nuvio utilise le premier addon qui fournit une fiche pour le titre.

Dans **Enrichissement TMDB**, désactive l’option de remplacement des bandes-annonces pour que Nuvio lise celles de l’addon. Garde la section **Bandes-annonces** activée dans la fiche du titre.

Cette version transmet les bandes-annonces et teasers YouTube explicitement identifiés en VF, ainsi que les vidéos officielles françaises des titres tournés en français. Elle conserve les épisodes des séries à partir de Cinemeta ou de TMDB. Quand aucune vidéo VF compatible n’est disponible, Nuvio peut reprendre la fiche d’un autre fournisseur.

Après redéploiement, teste Comment braquer une banque (`tt35866986`), Oppenheimer (`tt15398776`) ou Lupin (`tt2531336`). Une recherche Nuvio qui trouve une vidéo VF affiche **YouTube · VF** dans le journal du tableau de bord.

### Mode VF strict et AIOMetadata

Pour laisser les bandes-annonces vides quand aucune VF n’est confirmée, ajoute `https://trailers.example.com/nuvio-strict/manifest.json` directement dans **Nuvio → Addons** et place **Trailerio VF strict pour Nuvio** en première position parmi les addons de métadonnées. Le mode strict renvoie alors une fiche avec une liste de bandes-annonces vide, dès qu’il peut récupérer la fiche du titre.

Dans AIOMetadata, tu peux mettre ce même manifeste dans **Meta Providers → Trailers → A trailer addon**. Changer l’URL crée une nouvelle entrée de cache pour les bandes-annonces. Lorsque Trailerio ne trouve aucune VF confirmée, AIOMetadata reprend les bandes-annonces de son fournisseur habituel. Pour laisser la liste vide dans ce cas, configure le mode strict directement dans Nuvio.

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

## Tableau de bord et logs

Sur le VPS, ajoute `DASHBOARD_PASSWORD` aux variables d’environnement de l’addon (dans **Variables** sur WDock) et redéploie. Utilise un mot de passe long et unique.

```env
DASHBOARD_PASSWORD=ton-mot-de-passe
```

Ouvre `https://trailers.example.com/dashboard/` et connecte-toi avec l’identifiant `admin` et ce mot de passe. Le tableau de bord affiche les recherches, les bandes-annonces trouvées en VF et les erreurs de connexion aux sources. Il se rafraîchit toutes les cinq secondes et garde les 200 derniers événements en mémoire, jusqu’au prochain redémarrage. Les mêmes événements sont écrits sur la sortie du conteneur pour l’onglet **Logs** de WDock.

### Tester après un redéploiement

1. Ouvre la page d’accueil. L’indicateur doit afficher **En ligne**. **Voir le manifeste** doit afficher le JSON version `1.4.0`.
2. Dans le tableau de bord, ouvre **Tester une recherche VF**. Choisis **Film** et saisis `tt15398776` pour Oppenheimer, ou **Série** et saisis `tt3581920` pour The Last of Us. Le résultat affiche les liens VF trouvés et le temps de réponse. **Voir le JSON** affiche la réponse utilisée par Fusion.
3. Relance la même recherche. **En cache** indique que le résultat vient de la mémoire du serveur. Pour vérifier la lecture, lance une bande-annonce dans Fusion et écoute la piste audio. Les recherches que Fusion envoie à Trailerio apparaissent dans le journal.

## Cloudflare Workers

L’entrée `src/index.js` reste compatible avec le Worker configuré dans `wrangler.toml`. Avec Wrangler installé, utilise `npm run deploy`.

## Licence

MIT
