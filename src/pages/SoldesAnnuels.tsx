import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { organiserSoldes, type CompteSoldes, type Ligne, type Tableau } from "../lib/soldesAnnuels";

/** Années cachées : retenues dans ce navigateur (simple confort, sans conséquence si perdu). */
const CLE_CACHEES = "soldes-annuels:annees-cachees";
const ANNEE_DEPART_DEFAUT = 2020;
function lireCachees(): number[] | null {
  try {
    const v = localStorage.getItem(CLE_CACHEES);
    return v ? (JSON.parse(v) as number[]) : null;
  } catch {
    return null;
  }
}
function ecrireCachees(a: number[]) {
  try {
    localStorage.setItem(CLE_CACHEES, JSON.stringify(a));
  } catch {
    /* navigateur sans stockage : on ne retient pas le choix */
  }
}

/** Bouton « Années » : liste à cocher pour afficher ou cacher des années. */
function ChoixAnnees({ annees, cachees, onChange }: { annees: number[]; cachees: Set<number>; onChange: (c: Set<number>) => void }) {
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const clic = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOuvert(false);
    document.addEventListener("mousedown", clic);
    return () => document.removeEventListener("mousedown", clic);
  }, [ouvert]);
  const dernieres = (n: number) => onChange(new Set(annees.slice(0, Math.max(0, annees.length - n))));
  const basculer = (a: number) => {
    const s = new Set(cachees);
    if (s.has(a)) s.delete(a);
    else s.add(a);
    onChange(s);
  };
  const visibles = annees.length - cachees.size;
  return (
    <div className="choix-annees" ref={ref}>
      <button type="button" className={`bouton-filtre ${cachees.size > 0 ? "actif" : ""}`} onClick={() => setOuvert(!ouvert)}>
        Années ({visibles}/{annees.length}) ▾
      </button>
      {ouvert && (
        <div className="menu-filtre">
          <div className="menu-contenu">
            <div className="raccourcis">
              <button type="button" onClick={() => dernieres(5)}>5 dernières</button>
              <button type="button" onClick={() => dernieres(10)}>10 dernières</button>
              <button type="button" onClick={() => onChange(new Set())}>Toutes</button>
            </div>
            <div className="liste-cases annees">
              {[...annees].reverse().map((a) => (
                <label key={a} className="case">
                  <input type="checkbox" checked={!cachees.has(a)} onChange={() => basculer(a)} />
                  {a}
                </label>
              ))}
            </div>
            <div className="menu-boutons">
              <span className="sous">Le solde « Au jour » ne change pas.</span>
              <button type="button" className="principal" onClick={() => setOuvert(false)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const nombre = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const precis = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Cellule({ valeur, auJour = false, fond }: { valeur: number; auJour?: boolean; fond?: string }) {
  const style = fond ? { background: fond } : undefined;
  if (valeur === 0) return <td className={`droite nowrap vide ${auJour ? "col-au-jour" : ""}`} style={style}>–</td>;
  return (
    <td className={`droite nowrap ${valeur < 0 ? "negatif" : ""} ${auJour ? "col-au-jour" : ""}`} style={style}>
      {(auJour ? precis : nombre).format(valeur)}
    </td>
  );
}

/** Couleur de fond de la ligne Solde : vert si positif, rouge si négatif, plus foncé quand c'est plus fort. */
function fondSolde(v: number, max: number): string | undefined {
  if (v === 0 || max === 0) return undefined;
  const force = Math.round(12 + 38 * Math.min(1, Math.abs(v) / max));
  return `color-mix(in srgb, ${v > 0 ? "var(--positif)" : "var(--negatif)"} ${force}%, transparent)`;
}

export default function SoldesAnnuels() {
  const [tableau, setTableau] = useState<Tableau | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const [cachees, setCachees] = useState<Set<number> | null>(null);
  const defilement = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.rpc("soldes_annuels").then(({ data, error }) => {
      if (error) setErreur(error.message);
      else {
        const t = organiserSoldes((data ?? []) as CompteSoldes[]);
        setTableau(t);
        // par défaut : 2020 à aujourd'hui, comme dans l'Excel
        setCachees(new Set(lireCachees() ?? t.annees.filter((a) => a < ANNEE_DEPART_DEFAUT)));
      }
    });
  }, []);

  // Les années récentes sont à droite : on y amène le tableau au départ
  useEffect(() => {
    if (tableau && defilement.current) defilement.current.scrollLeft = defilement.current.scrollWidth;
  }, [tableau, cachees]);

  if (erreur) return <p className="alerte">Erreur : {erreur}</p>;
  if (!tableau || !cachees) return <p>Chargement…</p>;

  const { annees, groupes, total } = tableau;
  const changerCachees = (c: Set<number>) => {
    setCachees(c);
    ecrireCachees([...c]);
  };
  const montrer = annees.map((a) => !cachees.has(a));
  const anneeEnCours = new Date().getFullYear();
  const max = Math.max(0, ...total.variations.map(Math.abs));
  const basculer = (t: string) =>
    setOuvertes((o) => {
      const s = new Set(o);
      if (s.has(t)) s.delete(t);
      else s.add(t);
      return s;
    });

  const ligne = (l: Ligne, classe: string, avant?: ReactNode, fonds?: (string | undefined)[]) => (
    <tr className={classe}>
      <th scope="row" className="col-poste">{avant}{l.libelle}</th>
      <Cellule valeur={l.auJour} auJour />
      {l.variations.map((v, i) => (montrer[i] ? <Cellule key={annees[i]} valeur={v} fond={fonds?.[i]} /> : null))}
    </tr>
  );

  return (
    <section>
      <div className="carte barre-bilan">
        <strong>Soldes annuels</strong>
        <ChoixAnnees annees={annees} cachees={cachees} onChange={changerCachees} />
        <label className="case">
          <input type="checkbox" checked={groupes.every((g) => ouvertes.has(g.libelle))}
            onChange={(e) => setOuvertes(new Set(e.target.checked ? groupes.map((g) => g.libelle) : []))} />
          Afficher le détail par compte
        </label>
        <span className="sous">
          « Au jour » : solde actuel · années : ce que chaque type de compte a gagné (+) ou perdu (−) dans l'année
          {annees.includes(anneeEnCours) ? ` · ${anneeEnCours} : jusqu'à aujourd'hui` : ""}
        </span>
      </div>

      <div className="carte tableau-bilan tableau-soldes" ref={defilement}>
        <table>
          <thead>
            <tr>
              <th className="col-poste">Type de compte</th>
              <th className="droite col-au-jour">Au jour</th>
              {annees.map((a, i) => (montrer[i] ? <th key={a} className="droite">{a}</th> : null))}
            </tr>
          </thead>
          <tbody>
            {groupes.map((g) => {
              const ouverte = ouvertes.has(g.libelle);
              return (
                <Fragment key={g.libelle}>
                  {ligne(g, `categorie ${ouverte ? "ouverte" : ""}`,
                    <button type="button" className="plus-moins" aria-expanded={ouverte} onClick={() => basculer(g.libelle)}
                      title={ouverte ? `Masquer le détail de ${g.libelle}` : `Voir le détail de ${g.libelle}`}>
                      {ouverte ? "−" : "+"}
                    </button>)}
                  {ouverte && g.comptes.map((c) => <Fragment key={c.libelle}>{ligne(c, "poste")}</Fragment>)}
                </Fragment>
              );
            })}
          </tbody>
          <tbody>
            {ligne(total, "resultat", undefined, total.variations.map((v) => fondSolde(v, max)))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
