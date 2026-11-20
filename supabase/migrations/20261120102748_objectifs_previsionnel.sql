-- Étape 5 (suite) : objectifs et prévisionnel
--
-- objectifs : un objectif par poste.
--   mode « variable » : montant = total attendu pour chaque mois concerné ;
--                      le mois en cours est complété au prorata des jours.
--   mode « regulier » : montant = montant d'UNE opération, nb_operations par
--                      mois concerné ; le mois en cours est complété avec les
--                      opérations encore attendues.
--   mois : mois concernés (1 = janvier … 12 = décembre). Tous par défaut ;
--          ex. {3} pour une assurance payée en mars.
--   Les montants suivent le signe des opérations (dépense négative).

create table public.objectifs (
  poste_id bigint primary key references public.postes (id) on delete cascade,
  mode text not null check (mode in ('variable', 'regulier')),
  montant numeric(14, 2) not null,
  nb_operations integer not null default 1 check (nb_operations between 1 and 31),
  mois smallint[] not null default '{1,2,3,4,5,6,7,8,9,10,11,12}'
    check (cardinality(mois) between 1 and 12 and mois <@ '{1,2,3,4,5,6,7,8,9,10,11,12}'::smallint[]),
  modifie_par uuid references auth.users (id) on delete set null default auth.uid(),
  modifie_le timestamptz not null default now()
);

create trigger objectifs_modifie_le
  before update on public.objectifs
  for each row execute function public.maj_modifie_le();

alter table public.objectifs enable row level security;
create policy objectifs_membres on public.objectifs
  for all to authenticated
  using ((select public.est_membre())) with check ((select public.est_membre()));
revoke all on public.objectifs from anon;
revoke truncate, references, trigger on public.objectifs from authenticated;
grant select, insert, update, delete on public.objectifs to authenticated, service_role;

-- historique_postes : pour chaque poste, nombre d'opérations et total par
-- mois de rattachement, entre p_debut (inclus) et p_fin (exclu).
-- Une ligne par poste (tableaux par mois) : au plus une centaine de lignes.
-- Sert à pré-remplir les objectifs et à compter les opérations déjà passées.
create or replace function public.historique_postes(p_debut date, p_fin date)
returns table (poste_id bigint, mois date[], nb integer[], total numeric[])
language sql
stable
security invoker
set search_path = ''
as $$
  select m.poste_id,
         array_agg(m.mois order by m.mois),
         array_agg(m.nb order by m.mois),
         array_agg(m.total order by m.mois)
  from (
    select l.poste_id, l.mois_rattachement as mois, count(*)::integer as nb, sum(l.montant) as total
    from public.v_lignes_analyse l
    where l.poste_id is not null
      and l.mois_rattachement >= p_debut and l.mois_rattachement < p_fin
    group by l.poste_id, l.mois_rattachement
  ) m
  group by m.poste_id;
$$;

revoke all on function public.historique_postes(date, date) from public, anon;
grant execute on function public.historique_postes(date, date) to authenticated, service_role;

-- derniere_date_import : date de la dernière opération des comptes importés
-- depuis la banque (sert au prorata des jours du mois en cours).
create or replace function public.derniere_date_import()
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select max(o.date_operation)
  from public.operations o
  join public.comptes c on c.id = o.compte_id
  where c.format_import is not null;
$$;

revoke all on function public.derniere_date_import() from public, anon;
grant execute on function public.derniere_date_import() to authenticated, service_role;
