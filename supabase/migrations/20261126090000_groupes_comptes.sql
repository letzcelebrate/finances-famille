-- Groupes de comptes : Famille (par défaut), Enfants, LetzCelebrate.
-- Les comptes Enfants et LetzCelebrate sont affichés à part dans la Synthèse,
-- hors patrimoine de la famille, et exclus des bilans, du prévisionnel et des
-- soldes annuels (leurs opérations restent visibles dans Opérations).

alter table public.comptes
  add column groupe text not null default 'Famille'
    check (groupe in ('Famille', 'Enfants', 'LetzCelebrate'));

-- Synthèse : le groupe est ajouté en fin de vue (colonnes existantes inchangées)
create or replace view public.v_soldes_comptes
with (security_invoker = true) as
select
  c.id as compte_id,
  c.banque,
  c.nom,
  c.type_compte,
  c.titulaire,
  c.devise,
  c.ouvert,
  coalesce(sum(o.montant), 0)::numeric(14, 2) as solde,
  count(o.id) as nb_operations,
  max(o.date_operation) as derniere_operation,
  c.groupe
from public.comptes c
left join public.operations o on o.compte_id = c.id
group by c.id;

-- Base des bilans et du prévisionnel : comptes de la famille uniquement
create or replace view public.v_lignes_analyse
with (security_invoker = true) as
select o.id as operation_id, o.compte_id, o.date_operation, o.mois_rattachement, o.titulaire,
       o.poste_id, o.montant
from public.operations o
join public.comptes c on c.id = o.compte_id and c.groupe = 'Famille'
where not exists (select 1 from public.ventilations v where v.operation_id = o.id)
union all
select o.id, o.compte_id, o.date_operation, o.mois_rattachement, o.titulaire,
       v.poste_id, v.montant
from public.ventilations v
join public.operations o on o.id = v.operation_id
join public.comptes c on c.id = o.compte_id and c.groupe = 'Famille';

create or replace function public.annees_bilan()
returns setof integer
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct extract(year from o.mois_rattachement)::integer
  from public.operations o
  join public.comptes c on c.id = o.compte_id and c.groupe = 'Famille'
  order by 1 desc;
$$;

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
  where c.format_import is not null and c.groupe = 'Famille';
$$;

-- Soldes annuels : comptes de la famille uniquement
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
  with famille as (
    select * from public.comptes where groupe = 'Famille'
  ),
  bornes as (
    select extract(year from min(o.date_operation))::integer as debut,
           extract(year from current_date)::integer as fin
    from public.operations o
    join famille f on f.id = o.compte_id
  ),
  mouvements as (
    select o.compte_id, extract(year from o.date_operation)::integer as annee, sum(o.montant) as total
    from public.operations o
    join famille f on f.id = o.compte_id
    group by o.compte_id, extract(year from o.date_operation)
  ),
  grille as (
    select c.id as compte_id, a.annee
    from famille c
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
  from famille c
  join cumul cu on cu.compte_id = c.id
  group by c.id, c.banque, c.nom, c.type_compte, c.ouvert;
$$;

-- Nouveaux comptes (le numéro IBAN / carte est mémorisé au premier import)
insert into public.comptes (banque, nom, type_compte, titulaire, groupe) values
  ('Raiffeisen', 'Compte Epargne Max', 'Epargne', 'Joint', 'Enfants'),
  ('Raiffeisen', 'Compte Epargne Tom', 'Epargne', 'Joint', 'Enfants'),
  ('Raiffeisen', 'Compte Courant LetzCelebrate', 'Courant', 'Perso SA', 'LetzCelebrate'),
  ('Raiffeisen', 'Visa LetzCelebrate', 'Carte Bancaire', 'Perso SA', 'LetzCelebrate')
on conflict (banque, nom) do nothing;

-- Compte Epargne Max : solde avant le premier mouvement importé (17/10/2025).
-- Solde banque 340,20 € moins les mouvements du fichier (286,94 €) = 53,26 €.
insert into public.operations (compte_id, date_operation, libelle, montant, titulaire, empreinte, occurrence)
select c.id, date '2025-10-16', 'Solde d''ouverture', 53.26, 'Joint', md5('2025-10-16|SOLDE D''OUVERTURE|53.26'), 1
from public.comptes c
where c.banque = 'Raiffeisen' and c.nom = 'Compte Epargne Max'
  and not exists (select 1 from public.operations o where o.compte_id = c.id and o.libelle = 'Solde d''ouverture');
