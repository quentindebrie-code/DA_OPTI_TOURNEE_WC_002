# Optimiseur de Tournées – version web

Application HTML/JavaScript **sans serveur** : le navigateur parle directement
à Supabase. Aucune étape de compilation, aucune dépendance à installer. Elle
partage la même base Supabase que l'application Streamlit : les deux peuvent
tourner en parallèle pendant la migration.

Toutes les fonctions de la version Streamlit sont reprises :

| Onglet | Contenu |
|---|---|
| 📋 Saisie | tournées enregistrées (sauvegarde automatique), paramètres, import / export / modèle Excel, tableau relié à la base client, barème des durées, contrôle de stock en direct, optimisation |
| 📇 Clients | fiches, points de livraison, vérification d'adresse |
| 🗺️ Tournée | indicateurs, carte de l'itinéraire, réordonnancement par glisser-déposer ou ↑ ↓ |
| 📦 Stock | import / export Excel, matrice article × couleur, détail modifiable, projection après tournée |
| 📤 Export | feuille de tournée Excel et PDF (matériel, carte, consignes, fiches d'état des lieux) |
| 📍 Carte | tournées enregistrées et points clients |

Améliorations par rapport à la version Streamlit : la recherche d'ordre tient
compte de la pause déjeuner et déplace aussi des arrêts isolés (moins de
créneaux manqués), le dépôt de retour est intégré au calcul, le géocodage
utilise le nouveau service officiel de la Base Adresse Nationale, et la saisie
en cours survit au rechargement de la page.

## Essayer tout de suite (mode démo)

`config.js` vide = mode démo, avec des données fictives conservées dans le
navigateur.

```bash
python3 -m http.server 8765 -d web
```

Puis ouvrir <http://localhost:8765>.

## Brancher Supabase (une seule fois)

1. **SQL Editor → New query** : collez `web/supabase_web_auth.sql`, puis **Run**.
   Ce script ajoute la table `membres` et les politiques RLS, sans toucher
   aux données.
2. Dans le même éditeur, déclarez l'équipe :
   ```sql
   insert into public.membres (email) values ('prenom.nom@exemple.fr') on conflict do nothing;
   ```
3. **Authentication → Sign In / Providers** : désactivez **Allow new users to sign up**.
   Les comptes sont alors créés uniquement par vous.
4. **Authentication → Users → Add user → Create new user** : créez chaque compte
   (e-mail + mot de passe, en cochant *Auto Confirm User*). Vous pouvez aussi
   utiliser *Send invitation* : la personne choisit elle-même son mot de passe
   en arrivant sur l'application.
5. **Project Settings → API Keys** : copiez l'URL du projet et la clé
   **publishable** (`sb_publishable_…`) dans `web/config.js`.
6. Une fois l'application en ligne, allez dans **Authentication → URL Configuration**
   et mettez son adresse dans **Site URL** et **Redirect URLs**. C'est
   nécessaire pour les e-mails « mot de passe oublié » et les invitations.

### Pourquoi la clé peut être publique

La clé `publishable` ne donne accès à rien par elle-même. Chaque requête doit
porter la session d'un utilisateur connecté **dont l'e-mail figure dans
`membres`**. Sinon, les politiques RLS renvoient une base vide, et
l'application déconnecte la personne avec un message explicite. La clé
**secrète** reste réservée à Streamlit et ne doit jamais apparaître dans
`web/`.

Pour retirer l'accès à quelqu'un : supprimez son e-mail de `membres`, ou son
compte dans *Authentication → Users*.

## Mettre en ligne gratuitement

Le site est publié sur **GitHub Pages** depuis la branche `gh-pages` (copie du
dossier `web/`). Pour republier après une modification :

```bash
git subtree push --prefix web origin gh-pages
```

Tout hébergeur statique convient aussi, par exemple **Cloudflare Pages** :

1. dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**,
   puis choisissez ce dépôt ;
2. *Build command* : vide · *Build output directory* : `web` ;
3. **Save and Deploy**. Chaque `git push` met le site à jour.

Netlify convient aussi (*Publish directory* : `web`). L'hébergement est
gratuit et le site ne se met jamais en veille.

## Organisation du code

```
web/
├── index.html              structure de la page
├── config.js               URL + clé publique Supabase (vide = démo)
├── supabase_web_auth.sql   politiques d'accès (à exécuter une fois)
├── css/app.css             styles (clair / sombre, mobile)
└── js/
    ├── app.js              connexion, onglets, état partagé
    ├── store.js            accès aux données (Supabase / démo)
    ├── util.js             constantes métier, géocodage, utilitaires
    ├── state.js            état de la tournée, brouillon, sauvegarde auto
    ├── metier.js           barème, stock, normalisation, textes
    ├── optim.js            OSRM, plus proche voisin + 2-opt, créneaux, pause
    ├── xlsx.js / pdf.js    imports et exports Excel / PDF
    ├── saisie.js, clients.js, tournee.js, stock.js, export.js, carte.js
    └── libs.js             chargement à la demande (ExcelJS, jsPDF, SortableJS)
```

Le géocodage utilise le service officiel de la Base Adresse Nationale
(`data.geopf.fr/geocodage`), avec un cache dans le navigateur.
