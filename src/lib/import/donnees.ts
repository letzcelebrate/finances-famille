import { supabase } from "../supabase";
import type { Historique, Regle } from "./classement";

export type CompteImport = {
  id: number;
  banque: string;
  nom: string;
  titulaire: string;
  identifiant_import: string | null;
  ouvert: boolean;
};

export type Poste = { id: number; nom: string; categorie: string; rang: number; ordre: number };

/** Lit toutes les lignes d'une requête, par pages de 1000 (limite du serveur). */
async function toutLire<T>(construire: () => any): Promise<T[]> {
  const res: T[] = [];
  for (let debut = 0; ; debut += 1000) {
    const { data, error } = await construire().range(debut, debut + 999);
    if (error) throw new Error(error.message);
    res.push(...(data as T[]));
    if (!data || data.length < 1000) return res;
  }
}

export async function chargerComptes(): Promise<CompteImport[]> {
  const { data, error } = await supabase
    .from("comptes")
    .select("id, banque, nom, titulaire, identifiant_import, ouvert")
    .order("banque")
    .order("nom");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function chargerPostes(): Promise<Poste[]> {
  const { data, error } = await supabase.from("postes").select("id, nom, ordre, categories(nom, rang)").order("ordre");
  if (error) throw new Error(error.message);
  return (data ?? []).map((p: any) => ({
    id: p.id,
    nom: p.nom,
    ordre: p.ordre,
    categorie: p.categories?.nom ?? "",
    rang: p.categories?.rang ?? 99,
  }));
}

export async function chargerRegles(): Promise<Regle[]> {
  const { data, error } = await supabase.from("regles_classement").select("motif, poste_id, a_confirmer");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function chargerExistantes(compteId: number, depuis: string) {
  return toutLire<{ date_operation: string; libelle: string; montant: number }>(() =>
    supabase
      .from("operations")
      .select("date_operation, libelle, montant")
      .eq("compte_id", compteId)
      .gte("date_operation", depuis)
      .order("id"),
  );
}

/** Historique servant au classement automatique (dernières années). */
export async function chargerHistorique(depuis = "2019-01-01"): Promise<Historique[]> {
  return toutLire<Historique>(() =>
    supabase
      .from("operations")
      .select("libelle, montant, date_operation, poste_id")
      .gte("date_operation", depuis)
      .not("poste_id", "is", null)
      .order("id"),
  );
}

export async function soldeCompte(compteId: number): Promise<number> {
  const { data, error } = await supabase.from("v_soldes_comptes").select("solde").eq("compte_id", compteId).single();
  if (error) throw new Error(error.message);
  return Number(data.solde);
}

export async function memoriserIdentifiant(compteId: number, identifiant: string, format: string) {
  const { error } = await supabase
    .from("comptes")
    .update({ identifiant_import: identifiant, format_import: format })
    .eq("id", compteId);
  if (error) throw new Error(error.message);
}

export async function ajouterRegle(motif: string, posteId: number, aConfirmer: boolean) {
  const { error } = await supabase
    .from("regles_classement")
    .insert({ motif: motif.trim(), poste_id: posteId, a_confirmer: aConfirmer });
  if (error) throw new Error(error.message);
}

export type LigneAImporter = {
  date_operation: string;
  libelle: string;
  montant: number;
  devise: string;
  titulaire: string;
  poste_id: number | null;
  empreinte: string;
};

export async function importer(compteId: number, nomFichier: string, nbLignesFichier: number, lignes: LigneAImporter[]) {
  const { data, error } = await supabase.rpc("importer_operations", {
    p_compte_id: compteId,
    p_nom_fichier: nomFichier,
    p_nb_lignes_fichier: nbLignesFichier,
    p_lignes: lignes,
  });
  if (error) throw new Error(error.message);
  return data as number;
}
