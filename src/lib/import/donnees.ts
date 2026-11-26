import { supabase } from "../supabase";
import type { Historique, Regle } from "./classement";

export type CompteImport = {
  id: number;
  banque: string;
  nom: string;
  titulaire: string;
  devise: string;
  identifiant_import: string | null;
  ouvert: boolean;
  type_compte: string;
  groupe: string; // Famille, Enfants ou LetzCelebrate
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
    .select("id, banque, nom, titulaire, devise, identifiant_import, ouvert, type_compte, groupe")
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

/** Opérations des cartes (pour retrouver la carte d'un décompte Visa). */
export async function chargerMouvementsCartes(compteIds: number[]) {
  if (compteIds.length === 0) return [];
  return toutLire<{ compte_id: number; date_operation: string; libelle: string; montant: number }>(() =>
    supabase
      .from("operations")
      .select("compte_id, date_operation, libelle, montant")
      .in("compte_id", compteIds)
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

/** posteId vide : règle « ne jamais deviner ». */
export async function ajouterRegle(motif: string, posteId: number | null, aConfirmer: boolean) {
  const { error } = await supabase
    .from("regles_classement")
    .insert({ motif: motif.trim(), poste_id: posteId, a_confirmer: posteId === null ? true : aConfirmer });
  if (error) throw new Error(error.message);
}

export type Ventilation = { poste_id: number; montant: number; note: string };

/** Change le poste et/ou la note d'une opération existante (supprime une éventuelle division). */
export async function modifierOperation(id: number, posteId: number | null, note: string) {
  const { error: e1 } = await supabase.rpc("diviser_operation", { p_operation_id: id, p_lignes: [] });
  if (e1) throw new Error(e1.message);
  const { error } = await supabase.from("operations").update({ poste_id: posteId, note: note.trim() || null }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Divise une opération existante en plusieurs postes (le total doit tomber juste). */
export async function diviserOperation(id: number, lignes: Ventilation[], note: string) {
  const { error } = await supabase.rpc("diviser_operation", { p_operation_id: id, p_lignes: lignes });
  if (error) throw new Error(error.message);
  const { error: e2 } = await supabase.from("operations").update({ note: note.trim() || null }).eq("id", id);
  if (e2) throw new Error(e2.message);
}

/** Opérations non divisées dont le libellé commence par le texte donné (pour corriger tout un tiers). */
export async function operationsDuTiers(debutLibelle: string) {
  const motif = debutLibelle.trim().replace(/[%_\\]/g, "");
  if (motif.length < 3) return [];
  return toutLire<{ id: number; poste_id: number | null; ventilations: unknown[] }>(() =>
    supabase.from("v_operations").select("id, poste_id, ventilations").ilike("libelle", `${motif}%`).order("id"),
  ).then((ops) => ops.filter((o) => o.ventilations.length === 0));
}

export async function reclasser(ids: number[], posteId: number) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from("operations").update({ poste_id: posteId }).in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
}

export type LigneAImporter = {
  compte_id?: number; // autre compte que celui du fichier (ligne positive d'un décompte Visa sur la carte)
  date_operation: string;
  libelle: string;
  montant: number;
  devise: string;
  titulaire: string;
  poste_id: number | null;
  note: string;
  ventilations: Ventilation[];
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
