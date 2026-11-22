import { describe, expect, it } from "vitest";
import { frVersIso, isoVersFr } from "../../components/ChampDate";

describe("ChampDate — conversions de date", () => {
  it("ISO -> JJ/MM/AAAA", () => {
    expect(isoVersFr("2026-11-22")).toBe("22/11/2026");
    expect(isoVersFr("2026-01-05")).toBe("05/01/2026");
    expect(isoVersFr("")).toBe("");
    expect(isoVersFr("pas une date")).toBe("");
  });

  it("JJ/MM/AAAA -> ISO", () => {
    expect(frVersIso("22/11/2026")).toBe("2026-11-22");
    expect(frVersIso("05/01/2026")).toBe("2026-01-05");
  });

  it("refuse les dates qui n'existent pas", () => {
    expect(frVersIso("31/02/2026")).toBeNull();
    expect(frVersIso("32/01/2026")).toBeNull();
    expect(frVersIso("00/11/2026")).toBeNull();
    expect(frVersIso("1/1/2026")).toBeNull();
    expect(frVersIso("")).toBeNull();
  });

  it("aller-retour stable", () => {
    expect(isoVersFr(frVersIso("29/02/2024")!)).toBe("29/02/2024"); // année bissextile
    expect(frVersIso("29/02/2023")).toBeNull(); // non bissextile
  });
});
