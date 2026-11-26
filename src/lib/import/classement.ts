/**
 * Proposition automatique d'un poste de dépense à partir de l'historique.
 *
 * 0. Règles définies par les membres (« libellé contenant … → poste »),
 *    éventuellement marquées « à confirmer ».
 * 1. Clé « fine » : les deux premiers éléments du libellé (tiers + référence),
 *    sans les dates. Distingue par exemple deux cotisations CCSS différentes.
 * 2. Sinon, clé « tiers » : le début du libellé (avant la première virgule),
 *    sans chiffres ni ponctuation.
 *    Dans les deux cas, on propose le poste le plus fréquent parmi les
 *    opérations passées de même clé (les plus récentes comptent davantage).
 *    Si ce tiers a déjà été classé dans plusieurs postes (ex. la commune :
 *    garde d'enfants ou sport), la proposition est marquée « à confirmer ».
 * 3. Sinon : opération passée la plus ressemblante (mots en commun).
 * 4. Sinon : pas de proposition (« à classer »).
 */

import { normaliser } from "./empreinte";

export type Historique = { libelle: string; montant: number; date_operation: string; poste_id: number | null };

/** poste_id vide : « ne jamais deviner », la ligne reste à classer (ex. AMAZON). */
export type Regle = { motif: string; poste_id: number | null; a_confirmer: boolean };

export type Proposition = {
  poste_id: number | null;
  certitude: "forte" | "moyenne" | "faible" | "aucune";
  raison: string;
};

const MOTS_VIDES = new Set([
  "REFERENCE", "RÉFÉRENCE", "SEPA", "LU", "FR", "BE", "DE", "LA", "LE", "LES", "DU", "DES", "ET", "SA", "SARL",
  "S.A", "R.L", "RUE", "AVENUE", "ROUTE", "BOULEVARD", "PLACE", "CARTE", "PAIEMENT", "ACHAT", "VIREMENT",
  "EUR", "LUXEMBOURG", "THE", "AND", "POUR", "PAR",
]);

export function cleTiers(libelle: string): string {
  const debut = normaliser(libelle).split(",")[0];
  return debut
    .replace(/[0-9]+/g, " ")
    .replace(/[^\p{L} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleFine(libelle: string): string {
  return normaliser(libelle)
    .split(",")
    .slice(0, 2)
    .join(",")
    .replace(/\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mots(libelle: string): Set<string> {
  return new Set(
    normaliser(libelle)
      .replace(/[^\p{L} ]+/gu, " ")
      .split(" ")
      .filter((m) => m.length >= 3 && !MOTS_VIDES.has(m)),
  );
}

export function preparerClassement(historique: Historique[], regles: Regle[] = []) {
  const reglesNorm = regles
    .map((r) => ({ ...r, motifNorm: normaliser(r.motif) }))
    .filter((r) => r.motifNorm.length >= 3)
    // le motif le plus long (le plus précis) l'emporte
    .sort((a, b) => b.motifNorm.length - a.motifNorm.length);

  const classees = historique.filter((h) => h.poste_id !== null);
  const plusRecente = classees.reduce((max, h) => (h.date_operation > max ? h.date_operation : max), "0000-00-00");
  const anneeRef = Number(plusRecente.slice(0, 4));

  type Trace = { poste_id: number; poids: number };
  const parFine = new Map<string, Trace[]>();
  const parTiers = new Map<string, Trace[]>();
  const ajouter = (index: Map<string, Trace[]>, cle: string, t: Trace) => {
    if (cle.length < 3) return;
    const liste = index.get(cle) ?? [];
    liste.push(t);
    index.set(cle, liste);
  };
  for (const h of classees) {
    // poids : 1 pour une opération récente, décroissant avec l'âge
    const age = Math.max(0, anneeRef - Number(h.date_operation.slice(0, 4)));
    const t = { poste_id: h.poste_id!, poids: 1 / (1 + age) };
    ajouter(parFine, cleFine(h.libelle), t);
    ajouter(parTiers, cleTiers(h.libelle), t);
  }

  const voter = (traces: Trace[], nom: string): Proposition => {
    const scores = new Map<number, number>();
    for (const t of traces) scores.set(t.poste_id, (scores.get(t.poste_id) ?? 0) + t.poids);
    const tries = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const total = tries.reduce((s, [, p]) => s + p, 0);
    const part = total > 0 ? tries[0][1] / total : 0;
    const autres = tries.length - 1;
    return {
      poste_id: tries[0][0],
      certitude: part >= 0.8 ? "forte" : "moyenne",
      raison:
        part >= 0.8
          ? `${nom} : ${traces.length} opération(s) passée(s)`
          : `à confirmer : ce tiers a déjà été classé dans ${autres + 1} postes différents`,
    };
  };

  const indexMots = classees.slice(-8000).map((h) => ({ mots: mots(h.libelle), poste_id: h.poste_id!, libelle: h.libelle }));

  return function proposer(libelle: string): Proposition {
    const lib = normaliser(libelle);
    const regle = reglesNorm.find((r) => lib.includes(r.motifNorm));
    if (regle && regle.poste_id === null) {
      return { poste_id: null, certitude: "aucune", raison: `toujours à vérifier (règle « ${regle.motif} »)` };
    }
    if (regle) {
      return {
        poste_id: regle.poste_id,
        certitude: regle.a_confirmer ? "moyenne" : "forte",
        raison: regle.a_confirmer ? `à confirmer (règle « ${regle.motif} »)` : `règle « ${regle.motif} »`,
      };
    }
    const fine = parFine.get(cleFine(libelle));
    if (fine) return voter(fine, "même tiers et même référence");
    const tiers = parTiers.get(cleTiers(libelle));
    if (tiers) return voter(tiers, "même tiers");

    const m = mots(libelle);
    let meilleur: { score: number; poste_id: number; libelle: string } | null = null;
    if (m.size > 0) {
      for (const h of indexMots) {
        let communs = 0;
        for (const x of m) if (h.mots.has(x)) communs++;
        if (communs === 0) continue;
        const score = communs / (m.size + h.mots.size - communs);
        if (!meilleur || score > meilleur.score) meilleur = { score, poste_id: h.poste_id, libelle: h.libelle };
      }
    }
    if (meilleur && meilleur.score >= 0.25) {
      return { poste_id: meilleur.poste_id, certitude: "faible", raison: `ressemble à « ${meilleur.libelle.slice(0, 60)} »` };
    }
    return { poste_id: null, certitude: "aucune", raison: "aucune opération semblable" };
  };
}

/** Début du libellé proposé pour une règle : jusqu'à la première virgule, sans chiffres finaux
 *  (ex. « INTERETS DEBITEURS: 0,03 EUR … » → « INTERETS DEBITEURS »). */
export function motifPropose(libelle: string): string {
  const debut = libelle.split(",")[0].trim();
  return debut.replace(/[\s:;.\-\d]+$/, "").trim() || debut;
}
