# Optimiseur de Tournées – WC chimiques

Application Streamlit (`tournees.py`) de saisie, d'optimisation et d'export des
tournées. Les données qui doivent survivre d'une session à l'autre sont stockées
dans **Supabase** :

| Donnée | Table Supabase | Enregistrement |
|---|---|---|
| Base client (fiches + points de livraison) | `clients`, `points_livraison` | bouton « 💾 Enregistrer la fiche » |
| Tournées enregistrées | `tournees` | bouton « 💾 Enregistrer », puis sauvegarde automatique |
| Stock du parc | `stock` | import Excel, « 💾 Appliquer les modifications », restauration |

## Mise en place de Supabase (une seule fois)

1. Créez un projet sur <https://supabase.com> (région Europe conseillée).
2. **SQL Editor → New query** : collez le contenu de `supabase_schema.sql`, puis **Run**.
   Le script est ré-exécutable sans perte de données.
3. **Project Settings → API Keys** : copiez l'URL du projet et la clé **secrète**
   (`sb_secret_…`, ou l'ancienne clé `service_role`).
4. **Streamlit Cloud → votre app → Settings → Secrets** : collez

   ```toml
   [supabase]
   url = "https://VOTRE-PROJET.supabase.co"
   key = "sb_secret_..."
   ```

   En local, mettez le même contenu dans `.streamlit/secrets.toml`
   (ignoré par git, modèle : `.streamlit/secrets.toml.example`).
5. Redémarrez l'app : la barre latérale affiche « ☁️ Données synchronisées avec Supabase ».

Sans ces secrets, l'application fonctionne comme avant mais ne conserve rien
entre deux sessions (un bandeau le signale).

### Sécurité

Les tables ont la *Row Level Security* activée **sans politique** : la clé
publique (`anon` / `publishable`) n'a aucun accès. Seule la clé secrète,
stockée côté serveur dans les secrets Streamlit, lit et écrit. Ne la publiez
jamais dans le code ni dans le dépôt.

## Lancer en local

```bash
pip install -r requirements.txt
streamlit run tournees.py
```
