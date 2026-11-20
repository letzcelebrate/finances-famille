-- Import : une ligne peut viser un autre compte que celui du fichier.
-- Sert aux décomptes Visa : en important le compte courant, la ligne positive
-- correspondante est ajoutée sur la carte, dans la même transaction (tout ou rien).
-- p_lignes : [{ compte_id (facultatif, défaut p_compte_id), date_operation, libelle,
--               montant, devise, titulaire, poste_id, empreinte, note,
--               ventilations: [{poste_id, montant, note}] }]
-- Signature inchangée ; seul le corps change.
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
  v_compte_id bigint;
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
    v_compte_id := coalesce(nullif(v_ligne ->> 'compte_id', '')::bigint, p_compte_id);

    -- numéro d'occurrence à la suite de ceux déjà en base (y compris ce fichier)
    select coalesce(max(occurrence), 0) + 1 into v_occ
    from public.operations
    where compte_id = v_compte_id and empreinte = v_ligne ->> 'empreinte';

    v_divisee := jsonb_array_length(coalesce(v_ligne -> 'ventilations', '[]'::jsonb)) > 0;

    insert into public.operations
      (compte_id, date_operation, libelle, montant, devise, titulaire, poste_id, note, empreinte, occurrence, import_id)
    values (
      v_compte_id,
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

revoke all on function public.importer_operations(bigint, text, integer, jsonb) from public, anon;
grant execute on function public.importer_operations(bigint, text, integer, jsonb) to authenticated, service_role;
