-- ═══════════════════════════════════════════════════════════════════════════
-- Application web – accès par Supabase Auth
--
-- À exécuter APRÈS supabase_schema.sql (Supabase → SQL Editor → New query →
-- Run). Ré-exécutable sans perte de données. Si vous relancez
-- supabase_schema.sql plus tard, relancez aussi ce script : le premier retire
-- aux utilisateurs connectés le droit d'exécuter save_client / replace_stock.
--
-- Principe : l'application web utilise la clé PUBLIQUE. Les données ne sont
-- accessibles qu'à un utilisateur connecté (Supabase Auth) dont l'e-mail
-- figure dans la table « membres ». L'application Streamlit, qui utilise la
-- clé secrète, continue de fonctionner sans changement.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Liste blanche de l'équipe ──────────────────────────────────────────────
create table if not exists public.membres (
    email       text primary key,
    created_at  timestamptz not null default now()
);
alter table public.membres enable row level security;   -- aucune politique : invisible depuis le web

-- Vrai si l'utilisateur connecté fait partie de l'équipe.
create or replace function public.est_membre()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from membres
         where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;
revoke all on function public.est_membre() from public, anon;
grant execute on function public.est_membre() to authenticated;

-- ── Politiques : lecture / écriture réservées aux membres connectés ────────
do $$
declare t text;
begin
    foreach t in array array['clients', 'points_livraison', 'tournees', 'stock', 'parametres'] loop
        execute format('drop policy if exists equipe_acces on public.%I', t);
        execute format(
            'create policy equipe_acces on public.%I for all to authenticated '
            'using (public.est_membre()) with check (public.est_membre())', t);
        execute format('grant select, insert, update, delete on public.%I to authenticated', t);
        execute format('revoke all on public.%I from anon', t);
    end loop;
end $$;

-- Les fonctions d'écriture restent soumises aux politiques ci-dessus
-- (elles s'exécutent avec les droits de l'appelant).
grant execute on function public.save_client(jsonb, jsonb) to authenticated;
grant execute on function public.replace_stock(jsonb)       to authenticated;

-- ── Ajouter les membres de l'équipe (une ligne par personne) ───────────────
-- insert into public.membres (email) values
--     ('prenom.nom@exemple.fr'),
--     ('collegue@exemple.fr')
-- on conflict do nothing;

-- ── Demandes d'assistance (bouton « Assistance », « Mot de passe oublié ») ─
create table if not exists public.tickets (
    id          uuid primary key default gen_random_uuid(),
    created_at  timestamptz not null default now(),
    email       text not null default '' check (char_length(email) <= 200),
    sujet       text not null check (char_length(sujet) between 1 and 120),
    message     text not null default '' check (char_length(message) <= 4000),
    page        text not null default '' check (char_length(page) <= 60),
    navigateur  text not null default '' check (char_length(navigateur) <= 300)
);
alter table public.tickets enable row level security;
drop policy if exists tickets_depot on public.tickets;
create policy tickets_depot on public.tickets for insert to anon, authenticated with check (true);
grant insert on public.tickets to anon, authenticated;

-- Chiffres de la tournée (accueil : km économisés du mois)
alter table public.tournees add column if not exists stats jsonb not null default '{}'::jsonb;
