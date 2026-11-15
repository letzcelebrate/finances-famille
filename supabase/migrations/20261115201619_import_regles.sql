-- Étape 4 : import des CSV et règles de classement

-- ---------------------------------------------------------------
-- Règles de classement définies par les membres
-- (ex. libellé contenant « HESPERANGE » -> Garde d'enfants, à confirmer)
-- Elles passent avant la proposition automatique.
-- ---------------------------------------------------------------
create table public.regles_classement (
  id bigint generated always as identity primary key,
  motif text not null check (length(trim(motif)) >= 3),
  poste_id bigint not null references public.postes (id),
  a_confirmer boolean not null default true,
  cree_le timestamptz not null default now(),
  unique (motif)
);
create index regles_classement_poste_idx on public.regles_classement (poste_id);

alter table public.regles_classement enable row level security;
create policy regles_membres on public.regles_classement
  for all to authenticated
  using ((select public.est_membre())) with check ((select public.est_membre()));

revoke all on public.regles_classement from anon;
revoke truncate, references, trigger on public.regles_classement from authenticated;
grant select, insert, update, delete on public.regles_classement to authenticated, service_role;

-- ---------------------------------------------------------------
-- Import d'un fichier : enregistre l'import et ses opérations en une seule
-- transaction (tout ou rien). Les règles RLS de la personne connectée
-- s'appliquent (security invoker).
-- p_lignes : tableau JSON d'objets
--   { date_operation, libelle, montant, devise, titulaire, poste_id, empreinte }
-- Les occurrences sont numérotées ici, à la suite de celles déjà en base.
-- ---------------------------------------------------------------
create or replace function public.importer_operations(
  p_compte_id bigint,
  p_nom_fichier text,
  p_nb_lignes_fichier integer,
  p_lignes jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_import_id bigint;
  v_nb integer;
begin
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Aucune opération à importer';
  end if;

  insert into public.imports (compte_id, nom_fichier, nb_lignes_fichier, nb_nouvelles)
  values (p_compte_id, p_nom_fichier, p_nb_lignes_fichier, jsonb_array_length(p_lignes))
  returning id into v_import_id;

  with lignes as (
    select
      l.ordinality as rang,
      (l.value ->> 'date_operation')::date as date_operation,
      coalesce(l.value ->> 'libelle', '') as libelle,
      (l.value ->> 'montant')::numeric(14, 2) as montant,
      coalesce(l.value ->> 'devise', 'EUR') as devise,
      coalesce(l.value ->> 'titulaire', 'Joint') as titulaire,
      nullif(l.value ->> 'poste_id', '')::bigint as poste_id,
      l.value ->> 'empreinte' as empreinte
    from jsonb_array_elements(p_lignes) with ordinality as l(value, ordinality)
  ),
  numerotees as (
    select
      lg.*,
      coalesce((
        select max(o.occurrence) from public.operations o
        where o.compte_id = p_compte_id and o.empreinte = lg.empreinte
      ), 0) + row_number() over (partition by lg.empreinte order by lg.rang) as occurrence
    from lignes lg
  )
  insert into public.operations
    (compte_id, date_operation, libelle, montant, devise, titulaire, poste_id, empreinte, occurrence, import_id)
  select p_compte_id, date_operation, libelle, montant, devise, titulaire, poste_id, empreinte, occurrence, v_import_id
  from numerotees
  order by rang;

  get diagnostics v_nb = row_count;
  if v_nb <> jsonb_array_length(p_lignes) then
    raise exception 'Import incomplet (% sur %)', v_nb, jsonb_array_length(p_lignes);
  end if;

  return v_import_id;
end;
$$;

revoke all on function public.importer_operations(bigint, text, integer, jsonb) from public, anon;
grant execute on function public.importer_operations(bigint, text, integer, jsonb) to authenticated, service_role;
