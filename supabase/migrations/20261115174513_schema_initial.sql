-- Étape 2 : schéma initial de Finances Famille
-- Accès : uniquement les membres du foyer (table membres), lecture et écriture.

-- ---------------------------------------------------------------
-- Membres du foyer (les seules personnes autorisées)
-- ---------------------------------------------------------------
create table public.membres (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nom text not null,
  cree_le timestamptz not null default now()
);

create or replace function public.est_membre()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.membres m where m.user_id = (select auth.uid())
  );
$$;

revoke all on function public.est_membre() from public, anon;
grant execute on function public.est_membre() to authenticated;

-- ---------------------------------------------------------------
-- Classement : catégories et postes de dépense
-- ---------------------------------------------------------------
create table public.categories (
  id bigint generated always as identity primary key,
  nom text not null unique,
  rang integer not null
);

create table public.postes (
  id bigint generated always as identity primary key,
  nom text not null unique,
  categorie_id bigint not null references public.categories (id),
  description text,
  ordre integer not null default 0
);
create index postes_categorie_idx on public.postes (categorie_id);

-- ---------------------------------------------------------------
-- Comptes bancaires
-- ---------------------------------------------------------------
create table public.comptes (
  id bigint generated always as identity primary key,
  banque text not null,
  nom text not null,
  type_compte text not null
    check (type_compte in ('Courant', 'Carte Bancaire', 'Epargne', 'Cash', 'Retraite', 'Titres')),
  titulaire text not null default 'Joint',
  devise text not null default 'EUR',
  ouvert boolean not null default true,
  -- IBAN ou fin du numéro de carte, pour reconnaître le compte dans un CSV
  identifiant_import text unique,
  -- format du CSV : 'raiffeisen_compte', 'raiffeisen_carte', ou vide
  format_import text,
  unique (banque, nom)
);

-- ---------------------------------------------------------------
-- Imports de fichiers CSV (historique)
-- ---------------------------------------------------------------
create table public.imports (
  id bigint generated always as identity primary key,
  compte_id bigint not null references public.comptes (id),
  nom_fichier text,
  nb_lignes_fichier integer not null default 0,
  nb_nouvelles integer not null default 0,
  importe_par uuid references auth.users (id) default auth.uid(),
  importe_le timestamptz not null default now()
);
create index imports_compte_idx on public.imports (compte_id);

-- ---------------------------------------------------------------
-- Opérations
-- empreinte + occurrence : deux opérations identiques le même jour
-- sont conservées (occurrence 1, 2, ...) au lieu d'être fusionnées.
-- ---------------------------------------------------------------
create table public.operations (
  id bigint generated always as identity primary key,
  compte_id bigint not null references public.comptes (id),
  date_operation date not null,
  libelle text not null default '',
  montant numeric(14, 2) not null,
  devise text not null default 'EUR',
  poste_id bigint references public.postes (id),
  note text,
  empreinte text not null,
  occurrence integer not null default 1 check (occurrence >= 1),
  import_id bigint references public.imports (id) on delete set null,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  unique (compte_id, empreinte, occurrence)
);
create index operations_compte_date_idx on public.operations (compte_id, date_operation);
create index operations_date_idx on public.operations (date_operation);
create index operations_poste_idx on public.operations (poste_id);
create index operations_import_idx on public.operations (import_id);

create or replace function public.maj_modifie_le()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.modifie_le := now();
  return new;
end;
$$;

create trigger operations_modifie_le
  before update on public.operations
  for each row execute function public.maj_modifie_le();

-- ---------------------------------------------------------------
-- Sécurité : RLS sur toutes les tables, accès réservé aux membres
-- ---------------------------------------------------------------
alter table public.membres    enable row level security;
alter table public.categories enable row level security;
alter table public.postes     enable row level security;
alter table public.comptes    enable row level security;
alter table public.imports    enable row level security;
alter table public.operations enable row level security;

-- membres : chacun voit la liste, personne ne la modifie depuis l'application
create policy membres_lecture on public.membres
  for select to authenticated using ((select public.est_membre()));

create policy categories_membres on public.categories
  for all to authenticated
  using ((select public.est_membre())) with check ((select public.est_membre()));

create policy postes_membres on public.postes
  for all to authenticated
  using ((select public.est_membre())) with check ((select public.est_membre()));

create policy comptes_membres on public.comptes
  for all to authenticated
  using ((select public.est_membre())) with check ((select public.est_membre()));

create policy imports_membres on public.imports
  for all to authenticated
  using ((select public.est_membre())) with check ((select public.est_membre()));

create policy operations_membres on public.operations
  for all to authenticated
  using ((select public.est_membre())) with check ((select public.est_membre()));

-- aucun accès pour les visiteurs non connectés
revoke all on public.membres, public.categories, public.postes,
  public.comptes, public.imports, public.operations from anon;
