-- Étape 4 (première version de l'application) : vues de lecture
-- security_invoker : les vues appliquent les règles RLS de la personne connectée
-- (un non-membre ne voit rien).

create view public.v_soldes_comptes
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
  max(o.date_operation) as derniere_operation
from public.comptes c
left join public.operations o on o.compte_id = c.id
group by c.id;

create view public.v_operations
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
  cat.nom as categorie_nom
from public.operations o
join public.comptes c on c.id = o.compte_id
left join public.postes p on p.id = o.poste_id
left join public.categories cat on cat.id = p.categorie_id;

revoke all on public.v_soldes_comptes, public.v_operations from anon;
grant select on public.v_soldes_comptes, public.v_operations to authenticated, service_role;
