-- Étape 4 (suite) : notes, division d'une opération en plusieurs postes,
-- règles « ne jamais deviner ».

-- ---------------------------------------------------------------
-- Règles : poste vide = « toujours à classer » (ex. AMAZON)
-- ---------------------------------------------------------------
alter table public.regles_classement alter column poste_id drop not null;

-- ---------------------------------------------------------------
-- Ventilations : une opération divisée en plusieurs postes.
-- Quand une opération est ventilée, son poste_id est vide et ce sont
-- les ventilations qui portent le classement.
-- La somme des ventilations doit être égale au montant de l'opération
-- (contrôlé en fin de transaction).
-- ---------------------------------------------------------------
create table public.ventilations (
  id bigint generated always as identity primary key,
  operation_id bigint not null references public.operations (id) on delete cascade,
  poste_id bigint not null references public.postes (id),
  montant numeric(14, 2) not null check (montant <> 0),
  note text
);
create index ventilations_operation_idx on public.ventilations (operation_id);
create index ventilations_poste_idx on public.ventilations (poste_id);

alter table public.ventilations enable row level security;
create policy ventilations_membres on public.ventilations
  for all to authenticated
  using ((select public.est_membre())) with check ((select public.est_membre()));
revoke all on public.ventilations from anon;
revoke truncate, references, trigger on public.ventilations from authenticated;
grant select, insert, update, delete on public.ventilations to authenticated, service_role;

create or replace function public.controler_ventilations()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_op bigint := coalesce(new.operation_id, old.operation_id);
  v_nb integer;
  v_somme numeric;
  v_montant numeric;
begin
  select count(*), coalesce(sum(montant), 0) into v_nb, v_somme
  from public.ventilations where operation_id = v_op;
  select montant into v_montant from public.operations where id = v_op;
  if v_montant is not null and v_nb > 0 and v_somme <> v_montant then
    raise exception 'La division ne tombe pas juste : % au lieu de %', v_somme, v_montant;
  end if;
  return null;
end;
$$;

create constraint trigger ventilations_total
  after insert or update or delete on public.ventilations
  deferrable initially deferred
  for each row execute function public.controler_ventilations();

-- Remplace la division d'une opération (tableau vide = plus de division).
-- p_lignes : [{ poste_id, montant, note }]
create or replace function public.diviser_operation(p_operation_id bigint, p_lignes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.operations where id = p_operation_id) then
    raise exception 'Opération introuvable';
  end if;
  delete from public.ventilations where operation_id = p_operation_id;
  if jsonb_array_length(coalesce(p_lignes, '[]'::jsonb)) > 0 then
    insert into public.ventilations (operation_id, poste_id, montant, note)
    select p_operation_id, (l ->> 'poste_id')::bigint, (l ->> 'montant')::numeric(14, 2), nullif(l ->> 'note', '')
    from jsonb_array_elements(p_lignes) as l;
    update public.operations set poste_id = null where id = p_operation_id;
  end if;
end;
$$;
revoke all on function public.diviser_operation(bigint, jsonb) from public, anon;
grant execute on function public.diviser_operation(bigint, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------
-- Import : accepte une note et une division par ligne.
-- p_lignes : [{ date_operation, libelle, montant, devise, titulaire,
--               poste_id, empreinte, note, ventilations: [{poste_id, montant, note}] }]
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
  v_ligne jsonb;
  v_op_id bigint;
  v_occ integer;
  v_divisee boolean;
begin
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Aucune opération à importer';
  end if;

  insert into public.imports (compte_id, nom_fichier, nb_lignes_fichier, nb_nouvelles)
  values (p_compte_id, p_nom_fichier, p_nb_lignes_fichier, jsonb_array_length(p_lignes))
  returning id into v_import_id;

  for v_ligne in select value from jsonb_array_elements(p_lignes) loop
    -- numéro d'occurrence à la suite de ceux déjà en base (y compris ce fichier)
    select coalesce(max(occurrence), 0) + 1 into v_occ
    from public.operations
    where compte_id = p_compte_id and empreinte = v_ligne ->> 'empreinte';

    v_divisee := jsonb_array_length(coalesce(v_ligne -> 'ventilations', '[]'::jsonb)) > 0;

    insert into public.operations
      (compte_id, date_operation, libelle, montant, devise, titulaire, poste_id, note, empreinte, occurrence, import_id)
    values (
      p_compte_id,
      (v_ligne ->> 'date_operation')::date,
      coalesce(v_ligne ->> 'libelle', ''),
      (v_ligne ->> 'montant')::numeric(14, 2),
      coalesce(v_ligne ->> 'devise', 'EUR'),
      coalesce(v_ligne ->> 'titulaire', 'Joint'),
      case when v_divisee then null else nullif(v_ligne ->> 'poste_id', '')::bigint end,
      nullif(v_ligne ->> 'note', ''),
      v_ligne ->> 'empreinte',
      v_occ,
      v_import_id
    )
    returning id into v_op_id;

    if v_divisee then
      insert into public.ventilations (operation_id, poste_id, montant, note)
      select v_op_id, (l ->> 'poste_id')::bigint, (l ->> 'montant')::numeric(14, 2), nullif(l ->> 'note', '')
      from jsonb_array_elements(v_ligne -> 'ventilations') as l;
    end if;
  end loop;

  return v_import_id;
end;
$$;

-- ---------------------------------------------------------------
-- Vues
-- ---------------------------------------------------------------
-- v_operations : ajoute la division (liste des morceaux) ; mêmes colonnes en tête
create or replace view public.v_operations
with (security_invoker = true) as
select
  o.id,
  o.date_operation,
  o.mois_rattachement,
  o.libelle,
  o.montant,
  o.devise,
  o.titulaire,
  o.note,
  o.compte_id,
  c.banque,
  c.nom as compte_nom,
  o.poste_id,
  p.nom as poste_nom,
  cat.nom as categorie_nom,
  (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id, 'poste_id', v.poste_id, 'poste_nom', vp.nom, 'montant', v.montant, 'note', v.note
    ) order by v.id), '[]'::jsonb)
    from public.ventilations v join public.postes vp on vp.id = v.poste_id
    where v.operation_id = o.id
  ) as ventilations,
  (o.poste_id is null and not exists (select 1 from public.ventilations v2 where v2.operation_id = o.id)) as a_classer
from public.operations o
join public.comptes c on c.id = o.compte_id
left join public.postes p on p.id = o.poste_id
left join public.categories cat on cat.id = p.categorie_id;

-- v_lignes_analyse : une ligne par poste (les opérations divisées comptent
-- chaque morceau dans son poste) ; base des bilans
create view public.v_lignes_analyse
with (security_invoker = true) as
select o.id as operation_id, o.compte_id, o.date_operation, o.mois_rattachement, o.titulaire,
       o.poste_id, o.montant
from public.operations o
where not exists (select 1 from public.ventilations v where v.operation_id = o.id)
union all
select o.id, o.compte_id, o.date_operation, o.mois_rattachement, o.titulaire,
       v.poste_id, v.montant
from public.ventilations v
join public.operations o on o.id = v.operation_id;

revoke all on public.v_lignes_analyse from anon;
grant select on public.v_lignes_analyse to authenticated, service_role;
