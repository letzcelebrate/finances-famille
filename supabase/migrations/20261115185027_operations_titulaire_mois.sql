-- Étape 3 : informations nécessaires à la reprise de l'historique Excel
-- - titulaire : Joint / Perso SA / Perso MG, porté par chaque opération
--   (un même compte peut mélanger opérations jointes et personnelles) ;
-- - mois_rattachement : mois utilisé par les bilans (premier jour du mois).
--   Par défaut, le mois de la date d'opération ; modifiable pour rattacher
--   une opération à un autre mois (ex. relevé de carte de fin de mois).

alter table public.operations
  add column titulaire text not null default 'Joint'
    check (titulaire in ('Joint', 'Perso SA', 'Perso MG')),
  add column mois_rattachement date;

create or replace function public.operations_mois_par_defaut()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mois_rattachement is null then
    new.mois_rattachement := date_trunc('month', new.date_operation)::date;
  else
    new.mois_rattachement := date_trunc('month', new.mois_rattachement)::date;
  end if;
  return new;
end;
$$;

create trigger operations_mois_rattachement
  before insert or update on public.operations
  for each row execute function public.operations_mois_par_defaut();

-- Table vide à ce stade : on peut rendre la colonne obligatoire tout de suite
alter table public.operations
  alter column mois_rattachement set not null;

create index operations_mois_idx on public.operations (mois_rattachement);
