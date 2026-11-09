-- ═══════════════════════════════════════════════════════════════════════════
-- Optimiseur de Tournées – schéma Supabase
-- À exécuter UNE FOIS dans Supabase → SQL Editor → New query → Run.
-- Le script est ré-exécutable sans perte de données (IF NOT EXISTS / OR REPLACE).
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Base client ────────────────────────────────────────────────────────────
-- Une fiche par client, avec sa prestation et sa fenêtre d'intervention par
-- défaut. Les adresses sont dans points_livraison (1 client → N points).
create table if not exists public.clients (
    id              uuid primary key default gen_random_uuid(),
    nom             text not null,
    contact         text not null default '',
    telephone       text not null default '',
    email           text not null default '',
    produit         text not null default 'WC chimique',
    option_produit  text not null default '',
    quantite        integer not null default 1 check (quantite between 1 and 20),
    couleurs        text not null default '',
    pas_avant       text not null default '',   -- HH:MM, fenêtre par défaut
    pas_apres       text not null default '',
    notes           text not null default '',
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create table if not exists public.points_livraison (
    id            uuid primary key default gen_random_uuid(),
    client_id     uuid not null references public.clients(id) on delete cascade,
    libelle       text not null default '',     -- ex. « Chantier Gaillac »
    adresse       text not null,
    pas_avant     text not null default '',     -- vide = fenêtre de la fiche client
    pas_apres     text not null default '',
    observations  text not null default '',
    position      integer not null default 0,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create index if not exists points_livraison_client_idx
    on public.points_livraison (client_id);

-- ── Tournées enregistrées ──────────────────────────────────────────────────
create table if not exists public.tournees (
    id          uuid primary key default gen_random_uuid(),
    nom         text not null,
    tour_date   date,
    chauffeur   text not null default '',
    nb_arrets   integer not null default 0,
    stops       jsonb not null default '[]'::jsonb,   -- lignes du tableau de saisie
    meta        jsonb not null default '{}'::jsonb,   -- dépôts, heure de départ…
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists tournees_updated_idx on public.tournees (updated_at desc);

-- ── Stock du parc ──────────────────────────────────────────────────────────
create table if not exists public.stock (
    article     text not null,
    couleur     text not null default '',
    installes   integer not null default 0 check (installes >= 0),
    en_stock    integer not null default 0 check (en_stock >= 0),
    updated_at  timestamptz not null default now(),
    primary key (article, couleur)
);

-- ── Fonctions (écritures atomiques) ────────────────────────────────────────

-- Enregistre une fiche client et ses points de livraison en une transaction.
-- Les points absents de p_points sont supprimés.
create or replace function public.save_client(p_client jsonb, p_points jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
    v_id   uuid := coalesce(nullif(p_client->>'id', '')::uuid, gen_random_uuid());
    v_keep uuid[];
begin
    insert into clients (id, nom, contact, telephone, email, produit,
                         option_produit, quantite, couleurs, pas_avant,
                         pas_apres, notes)
    values (v_id,
            coalesce(p_client->>'nom', ''),
            coalesce(p_client->>'contact', ''),
            coalesce(p_client->>'telephone', ''),
            coalesce(p_client->>'email', ''),
            coalesce(p_client->>'produit', 'WC chimique'),
            coalesce(p_client->>'option_produit', ''),
            coalesce((p_client->>'quantite')::int, 1),
            coalesce(p_client->>'couleurs', ''),
            coalesce(p_client->>'pas_avant', ''),
            coalesce(p_client->>'pas_apres', ''),
            coalesce(p_client->>'notes', ''))
    on conflict (id) do update set
        nom = excluded.nom, contact = excluded.contact,
        telephone = excluded.telephone, email = excluded.email,
        produit = excluded.produit, option_produit = excluded.option_produit,
        quantite = excluded.quantite, couleurs = excluded.couleurs,
        pas_avant = excluded.pas_avant, pas_apres = excluded.pas_apres,
        notes = excluded.notes, updated_at = now();

    select coalesce(array_agg((p->>'id')::uuid), '{}')
      into v_keep
      from jsonb_array_elements(coalesce(p_points, '[]'::jsonb)) p
     where coalesce(p->>'id', '') <> '';

    delete from points_livraison
     where client_id = v_id and not (id = any (v_keep));

    insert into points_livraison (id, client_id, libelle, adresse, pas_avant,
                                  pas_apres, observations, position)
    select coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid()), v_id,
           coalesce(p->>'libelle', ''), coalesce(p->>'adresse', ''),
           coalesce(p->>'pas_avant', ''), coalesce(p->>'pas_apres', ''),
           coalesce(p->>'observations', ''), (ord - 1)::int
      from jsonb_array_elements(coalesce(p_points, '[]'::jsonb))
           with ordinality as t(p, ord)
    on conflict (id) do update set
        libelle = excluded.libelle, adresse = excluded.adresse,
        pas_avant = excluded.pas_avant, pas_apres = excluded.pas_apres,
        observations = excluded.observations, position = excluded.position,
        updated_at = now();

    return v_id;
end;
$$;

-- Remplace intégralement le stock du parc (import Excel, saisie manuelle).
create or replace function public.replace_stock(p_rows jsonb)
returns void
language plpgsql
set search_path = public
as $$
begin
    delete from stock where true;
    insert into stock (article, couleur, installes, en_stock, updated_at)
    select x.article, coalesce(x.couleur, ''), coalesce(x.installes, 0),
           coalesce(x.en_stock, 0), now()
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
           as x(article text, couleur text, installes int, en_stock int)
     where coalesce(x.article, '') <> '';
end;
$$;

-- ── Sécurité ───────────────────────────────────────────────────────────────
-- RLS activé SANS politique : seules les requêtes faites avec la clé secrète
-- (service_role / sb_secret_…, stockée côté serveur dans les secrets
-- Streamlit) peuvent lire ou écrire. La clé publique (anon) n'a aucun accès.
alter table public.clients          enable row level security;
alter table public.points_livraison enable row level security;
alter table public.tournees         enable row level security;
alter table public.stock            enable row level security;

revoke all on function public.save_client(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.replace_stock(jsonb)       from public, anon, authenticated;
grant execute on function public.save_client(jsonb, jsonb) to service_role;
grant execute on function public.replace_stock(jsonb)       to service_role;
