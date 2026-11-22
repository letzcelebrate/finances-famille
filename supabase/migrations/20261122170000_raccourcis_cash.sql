-- Raccourcis de saisie Cash : modèles pré-remplis (libellé + poste + montant
-- facultatif) pour accélérer la saisie des dépenses en espèces.
create table public.raccourcis_cash (
  id bigint generated always as identity primary key,
  libelle text not null,
  poste_id bigint references public.postes (id) on delete set null,
  montant numeric(14, 2),               -- montant par défaut (facultatif ; null = à saisir)
  ordre integer not null default 0,
  modifie_par uuid references auth.users (id) on delete set null default auth.uid(),
  modifie_le timestamptz not null default now()
);

alter table public.raccourcis_cash enable row level security;
create policy raccourcis_cash_membres on public.raccourcis_cash
  for all to authenticated
  using ((select public.est_membre())) with check ((select public.est_membre()));
revoke all on public.raccourcis_cash from anon;
revoke truncate, references, trigger on public.raccourcis_cash from authenticated;
grant select, insert, update, delete on public.raccourcis_cash to authenticated, service_role;
