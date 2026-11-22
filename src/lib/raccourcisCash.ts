import { supabase } from "./supabase";

export type RaccourciCash = {
  id: number;
  libelle: string;
  poste_id: number | null;
  /** montant par défaut (magnitude, en valeur absolue) ; null = à saisir à chaque fois */
  montant: number | null;
};

export async function chargerRaccourcis(): Promise<RaccourciCash[]> {
  const { data, error } = await supabase
    .from("raccourcis_cash")
    .select("id, libelle, poste_id, montant")
    .order("ordre")
    .order("libelle");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: Number(r.id),
    libelle: r.libelle,
    poste_id: r.poste_id === null ? null : Number(r.poste_id),
    montant: r.montant === null ? null : Number(r.montant),
  }));
}

export async function ajouterRaccourci(libelle: string, posteId: number | null, montant: number | null): Promise<RaccourciCash> {
  const { data, error } = await supabase
    .from("raccourcis_cash")
    .insert({ libelle: libelle.trim(), poste_id: posteId, montant })
    .select("id, libelle, poste_id, montant")
    .single();
  if (error) throw new Error(error.message);
  return {
    id: Number(data.id),
    libelle: data.libelle,
    poste_id: data.poste_id === null ? null : Number(data.poste_id),
    montant: data.montant === null ? null : Number(data.montant),
  };
}

export async function supprimerRaccourci(id: number): Promise<void> {
  const { error } = await supabase.from("raccourcis_cash").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
