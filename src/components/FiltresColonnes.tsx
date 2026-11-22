import { useEffect, useRef, useState, type ReactNode } from "react";
import { raccourcisDates, type Filtres, type Sens } from "../lib/filtresOperations";
import type { GroupesPostes } from "./Classement";
import { ChampDate } from "./ChampDate";

/** Titre de colonne avec une petite flèche qui ouvre un menu de filtre (comme Excel). */
export function EnTeteFiltre({ titre, actif, className = "", aDroite = false, children }: {
  titre: string;
  actif: boolean;
  className?: string;
  aDroite?: boolean;
  children: (fermer: () => void) => ReactNode;
}) {
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    if (!ouvert) return;
    const clic = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOuvert(false);
    };
    const echap = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    document.addEventListener("mousedown", clic);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", clic);
      document.removeEventListener("keydown", echap);
    };
  }, [ouvert]);

  return (
    <th ref={ref} className={`th-filtre ${className}`}>
      <button type="button" className={`bouton-filtre ${actif ? "actif" : ""}`} aria-expanded={ouvert}
        title={actif ? `${titre} : filtre actif` : `Filtrer ${titre.toLowerCase()}`} onClick={() => setOuvert(!ouvert)}>
        {titre} <span aria-hidden="true">{actif ? "▼" : "▾"}</span>
      </button>
      {ouvert && <div className={`menu-filtre ${aDroite ? "a-droite" : ""}`}>{children(() => setOuvert(false))}</div>}
    </th>
  );
}

type Props = { filtres: Filtres; onChange: (f: Partial<Filtres>) => void; fermer: () => void };

function Boutons({ onOk, onEffacer }: { onOk: () => void; onEffacer: () => void }) {
  return (
    <div className="menu-boutons">
      <button type="button" className="lien petit" onClick={onEffacer}>Effacer ce filtre</button>
      <button type="button" className="principal" onClick={onOk}>OK</button>
    </div>
  );
}

export function FiltreDate({ filtres, onChange, fermer }: Props) {
  const [du, setDu] = useState(filtres.du);
  const [au, setAu] = useState(filtres.au);
  return (
    <div className="menu-contenu">
      <div className="raccourcis">
        {raccourcisDates().map(([nom, d, a]) => (
          <button type="button" key={nom} onClick={() => { onChange({ du: d, au: a }); fermer(); }}>{nom}</button>
        ))}
      </div>
      <label>Du<ChampDate value={du} onChange={setDu} /></label>
      <label>Au<ChampDate value={au} onChange={setAu} /></label>
      <Boutons onOk={() => { onChange({ du, au }); fermer(); }} onEffacer={() => { onChange({ du: "", au: "" }); fermer(); }} />
    </div>
  );
}

export function FiltreTexte({ filtres, onChange, fermer }: Props) {
  const [texte, setTexte] = useState(filtres.texte);
  const ok = () => { onChange({ texte }); fermer(); };
  return (
    <div className="menu-contenu">
      <label>
        Contient (libellé ou note)
        <input type="search" autoFocus value={texte} placeholder="Ex. Delhaize"
          onChange={(e) => setTexte(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok()} />
      </label>
      <Boutons onOk={ok} onEffacer={() => { onChange({ texte: "" }); fermer(); }} />
    </div>
  );
}

type Element = { id: number; nom: string };

/** Liste de cases à cocher par groupes, avec recherche et « tout cocher ». */
function ListeCases({ groupes, coches, onCoches, extra }: {
  groupes: [string, Element[]][];
  coches: Set<number>;
  onCoches: (s: Set<number>) => void;
  extra?: ReactNode;
}) {
  const [cherche, setCherche] = useState("");
  const t = cherche.trim().toLowerCase();
  const visibles = groupes
    .map(([g, els]) => [g, els.filter((e) => !t || e.nom.toLowerCase().includes(t) || g.toLowerCase().includes(t))] as [string, Element[]])
    .filter(([, els]) => els.length > 0);
  const tous = visibles.flatMap(([, els]) => els.map((e) => e.id));
  const basculer = (id: number) => {
    const s = new Set(coches);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    onCoches(s);
  };
  return (
    <>
      <input type="search" placeholder="Rechercher…" value={cherche} onChange={(e) => setCherche(e.target.value)} />
      <div className="tout-cocher">
        <button type="button" className="lien petit" onClick={() => onCoches(new Set([...coches].filter((id) => !tous.includes(id))))}>Tout décocher</button>
      </div>
      <div className="liste-cases">
        {extra}
        {visibles.map(([g, els]) => (
          <div key={g}>
            <div className="groupe-cases">{g}</div>
            {els.map((e) => (
              <label key={e.id} className="case">
                <input type="checkbox" checked={coches.has(e.id)} onChange={() => basculer(e.id)} />
                {e.nom}
              </label>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

export function FiltreComptes({ filtres, onChange, fermer, comptes }: Props & {
  comptes: { id: number; banque: string; nom: string; ouvert: boolean }[];
}) {
  const tous = comptes.map((c) => c.id);
  const [coches, setCoches] = useState(new Set(filtres.comptes ?? []));
  const el = (c: (typeof comptes)[number]) => ({ id: c.id, nom: `${c.banque} — ${c.nom}` });
  const groupes: [string, Element[]][] = [
    ["Comptes ouverts", comptes.filter((c) => c.ouvert).map(el)],
    ["Comptes fermés", comptes.filter((c) => !c.ouvert).map(el)],
  ];
  const ok = () => {
    onChange({ comptes: coches.size === tous.length ? null : [...coches] });
    fermer();
  };
  return (
    <div className="menu-contenu">
      <ListeCases groupes={groupes} coches={coches} onCoches={setCoches} />
      <Boutons onOk={ok} onEffacer={() => { onChange({ comptes: null }); fermer(); }} />
    </div>
  );
}

export function FiltrePostes({ filtres, onChange, fermer, groupes }: Props & { groupes: GroupesPostes }) {
  const tous = groupes.flatMap(([, ps]) => ps.map((p) => p.id));
  const [coches, setCoches] = useState(new Set(filtres.postes ?? []));
  const [aClasser, setAClasser] = useState(filtres.postes === null ? false : filtres.aClasser);
  const ok = () => {
    const toutCoche = coches.size === tous.length && aClasser;
    onChange(toutCoche ? { postes: null, aClasser: true } : { postes: [...coches], aClasser });
    fermer();
  };
  return (
    <div className="menu-contenu">
      <button type="button" className="raccourci-seul"
        onClick={() => { onChange({ postes: [], aClasser: true }); fermer(); }}>
        Seulement les opérations à classer
      </button>
      <ListeCases
        groupes={groupes.map(([cat, ps]) => [cat, ps.map((p) => ({ id: p.id, nom: p.nom }))])}
        coches={coches}
        onCoches={setCoches}
        extra={
          <label className="case a-classer">
            <input type="checkbox" checked={aClasser} onChange={(e) => setAClasser(e.target.checked)} />
            <em>à classer</em>
          </label>
        }
      />
      <Boutons onOk={ok} onEffacer={() => { onChange({ postes: null, aClasser: true }); fermer(); }} />
    </div>
  );
}

export function FiltreMontant({ filtres, onChange, fermer }: Props) {
  const [sens, setSens] = useState<Sens>(filtres.sens);
  const [min, setMin] = useState(filtres.montantMin);
  const [max, setMax] = useState(filtres.montantMax);
  const ok = () => { onChange({ sens, montantMin: min, montantMax: max }); fermer(); };
  return (
    <div className="menu-contenu">
      <div className="choix-sens">
        {([["tous", "Tout"], ["depenses", "Dépenses"], ["entrees", "Entrées"]] as [Sens, string][]).map(([v, nom]) => (
          <label key={v} className="case">
            <input type="radio" name="sens" checked={sens === v} onChange={() => setSens(v)} />
            {nom}
          </label>
        ))}
      </div>
      <label>Entre (€)<input inputMode="decimal" placeholder="ex. 50" value={min} onChange={(e) => setMin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok()} /></label>
      <label>Et (€)<input inputMode="decimal" placeholder="ex. 100" value={max} onChange={(e) => setMax(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok()} /></label>
      <p className="sous">Montants sans signe : « Dépenses entre 50 et 100 » trouve les sorties de 50 à 100 €.</p>
      <Boutons onOk={ok} onEffacer={() => { onChange({ sens: "tous", montantMin: "", montantMax: "" }); fermer(); }} />
    </div>
  );
}
