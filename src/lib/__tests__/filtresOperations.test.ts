import { describe, expect, it } from "vitest";
import { appliquerFiltres, colonnesActives, FILTRES_VIDES, lireMontant, raccourcisDates, type Filtres, type Requete } from "../filtresOperations";

/** Faux constructeur de requête : enregistre les appels. */
class Espion implements Requete<Espion> {
  appels: string[] = [];
  private n(s: string) { this.appels.push(s); return this; }
  gte(c: string, v: string | number) { return this.n(`gte ${c} ${v}`); }
  lte(c: string, v: string | number) { return this.n(`lte ${c} ${v}`); }
  lt(c: string, v: number) { return this.n(`lt ${c} ${v}`); }
  gt(c: string, v: number) { return this.n(`gt ${c} ${v}`); }
  in(c: string, v: number[]) { return this.n(`in ${c} ${v.join("|")}`); }
  or(e: string) { return this.n(`or ${e}`); }
}
const appels = (f: Partial<Filtres>, divisees: number[] = []) =>
  appliquerFiltres(new Espion(), { ...FILTRES_VIDES, ...f }, divisees).appels;

describe("appliquerFiltres", () => {
  it("aucun filtre : aucune condition", () => expect(appels({})).toEqual([]));

  it("dates du / au", () => {
    expect(appels({ du: "2026-01-01", au: "2026-01-31" })).toEqual([
      "gte date_operation 2026-01-01", "lte date_operation 2026-01-31",
    ]);
  });

  it("texte dans le libellé ou la note, caractères spéciaux retirés", () => {
    expect(appels({ texte: " amazon, (prime) " })).toEqual(["or libelle.ilike.%amazon prime%,note.ilike.%amazon prime%"]);
  });

  it("comptes cochés ; aucun coché = aucune opération", () => {
    expect(appels({ comptes: [46, 48] })).toEqual(["in compte_id 46|48"]);
    expect(appels({ comptes: [] })).toEqual(["in compte_id -1"]);
  });

  it("postes : poste direct, part d'une opération divisée, ou à classer", () => {
    expect(appels({ postes: [3, 7], aClasser: false }, [501, 502])).toEqual(["or poste_id.in.(3,7),id.in.(501,502)"]);
    expect(appels({ postes: [3], aClasser: true })).toEqual(["or poste_id.in.(3),a_classer.is.true"]);
    expect(appels({ postes: [], aClasser: true })).toEqual(["or a_classer.is.true"]);
    expect(appels({ postes: [], aClasser: false })).toEqual(["in id -1"]);
  });

  it("montants : dépenses entre 50 et 100 €", () => {
    expect(appels({ sens: "depenses", montantMin: "50", montantMax: "100" })).toEqual([
      "lt montant 0", "lte montant -50", "gte montant -100",
    ]);
  });

  it("montants : entrées à partir de 1 000,50 €", () => {
    expect(appels({ sens: "entrees", montantMin: "1 000,50" })).toEqual(["gt montant 0", "gte montant 1000.5"]);
  });

  it("montants : dépenses ou entrées entre 50 et 100 €", () => {
    expect(appels({ montantMin: "50", montantMax: "100" })).toEqual([
      "or and(montant.gte.50,montant.lte.100),and(montant.gte.-100,montant.lte.-50)",
    ]);
  });
});

describe("plusieurs filtres « ou » à la fois", () => {
  it("sont regroupés en une seule condition où tout doit être vrai", () => {
    expect(appels({ texte: "delhaize", postes: [19], aClasser: false, montantMin: "50" })).toEqual([
      "or and(or(libelle.ilike.%delhaize%,note.ilike.%delhaize%),or(poste_id.in.(19)),or(and(montant.gte.50),and(montant.lte.-50)))",
    ]);
  });
  it("se combinent avec les autres filtres", () => {
    expect(appels({ du: "2026-01-01", comptes: [46], texte: "x", sens: "depenses" })).toEqual([
      "gte date_operation 2026-01-01", "in compte_id 46", "lt montant 0", "or libelle.ilike.%x%,note.ilike.%x%",
    ]);
  });
});

describe("outils", () => {
  it("lireMontant", () => {
    expect(lireMontant("12,5")).toBe(12.5);
    expect(lireMontant("-30")).toBe(30);
    expect(lireMontant("")).toBeNull();
    expect(lireMontant("abc")).toBeNull();
  });

  it("colonnes filtrées", () => {
    expect([...colonnesActives({ ...FILTRES_VIDES, texte: "x", comptes: [1], sens: "depenses" })]).toEqual([
      "libelle", "compte", "montant",
    ]);
  });

  it("raccourcis de dates", () => {
    const r = raccourcisDates(new Date(2026, 0, 15));
    expect(r[0]).toEqual(["Ce mois-ci", "2026-01-01", "2026-01-31"]);
    expect(r[1]).toEqual(["Mois dernier", "2025-12-01", "2025-12-31"]);
    expect(r[3]).toEqual(["L'an dernier", "2025-01-01", "2025-12-31"]);
  });
});
