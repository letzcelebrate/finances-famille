-- Prév & Targets : option « + LetzCelebrate » (désactivée par défaut).
-- v_lignes_analyse porte désormais le groupe du compte (sans filtre) ;
-- bilan_par_mois et historique_postes prennent les groupes à inclure,
-- Famille seulement par défaut (Bilan par mois et appels existants inchangés).

create or replace view public.v_lignes_analyse
with (security_invoker = true) as
select o.id as operation_id, o.compte_id, o.date_operation, o.mois_rattachement, o.titulaire,
       o.poste_id, o.montant, c.groupe
from public.operations o
join public.comptes c on c.id = o.compte_id
where not exists (select 1 from public.ventilations v where v.operation_id = o.id)
union all
select o.id, o.compte_id, o.date_operation, o.mois_rattachement, o.titulaire,
       v.poste_id, v.montant, c.groupe
from public.ventilations v
join public.operations o on o.id = v.operation_id
join public.comptes c on c.id = o.compte_id;

drop function public.bilan_par_mois(integer);
create function public.bilan_par_mois(p_annee integer, p_groupes text[] default array['Famille'])
returns table (
  categorie_id bigint,
  categorie text,
  categorie_rang integer,
  poste_id bigint,
  poste text,
  poste_ordre integer,
  m01 numeric, m02 numeric, m03 numeric, m04 numeric,
  m05 numeric, m06 numeric, m07 numeric, m08 numeric,
  m09 numeric, m10 numeric, m11 numeric, m12 numeric,
  total numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.nom, c.rang, p.id, p.nom, p.ordre,
    coalesce(sum(l.montant) filter (where extract(month from l.mois_rattachement) = 1), 0),
    coalesce(sum(l.montant) filter (where extract(month from l.mois_rattachement) = 2), 0),
    coalesce(sum(l.montant) filter (where extract(month from l.mois_rattachement) = 3), 0),
    coalesce(sum(l.montant) filter (where extract(month from l.mois_rattachement) = 4), 0),
    coalesce(sum(l.montant) filter (where extract(month from l.mois_rattachement) = 5), 0),
    coalesce(sum(l.montant) filter (where extract(month from l.mois_rattachement) = 6), 0),
    coalesce(sum(l.montant) filter (where extract(month from l.mois_rattachement) = 7), 0),
    coalesce(sum(l.montant) filter (where extract(month from l.mois_rattachement) = 8), 0),
    coalesce(sum(l.montant) filter (where extract(month from l.mois_rattachement) = 9), 0),
    coalesce(sum(l.montant) filter (where extract(month from l.mois_rattachement) = 10), 0),
    coalesce(sum(l.montant) filter (where extract(month from l.mois_rattachement) = 11), 0),
    coalesce(sum(l.montant) filter (where extract(month from l.mois_rattachement) = 12), 0),
    sum(l.montant)
  from public.v_lignes_analyse l
  left join public.postes p on p.id = l.poste_id
  left join public.categories c on c.id = p.categorie_id
  where l.mois_rattachement >= make_date(p_annee, 1, 1)
    and l.mois_rattachement < make_date(p_annee + 1, 1, 1)
    and l.groupe = any (p_groupes)
  group by c.id, c.nom, c.rang, p.id, p.nom, p.ordre
  order by c.rang nulls last, c.nom, p.ordre, p.nom;
$$;

revoke all on function public.bilan_par_mois(integer, text[]) from public, anon;
grant execute on function public.bilan_par_mois(integer, text[]) to authenticated, service_role;

drop function public.historique_postes(date, date);
create function public.historique_postes(p_debut date, p_fin date, p_groupes text[] default array['Famille'])
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
      and l.groupe = any (p_groupes)
    group by l.poste_id, l.mois_rattachement
  ) m
  group by m.poste_id;
$$;

revoke all on function public.historique_postes(date, date, text[]) from public, anon;
grant execute on function public.historique_postes(date, date, text[]) to authenticated, service_role;
