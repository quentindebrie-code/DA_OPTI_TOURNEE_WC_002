# Optimiseur de Tournées – version web

Application HTML/JavaScript **sans serveur** : le navigateur parle directement
à Supabase. Aucune étape de compilation, aucune dépendance à installer. Elle
partage la même base Supabase que l'application Streamlit : les deux peuvent
tourner en parallèle pendant la migration.

Conçue d'abord pour le téléphone (barre de navigation en bas, « Préparer » au centre),
avec une version grand écran soignée. Design « verre » du groupe Hympyr aux couleurs vertes
de Deldossi Assainissement, police Poppins.

| Écran | Contenu |
|---|---|
| Accueil | reprise de la tournée en cours, avancement, chiffres du mois, raccourcis |
| Préparer | tournées enregistrées, paramètres, arrêts (base client, import Excel), couleur automatique selon le stock, vérifications, bouton « Optimiser » |
| Tournée | indicateurs, carte, ordre réorganisable, feuille de route PDF (avec logo) et Excel, mise à jour du stock une fois la tournée faite |
| Clients | fiches et adresses de livraison, carte des clients |
| Stock | état du parc, tableau article × couleur, corrections, impact de la tournée |

Le bouton d'assistance (en bas à droite) et le lien « Mot de passe oublié ? » envoient une
demande à quentin.d@hympyr.fr : elle est enregistrée dans la table `tickets` de Supabase et
transmise par e-mail via FormSubmit. **À la toute première demande, FormSubmit envoie un
e-mail d'activation à cette adresse : il faut cliquer sur le lien qu'il contient pour que les
envois suivants arrivent.**

## Essayer tout de suite (mode démo)

`config.js` vide, ou `?demo` ajouté à l'adresse = mode démo, avec des données fictives
conservées dans le navigateur.

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
dossier `web/`). Pour republier après une modification, numéroter d'abord la version (évite
qu'un navigateur mélange anciens et nouveaux fichiers), puis pousser :

```bash
python3 outils/version-web.py
git commit -am "Nouvelle version" && git subtree push --prefix web origin gh-pages
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
├── index.html · config.js · supabase_web_auth.sql
├── assets/logo-deldossi-vert.svg
├── css/app.css            design system (verre, couleurs, animations, mobile d'abord)
└── js/
    ├── app.js             connexion, navigation et transitions, chargement depuis le cache
    ├── accueil.js · saisie.js · tournee.js · clients.js · stock.js   les écrans
    ├── state.js · store.js · metier.js · optim.js                    données et calculs
    ├── xlsx.js · pdf.js   exports (le PDF intègre le logo)
    ├── ticket.js          assistance
    └── util.js · icons.js · logo.js · libs.js
```

Le géocodage utilise le service officiel de la Base Adresse Nationale
(`data.geopf.fr/geocodage`), avec un cache dans le navigateur.
