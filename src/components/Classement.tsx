import { useEffect, useMemo, useState } from "react";
import { chargerPostes, type Poste } from "../lib/import/donnees";
import { formatMontant } from "../lib/format";

export type GroupesPostes = [string, Poste[]][];

/** Postes regroupés par catégorie, dans l'ordre des paramètres. */
export function usePostes() {
  const [postes, setPostes] = useState<Poste[]>([]);
  useEffect(() => {
    chargerPostes().then(setPostes).catch(() => setPostes([]));
  }, []);
  const groupes = useMemo<GroupesPostes>(() => {
    const g = new Map<string, Poste[]>();
    for (const p of [...postes].sort((a, b) => a.rang - b.rang || a.ordre - b.ordre)) {
      g.set(p.categorie, [...(g.get(p.categorie) ?? []), p]);
    }
    return [...g.entries()];
  }, [postes]);
  return { postes, groupes };
}

export function SelectPoste({ valeur, groupes, onChange, manquant = false }: {
  valeur: number | null;
  groupes: GroupesPostes;
  onChange: (id: number | null) => void;
  manquant?: boolean;
}) {
  return (
    <select className={manquant ? "manquant" : ""} value={valeur ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
      <option value="">— à classer —</option>
      {groupes.map(([cat, ps]) => (
        <optgroup key={cat} label={cat}>
          {ps.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** Une part d'une opération divisée. Le montant est saisi en positif (valeur absolue). */
export type Part = { poste_id: number | null; montant: string; note: string };

/** Lit un montant saisi à la française (« 19,06 »). */
export function lireSaisie(texte: string): number | null {
  const t = texte.replace(/\s/g, "").replace(",", ".");
  if (t === "" || !/^-?\d+(\.\d{0,2})?$/.test(t)) return null;
  return Number(t);
}

/**
 * Convertit les parts saisies en ventilations signées (même signe que l'opération).
 * Renvoie null si la division est incomplète ou ne tombe pas juste.
 */
export function partsValides(parts: Part[], montantOperation: number) {
  if (parts.length < 2) return null;
  const signe = montantOperation < 0 ? -1 : 1;
  const lignes = parts.map((p) => ({ poste_id: p.poste_id, montant: lireSaisie(p.montant), note: p.note.trim() }));
  if (lignes.some((l) => l.poste_id === null || l.montant === null || l.montant === 0)) return null;
  const centimes = lignes.reduce((s, l) => s + Math.round(Math.abs(l.montant!) * 100), 0);
  if (centimes !== Math.round(Math.abs(montantOperation) * 100)) return null;
  return lignes.map((l) => ({ poste_id: l.poste_id!, montant: (signe * Math.round(Math.abs(l.montant!) * 100)) / 100, note: l.note }));
}

export function resteARepartir(parts: Part[], montantOperation: number): number {
  const centimes = parts.reduce((s, p) => s + Math.round(Math.abs(lireSaisie(p.montant) ?? 0) * 100), 0);
  return (Math.round(Math.abs(montantOperation) * 100) - centimes) / 100;
}

/** Éditeur de division : plusieurs postes, chacun avec son montant et une note. */
export function EditeurDivision({ parts, montant, groupes, onChange }: {
  parts: Part[];
  montant: number;
  groupes: GroupesPostes;
  onChange: (parts: Part[]) => void;
}) {
  const reste = resteARepartir(parts, montant);
  const maj = (i: number, p: Partial<Part>) => onChange(parts.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="division">
      {parts.map((p, i) => (
        <div key={i} className="part">
          <SelectPoste valeur={p.poste_id} groupes={groupes} manquant={p.poste_id === null} onChange={(id) => maj(i, { poste_id: id })} />
          <input className={`montant ${lireSaisie(p.montant) === null ? "manquant" : ""}`} inputMode="decimal" placeholder="0,00"
            value={p.montant} onChange={(e) => maj(i, { montant: e.target.value })} />
          <input placeholder="Note (facultatif)" value={p.note} onChange={(e) => maj(i, { note: e.target.value })} />
          {parts.length > 2 && (
            <button className="lien petit" onClick={() => onChange(parts.filter((_, j) => j !== i))}>retirer</button>
          )}
        </div>
      ))}
      <div className="part-pied">
        <button className="lien petit" onClick={() => onChange([...parts, { poste_id: null, montant: reste > 0 ? reste.toFixed(2).replace(".", ",") : "", note: "" }])}>
          + ajouter un poste
        </button>
        {reste === 0
          ? <span className="positif">Total juste ✓</span>
          : <span className="negatif">Reste à répartir : {formatMontant(reste)}</span>}
      </div>
    </div>
  );
}

/** Deux parts de départ : la première reprend le poste choisi. */
export function partsInitiales(posteId: number | null, montant: number): Part[] {
  return [
    { poste_id: posteId, montant: Math.abs(montant).toFixed(2).replace(".", ","), note: "" },
    { poste_id: null, montant: "", note: "" },
  ];
}
