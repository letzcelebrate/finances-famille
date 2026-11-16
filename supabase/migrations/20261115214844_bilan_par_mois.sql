-- Étape 5 : Bilan par mois
-- Totaux d'une année par poste et par mois de rattachement, calculés dans la
-- base (une ligne par poste : au plus une centaine de lignes renvoyées).
-- Les opérations divisées comptent chaque part dans son poste (v_lignes_analyse).
-- Les opérations sans poste apparaissent sur une ligne sans poste (poste_id vide).
-- security invoker : les règles d'accès (membres uniquement) s'appliquent.

create or replace function public.bilan_par_mois(p_annee integer)
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
  group by c.id, c.nom, c.rang, p.id, p.nom, p.ordre
  order by c.rang nulls last, c.nom, p.ordre, p.nom;
$$;

revoke all on function public.bilan_par_mois(integer) from public, anon;
grant execute on function public.bilan_par_mois(integer) to authenticated, service_role;

-- Années disponibles pour les bilans (de la plus récente à la plus ancienne)
create or replace function public.annees_bilan()
returns setof integer
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct extract(year from o.mois_rattachement)::integer
  from public.operations o
  order by 1 desc;
$$;

revoke all on function public.annees_bilan() from public, anon;
grant execute on function public.annees_bilan() to authenticated, service_role;
