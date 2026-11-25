import { describe, expect, it } from "vitest";
import { celluleBrute, celluleTexte } from "../csv";

describe("export CSV", () => {
  it("neutralise les textes qui ressemblent à une formule", () => {
    expect(celluleTexte("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(celluleTexte("+33 virement")).toBe("'+33 virement");
    expect(celluleTexte("-remboursement")).toBe("'-remboursement");
    expect(celluleTexte("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("laisse les textes ordinaires intacts", () => {
    expect(celluleTexte("CARREFOUR LUXEMBOURG")).toBe("CARREFOUR LUXEMBOURG");
    expect(celluleTexte(null)).toBe("");
    expect(celluleTexte("a;b")).toBe("\"a;b\"");
  });

  it("garde les montants négatifs tels quels", () => {
    expect(celluleBrute("-12,50")).toBe("-12,50");
  });
});
