import { supabase } from "./supabase";

/** Au-delà de ce montant (en valeur absolue), on considère les Neutres déséquilibrés. */
const SEUIL = 1;

export type EtatNeutres = { total: number; depuis: string; ok: boolean };

/**
 * Somme des virements internes (catégorie « Neutres ») sur les derniers mois.
 * Doit tendre vers 0 : sinon un virement a probablement un seul côté enregistré.
 */
export async function etatNeutresRecent(moisGlissants = 12): Promise<EtatNeutres> {
  const d = new Date();
  const debut = new Date(d.getFullYear(), d.getMonth() - (moisGlissants - 1), 1);
  const cutoff = `${debut.getFullYear()}-${String(debut.getMonth() + 1).padStart(2, "0")}-01`;
  const { data, error } = await supabase
    .from("v_operations")
    .select("montant")
    .eq("categorie_nom", "Neutres")
    .gte("date_operation", cutoff)
    .range(0, 4999);
  if (error) throw new Error(error.message);
  const centimes = (data ?? []).reduce((t: number, l: { montant: number | string }) => t + Math.round(Number(l.montant) * 100), 0);
  const total = centimes / 100;
  return { total, depuis: cutoff, ok: Math.abs(total) < SEUIL };
}
