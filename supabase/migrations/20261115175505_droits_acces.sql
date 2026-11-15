-- Étape 2 (suite) : droits d'accès aux tables
-- Ce projet Supabase ne donne aucun droit de lecture/écriture par défaut :
-- on les accorde explicitement. Les règles RLS limitent ensuite l'accès aux membres.

-- Retirer les droits dangereux accordés par défaut (TRUNCATE contourne les règles RLS)
revoke truncate, references, trigger on
  public.membres, public.categories, public.postes,
  public.comptes, public.imports, public.operations
  from authenticated;

-- Utilisateurs connectés (filtrés ensuite par RLS : membres uniquement)
grant select on public.membres to authenticated;
grant select, insert, update, delete on
  public.categories, public.postes, public.comptes,
  public.imports, public.operations
  to authenticated;

-- Rôle serveur (scripts d'administration, reprise de l'historique)
grant select, insert, update, delete on
  public.membres, public.categories, public.postes,
  public.comptes, public.imports, public.operations
  to service_role;
