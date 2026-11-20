import { describe, expect, it } from "vitest";
import { attribuerCartes, dateReleve, type CarteDecompte } from "../decomptes";

// Montants fictifs
const carteA = (): CarteDecompte => ({
  id: 1,
  mouvements: [
    { date_operation: "2026-01-10", libelle: "MAGASIN", montant: -300 },
    { date_operation: "2026-01-15", libelle: "RESTAURANT", montant: -50 },
    { date_operation: "2026-01-28", libelle: "APRES RELEVE", montant: -20 },
  ],
});
const carteB = (): CarteDecompte => ({
  id: 2,
  mouvements: [
    { date_operation: "2026-01-05", libelle: "LIBRAIRIE", montant: -100 },
    { date_operation: "2026-01-12", libelle: "PHARMACIE", montant: -45.5 },
  ],
});

describe("décomptes Visa", () => {
  it("reconnaît le libellé et lit la date du relevé", () => {
    expect(dateReleve("DECOMPTE VISA AU 24/10/2026")).toBe("2026-10-24");
    expect(dateReleve("decompte visa au 01/02/2026 suite")).toBe("2026-02-01");
    expect(dateReleve("VIREMENT DECOMPTE VISA AU 24/10/2026")).toBeNull();
    expect(dateReleve("AMAZON")).toBeNull();
  });

  it("associe chaque décompte à la carte dont le solde au relevé correspond", () => {
    const r = attribuerCartes(
      [
        { cle: 0, date_operation: "2026-02-05", libelle: "DECOMPTE VISA AU 24/01/2026", montant: -145.5 },
        { cle: 1, date_operation: "2026-02-05", libelle: "DECOMPTE VISA AU 24/01/2026", montant: -350 },
      ],
      [carteA(), carteB()],
    );
    expect(r.get(0)).toEqual({ carte_id: 2, deja_presente: false });
    expect(r.get(1)).toEqual({ carte_id: 1, deja_presente: false });
  });

  it("tient compte des décomptes précédents du même fichier", () => {
    const a = carteA();
    a.mouvements.push({ date_operation: "2026-02-10", libelle: "FEVRIER", montant: -80 });
    const b = carteB();
    b.mouvements.push({ date_operation: "2026-02-11", libelle: "FEVRIER", montant: -500 });
    const r = attribuerCartes(
      [
        { cle: 0, date_operation: "2026-02-05", libelle: "DECOMPTE VISA AU 24/01/2026", montant: -350 },
        { cle: 1, date_operation: "2026-02-05", libelle: "DECOMPTE VISA AU 24/01/2026", montant: -145.5 },
        // relevé suivant : A = -80-20, B = -500 (une fois janvier remboursé)
        { cle: 2, date_operation: "2026-03-05", libelle: "DECOMPTE VISA AU 21/02/2026", montant: -100 },
        { cle: 3, date_operation: "2026-03-05", libelle: "DECOMPTE VISA AU 21/02/2026", montant: -500 },
      ],
      [a, b],
    );
    expect([0, 1, 2, 3].map((k) => r.get(k)!.carte_id)).toEqual([1, 2, 1, 2]);
  });

  it("ne propose rien si la ligne positive est déjà sur une carte", () => {
    const b = carteB();
    b.mouvements.push({ date_operation: "2026-02-05", libelle: "DECOMPTE VISA AU 24/01/2026", montant: 145.5 });
    const r = attribuerCartes(
      [{ cle: 0, date_operation: "2026-02-05", libelle: "DECOMPTE VISA AU 24/01/2026", montant: -145.5 }],
      [carteA(), b],
    );
    expect(r.get(0)).toEqual({ carte_id: 2, deja_presente: true });
  });

  it("ignore les autres opérations et fonctionne sans carte", () => {
    const r = attribuerCartes(
      [
        { cle: 0, date_operation: "2026-02-05", libelle: "LOYER", montant: -900 },
        { cle: 1, date_operation: "2026-02-05", libelle: "DECOMPTE VISA AU 24/01/2026", montant: -10 },
      ],
      [],
    );
    expect(r.has(0)).toBe(false);
    expect(r.get(1)).toEqual({ carte_id: null, deja_presente: false });
  });
});
