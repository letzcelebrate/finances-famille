const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

export function formatMontant(valeur: number | string, devise = "EUR"): string {
  const n = typeof valeur === "string" ? Number(valeur) : valeur;
  if (devise === "EUR") return euros.format(n);
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: devise }).format(n);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, j] = iso.split("-");
  return `${j}/${m}/${a}`;
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre"];

/** "2025-09" -> "septembre 2025" */
export function formatMois(aaaaMm: string): string {
  const [a, m] = aaaaMm.split("-");
  return `${MOIS[Number(m) - 1]} ${a}`;
}
