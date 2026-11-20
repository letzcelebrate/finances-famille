-- Étape 5 (suite) : soldes annuels
-- Pour chaque compte (ouvert ou fermé) : solde au 31 décembre de chaque année,
-- de la première année des données jusqu'à l'année en cours (solde à ce jour).
-- Date réelle des opérations (pas le mois de rattachement).
-- Une ligne par compte (tableaux par année) : quelques dizaines de lignes.
-- security invoker : les règles d'accès (membres uniquement) s'appliquent.

create or replace function public.soldes_annuels()
returns table (
  compte_id bigint,
  banque text,
  nom text,
  type_compte text,
  ouvert boolean,
  annees integer[],
  soldes numeric[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bornes as (
    select extract(year from min(o.date_operation))::integer as debut,
           extract(year from current_date)::integer as fin
    from public.operations o
  ),
  mouvements as (
    select o.compte_id, extract(year from o.date_operation)::integer as annee, sum(o.montant) as total
    from public.operations o
    group by o.compte_id, extract(year from o.date_operation)
  ),
  grille as (
    select c.id as compte_id, a.annee
    from public.comptes c
    cross join bornes b
    cross join lateral generate_series(b.debut, b.fin) as a(annee)
  ),
  cumul as (
    select g.compte_id, g.annee,
           sum(coalesce(m.total, 0)) over (partition by g.compte_id order by g.annee) as solde
    from grille g
    left join mouvements m on m.compte_id = g.compte_id and m.annee = g.annee
  )
  select c.id, c.banque, c.nom, c.type_compte, c.ouvert,
         array_agg(cu.annee order by cu.annee),
         array_agg(cu.solde order by cu.annee)
  from public.comptes c
  join cumul cu on cu.compte_id = c.id
  group by c.id, c.banque, c.nom, c.type_compte, c.ouvert;
$$;

revoke all on function public.soldes_annuels() from public, anon;
grant execute on function public.soldes_annuels() to authenticated, service_role;
