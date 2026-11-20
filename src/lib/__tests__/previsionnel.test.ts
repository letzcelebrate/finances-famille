import { describe, expect, it } from "vitest";
import {
  aRevoir, cleMois, periode, prevoirPoste, reference, statut, suggererObjectif, TOUS_LES_MOIS, unAnAvant,
  type Historique, type Objectif,
} from "../previsionnel";

/** Historique fictif : fonction (annee, mois) -> [nb, total] ou null */
function histo(f: (annee: number, mois: number) => [number, number] | null): Historique {
  const h: Historique = new Map();
  for (const a of [2024, 2025, 2026]) {
    for (let m = 1; m <= 12; m++) {
      const v = f(a, m);
      if (v) h.set(cleMois(a, m), { nb: v[0], total: v[1] });
    }
  }
  return h;
}
// Référence : novembre 2026 -> fenêtre de 12 mois = nov. 2025 à oct. 2026
const A = 2026, M = 11;

describe("suggererObjectif", () => {
  it("crédit : 3 prélèvements tous les mois -> régulier 3 / mois", () => {
    const s = suggererObjectif(1, histo(() => [3, -3711.37]), A, M);
    expect(s).toEqual({ poste_id: 1, mode: "regulier", montant: -1237.12, nb_operations: 3, mois: TOUS_LES_MOIS });
  });

  it("femme de ménage : 2 fois par mois, parfois 1 ou 3 -> régulier 2 / mois", () => {
    const s = suggererObjectif(2, histo((a, m) => (a === 2026 && m === 6 ? [1, -160] : a === 2026 && m === 9 ? [3, -480] : [2, -320])), A, M);
    expect(s?.mode).toBe("regulier");
    expect(s?.nb_operations).toBe(2);
    expect(s?.montant).toBe(-160);
  });

  it("supermarché : nombre d'opérations variable -> variable, moyenne mensuelle", () => {
    const s = suggererObjectif(3, histo((_a, m) => [10 + m, -1000 - m * 10]), A, M);
    expect(s?.mode).toBe("variable");
    // nov. 2025 -> oct. 2026 : mois 11, 12, 1 … 10
    expect(s?.montant).toBe(-1065);
    expect(s?.mois).toEqual(TOUS_LES_MOIS);
  });

  it("impôts payés en mai et octobre chaque année -> régulier ces mois-là", () => {
    const s = suggererObjectif(4, histo((_a, m) => (m === 5 || m === 10 ? [1, -2000] : null)), A, M);
    expect(s).toEqual({ poste_id: 4, mode: "regulier", montant: -2000, nb_operations: 1, mois: [5, 10] });
  });

  it("dépense unique (pas l'année d'avant) -> étalée en variable", () => {
    const s = suggererObjectif(5, histo((a, m) => (a === 2026 && m === 5 ? [1, -600] : null)), A, M);
    expect(s).toEqual({ poste_id: 5, mode: "variable", montant: -50, nb_operations: 1, mois: TOUS_LES_MOIS });
  });

  it("montant insignifiant ou aucune opération -> pas de suggestion", () => {
    expect(suggererObjectif(6, histo((a, m) => (a === 2026 && m === 5 ? [1, -12] : null)), A, M)).toBeNull();
    expect(suggererObjectif(7, new Map(), A, M)).toBeNull();
  });
});

describe("aRevoir", () => {
  const o: Objectif = { poste_id: 1, mode: "regulier", montant: -1237, nb_operations: 3, mois: TOUS_LES_MOIS };
  it("identique ou proche -> non", () => {
    expect(aRevoir(o, { ...o, montant: -1240 })).toBe(false);
    expect(aRevoir(o, null)).toBe(false);
  });
  it("nombre d'opérations, mois ou montant différents -> oui", () => {
    expect(aRevoir(o, { ...o, nb_operations: 2 })).toBe(true);
    expect(aRevoir(o, { ...o, mois: [5] })).toBe(true);
    expect(aRevoir(o, { ...o, montant: -1500 })).toBe(true);
    expect(aRevoir(o, { ...o, mode: "variable" })).toBe(true);
  });
});

describe("reference (date du dernier import)", () => {
  it("milieu de mois", () => expect(reference("2026-11-15")).toEqual({ annee: 2026, mois: 11, fraction: 0.5 }));
  it("sans import : date du jour", () => expect(reference(null, new Date(2026, 1, 14))).toEqual({ annee: 2026, mois: 2, fraction: 0.5 }));
});

describe("periode", () => {
  const ref = { annee: 2026, mois: 11 };
  const jour = new Date(2026, 10, 20);
  it("12 mois glissants : mai 2026 → avril 2027", () => {
    const p = periode("glissant", ref, jour);
    expect(p).toHaveLength(12);
    expect(p[0]).toEqual({ annee: 2026, mois: 5 });
    expect(p[6]).toEqual({ annee: 2026, mois: 11 });
    expect(p[11]).toEqual({ annee: 2027, mois: 4 });
  });
  it("glissant en février : août de l'année d'avant → juillet", () => {
    const p = periode("glissant", { annee: 2027, mois: 2 }, jour);
    expect(p[0]).toEqual({ annee: 2026, mois: 8 });
    expect(p[11]).toEqual({ annee: 2027, mois: 7 });
  });
  it("année civile : janvier → décembre de l'année du jour", () => {
    const p = periode("civile", ref, jour);
    expect(p[0]).toEqual({ annee: 2026, mois: 1 });
    expect(p[11]).toEqual({ annee: 2026, mois: 12 });
  });
  it("un an avant : mai 2025 → avril 2026", () => {
    const p = unAnAvant(periode("glissant", ref, jour));
    expect(p[0]).toEqual({ annee: 2025, mois: 5 });
    expect(p[11]).toEqual({ annee: 2026, mois: 4 });
  });
  it("statut des mois", () => {
    expect(statut({ annee: 2026, mois: 10 }, ref)).toBe("passe");
    expect(statut({ annee: 2026, mois: 11 }, ref)).toBe("en-cours");
    expect(statut({ annee: 2027, mois: 1 }, ref)).toBe("a-venir");
    expect(statut({ annee: 2025, mois: 12 }, ref)).toBe("passe");
  });
});

describe("prevoirPoste", () => {
  const zeros = new Array(12).fill(0);
  const ref = { annee: 2026, mois: 11, fraction: 0.5 }; // 15 novembre
  const civile = TOUS_LES_MOIS.map((mois) => ({ annee: 2026, mois }));
  const reel = (nov: number) => zeros.map((_, i) => (i < 10 ? -900 : i === 10 ? nov : 0));

  it("variable : l'exemple des 1 100 € (1 000 prévus, 600 dépensés à mi-mois)", () => {
    const o: Objectif = { poste_id: 1, mode: "variable", montant: -1000, nb_operations: 1, mois: TOUS_LES_MOIS };
    const p = prevoirPoste(o, civile, reel(-600), zeros, ref);
    expect(p.prevision[9]).toBe(-900); // octobre : réel
    expect(p.prevision[10]).toBe(-1100); // novembre : 600 + 1000 × 0,5
    expect(p.prevision[11]).toBe(-1000); // décembre : objectif
    expect(p.objectif[10]).toBe(-1000);
  });

  it("régulier : 2 crédits sur 3 passés -> on ajoute le 3e ; 3 passés -> réel seul", () => {
    const o: Objectif = { poste_id: 1, mode: "regulier", montant: -1237, nb_operations: 3, mois: TOUS_LES_MOIS };
    const nb = zeros.map((_, i) => (i === 10 ? 2 : 0));
    expect(prevoirPoste(o, civile, reel(-2474), nb, ref).prevision[10]).toBe(-3711);
    const nb3 = zeros.map((_, i) => (i === 10 ? 3 : 0));
    expect(prevoirPoste(o, civile, reel(-3711), nb3, ref).prevision[10]).toBe(-3711);
    expect(prevoirPoste(o, civile, reel(-3711), nb3, ref).prevision[11]).toBe(-3711);
  });

  it("certains mois seulement : rien prévu les autres mois", () => {
    const o: Objectif = { poste_id: 1, mode: "regulier", montant: -2000, nb_operations: 1, mois: [5, 12] };
    const p = prevoirPoste(o, civile, zeros, zeros, ref);
    expect(p.prevision[10]).toBe(0);
    expect(p.prevision[11]).toBe(-2000);
    expect(p.objectif).toEqual([0, 0, 0, 0, -2000, 0, 0, 0, 0, 0, 0, -2000]);
  });

  it("12 mois glissants : objectifs de l'année suivante pris au bon mois", () => {
    const o: Objectif = { poste_id: 1, mode: "regulier", montant: -2000, nb_operations: 1, mois: [3] };
    const per = periode("glissant", ref, new Date(2026, 10, 20)); // mai 2026 → avril 2027
    const reelPer = zeros.map((_, i) => (i < 6 ? -10 : 0));
    const p = prevoirPoste(o, per, reelPer, zeros, ref);
    expect(p.prevision.slice(0, 6)).toEqual([-10, -10, -10, -10, -10, -10]); // mai → oct. : réel
    expect(p.prevision[10]).toBe(-2000); // mars 2027
    expect(p.objectif[10]).toBe(-2000);
    expect(p.prevision[11]).toBe(0);
  });

  it("sans objectif : réel seulement", () => {
    expect(prevoirPoste(null, civile, reel(-50), zeros, ref).prevision[10]).toBe(-50);
  });
});
