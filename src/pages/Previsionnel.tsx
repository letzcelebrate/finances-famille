import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { formatDate, formatMontant } from "../lib/format";
import { lireSaisie, usePostes } from "../components/Classement";
import { organiserBilan, NOM_NEUTRES, type BlocCategorie, type LigneBilanBrute, type Montants } from "../lib/bilan";
import {
  aRevoir, cleMois, prevoirPoste, reference, suggererObjectif, TOUS_LES_MOIS,
  type Historique, type Mode, type Objectif,
} from "../lib/previsionnel";

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MOIS_LONGS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const nombre = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const K = ["m01", "m02", "m03", "m04", "m05", "m06", "m07", "m08", "m09", "m10", "m11", "m12"] as const;
const iso = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}-01`;

type LigneHisto = { poste_id: number; mois: string[]; nb: number[]; total: (number | string)[] };

function versHistorique(lignes: LigneHisto[]): Map<number, Historique> {
  const res = new Map<number, Historique>();
  for (const l of lignes) {
    const h: Historique = new Map();
    l.mois.forEach((m, i) => h.set(m.slice(0, 7), { nb: l.nb[i], total: Number(l.total[i]) }));
    res.set(Number(l.poste_id), h);
  }
  return res;
}

function Cellule({ valeur, classe = "" }: { valeur: number; classe?: string }) {
  if (valeur === 0) return <td className={`droite nowrap vide ${classe}`}>–</td>;
  return <td className={`droite nowrap ${valeur < 0 ? "negatif" : ""} ${classe}`}>{nombre.format(valeur)}</td>;
}

export default function Previsionnel() {
  const annee = new Date().getFullYear();
  const { postes } = usePostes();
  const [donnees, setDonnees] = useState<{
    bilan: LigneBilanBrute[];
    annee: Map<number, Historique>;
    passe: Map<number, Historique>;
    objectifs: Objectif[];
    derniere: string | null;
  } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const [edition, setEdition] = useState<number | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      const { data: derniere, error: e1 } = await supabase.rpc("derniere_date_import");
      if (e1) return !annule && setErreur(e1.message);
      const ref = reference(annee, (derniere as string | null) ?? null);
      // 24 mois terminés avant le mois de référence, pour les suggestions
      const debutPasse = new Date(annee, ref.mois - 1 - 24, 1);
      const [b, ha, hp, ob] = await Promise.all([
        supabase.rpc("bilan_par_mois", { p_annee: annee }),
        supabase.rpc("historique_postes", { p_debut: iso(annee, 1), p_fin: iso(annee + 1, 1) }),
        supabase.rpc("historique_postes", {
          p_debut: iso(debutPasse.getFullYear(), debutPasse.getMonth() + 1),
          p_fin: ref.mois > 12 ? iso(annee + 1, 1) : iso(annee, ref.mois),
        }),
        supabase.from("objectifs").select("poste_id, mode, montant, nb_operations, mois"),
      ]);
      if (annule) return;
      const err = b.error ?? ha.error ?? hp.error ?? ob.error;
      if (err) return setErreur(err.message);
      setErreur(null);
      setDonnees({
        bilan: (b.data ?? []) as LigneBilanBrute[],
        annee: versHistorique((ha.data ?? []) as LigneHisto[]),
        passe: versHistorique((hp.data ?? []) as LigneHisto[]),
        objectifs: ((ob.data ?? []) as any[]).map((o) => ({
          poste_id: Number(o.poste_id), mode: o.mode, montant: Number(o.montant),
          nb_operations: o.nb_operations, mois: (o.mois as number[]).map(Number),
        })),
        derniere: (derniere as string | null) ?? null,
      });
    })();
    return () => {
      annule = true;
    };
  }, [annee, version]);

  const calcul = useMemo(() => {
    if (!donnees || postes.length === 0) return null;
    const ref = reference(annee, donnees.derniere);
    const objectifs = new Map(donnees.objectifs.map((o) => [o.poste_id, o]));
    const reelParPoste = new Map<number | null, LigneBilanBrute>();
    for (const l of donnees.bilan) reelParPoste.set(l.poste_id === null ? null : Number(l.poste_id), l);

    const lignesPrev: LigneBilanBrute[] = [];
    const lignesObj: LigneBilanBrute[] = [];
    const suggestions = new Map<number, Objectif | null>();
    const ids = new Map<string, number>(); // nom du poste -> id

    const tries = [...postes].sort((a, b) => a.rang - b.rang || a.ordre - b.ordre);
    for (const p of tries) {
      const brut = reelParPoste.get(p.id);
      const o = objectifs.get(p.id) ?? null;
      const suggestion = p.categorie === NOM_NEUTRES ? null : suggererObjectif(p.id, donnees.passe.get(p.id) ?? new Map(), annee, Math.min(ref.mois, 12));
      if (!brut && !o) continue;
      suggestions.set(p.id, suggestion);
      ids.set(p.nom, p.id);
      const reel = K.map((k) => (brut ? Number(brut[k]) : 0));
      const h = donnees.annee.get(p.id);
      const nb = TOUS_LES_MOIS.map((m) => h?.get(cleMois(annee, m).slice(0, 7))?.nb ?? 0);
      const { prevision, objectif } = prevoirPoste(o, reel, nb, ref);
      const base = { categorie_id: null, categorie: p.categorie, categorie_rang: p.rang, poste_id: p.id, poste: p.nom, poste_ordre: p.ordre };
      const somme = (v: number[]) => Math.round(v.reduce((t, x) => t + x * 100, 0)) / 100;
      lignesPrev.push({ ...base, ...Object.fromEntries(K.map((k, i) => [k, prevision[i]])), total: somme(prevision) } as LigneBilanBrute);
      lignesObj.push({ ...base, ...Object.fromEntries(K.map((k, i) => [k, objectif[i]])), total: somme(objectif) } as LigneBilanBrute);
    }
    // Opérations sans poste : réel seulement
    const sansPoste = reelParPoste.get(null);
    if (sansPoste) {
      lignesPrev.push(sansPoste);
      lignesObj.push({ ...sansPoste, ...Object.fromEntries(K.map((k) => [k, 0])), total: 0 } as LigneBilanBrute);
    }
    return { ref, prev: organiserBilan(lignesPrev), obj: organiserBilan(lignesObj), objectifs, suggestions, ids };
  }, [donnees, postes, annee]);

  async function enregistrer(o: Objectif) {
    setEnvoi(true);
    const { error } = await supabase.from("objectifs").upsert(o);
    setEnvoi(false);
    if (error) return setErreur(error.message);
    setEdition(null);
    setVersion((v) => v + 1);
  }

  async function supprimer(posteId: number) {
    setEnvoi(true);
    const { error } = await supabase.from("objectifs").delete().eq("poste_id", posteId);
    setEnvoi(false);
    if (error) return setErreur(error.message);
    setEdition(null);
    setVersion((v) => v + 1);
  }

  async function preRemplir() {
    if (!calcul) return;
    const aCreer = [...calcul.suggestions.values()].filter((s): s is Objectif => s !== null);
    setEnvoi(true);
    const { error } = await supabase.from("objectifs").upsert(aCreer);
    setEnvoi(false);
    if (error) return setErreur(error.message);
    setVersion((v) => v + 1);
  }

  if (erreur) return <p className="alerte">Erreur : {erreur}</p>;
  if (!donnees || !calcul) return <p>Chargement…</p>;

  const { ref, prev, obj, objectifs, suggestions, ids } = calcul;
  const classeMois = (i: number) => (i + 1 < ref.mois ? "" : i + 1 === ref.mois ? "en-cours" : "a-venir");
  const toutes = [...prev.categories, ...(prev.neutres ? [prev.neutres] : [])].map((c) => c.nom);
  const toutOuvert = toutes.length > 0 && toutes.every((n) => ouvertes.has(n));
  const basculer = (nom: string) =>
    setOuvertes((o) => {
      const s = new Set(o);
      if (s.has(nom)) s.delete(nom);
      else s.add(nom);
      return s;
    });
  const nbARevoir = [...objectifs.values()].filter((o) => aRevoir(o, suggestions.get(o.poste_id) ?? null)).length;

  const ligne = ({ nom, p, o, classe, avant, apres }: { nom: string; p: Montants; o: Montants; classe?: string; avant?: ReactNode; apres?: ReactNode }) => (
      <tr className={classe}>
        <th scope="row" className="col-poste">{avant}{nom}{apres}</th>
        {p.mois.map((v, i) => <Cellule key={i} valeur={v} classe={classeMois(i)} />)}
        <Cellule valeur={p.total} classe="col-prev" />
        <Cellule valeur={o.total} />
        <Cellule valeur={Math.round((p.total - o.total) * 100) / 100} />
      </tr>
    );

  const categorie = (bp: BlocCategorie, bo: BlocCategorie) => {
    const ouverte = ouvertes.has(bp.nom);
    const revoir = bp.postes.some((p) => {
      const id = ids.get(p.nom);
      const o = id !== undefined ? objectifs.get(id) : undefined;
      return o ? aRevoir(o, suggestions.get(o.poste_id) ?? null) : false;
    });
    return (
      <tbody key={bp.nom}>
        {ligne({ nom: bp.nom, p: bp.sousTotal, o: bo.sousTotal, classe: `categorie ${ouverte ? "ouverte" : ""}`,
          avant: (
            <button type="button" className="plus-moins" aria-expanded={ouverte} onClick={() => basculer(bp.nom)}
              title={ouverte ? `Masquer le détail de ${bp.nom}` : `Voir le détail de ${bp.nom}`}>
              {ouverte ? "−" : "+"}
            </button>
          ),
          apres: revoir && !ouverte ? <span className="pastille" title="Un objectif de cette catégorie est à revoir">à revoir</span> : null,
        })}
        {ouverte &&
          bp.postes.map((pp, i) => {
            const id = ids.get(pp.nom);
            const o = id !== undefined ? objectifs.get(id) ?? null : null;
            const s = id !== undefined ? suggestions.get(id) ?? null : null;
            const revoirPoste = o ? aRevoir(o, s) : false;
            return (
              <Fragment key={pp.nom}>
                {ligne({ nom: pp.nom, p: pp.montants, o: bo.postes[i].montants,
                  classe: `poste ${edition === id ? "ouverte" : ""}`,
                  apres: (
                    <>
                      {id !== undefined && !o && s && <span className="pastille neutre">sans objectif</span>}
                      {revoirPoste && <span className="pastille">à revoir</span>}
                      {id !== undefined && (
                        <button type="button" className="lien petit modifier" onClick={() => setEdition(edition === id ? null : id)}>
                          {edition === id ? "fermer" : "objectif"}
                        </button>
                      )}
                    </>
                  ),
                })}
                {id !== undefined && edition === id && (
                  <tr className="edition">
                    <td colSpan={16}>
                      <EditeurObjectif posteId={id} nom={pp.nom} objectif={o} suggestion={s} envoi={envoi}
                        onEnregistrer={enregistrer} onSupprimer={() => supprimer(id)} onFermer={() => setEdition(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
      </tbody>
    );
  };

  const enCours = ref.mois >= 1 && ref.mois <= 12;

  return (
    <section>
      <div className="carte barre-bilan">
        <strong>Prévisionnel {annee}</strong>
        <label className="case">
          <input type="checkbox" checked={toutOuvert} onChange={(e) => setOuvertes(new Set(e.target.checked ? toutes : []))} />
          Afficher le détail des postes
        </label>
        <span className="sous">
          {enCours ? (
            <>
              Réel jusqu'à {ref.mois > 1 ? MOIS_LONGS[ref.mois - 2] : "—"} ·{" "}
              <span className="legende-en-cours">{MOIS_LONGS[ref.mois - 1]} : prévision</span> (données jusqu'au{" "}
              {formatDate(donnees.derniere)}) · <span className="legende-a-venir">mois suivants : objectifs</span>
            </>
          ) : (
            "Année terminée : tout est réel"
          )}
        </span>
      </div>

      {objectifs.size === 0 && (
        <div className="carte">
          <p>
            Aucun objectif enregistré. Je peux les pré-remplir à partir de vos deux dernières années (nombre d'opérations
            par mois, montant habituel, mois concernés). Vous pourrez ensuite corriger chaque poste.
          </p>
          <button className="principal" disabled={envoi} onClick={preRemplir}>Pré-remplir les objectifs</button>
        </div>
      )}
      {nbARevoir > 0 && (
        <p className="sous">
          <span className="pastille">à revoir</span> {nbARevoir} objectif{nbARevoir > 1 ? "s" : ""} ne correspond
          {nbARevoir > 1 ? "ent" : ""} plus aux 12 derniers mois : ouvrez la catégorie puis « objectif » pour voir la suggestion.
        </p>
      )}

      <div className="carte tableau-bilan tableau-prev">
        <table>
          <thead>
            <tr>
              <th className="col-poste">Poste</th>
              {MOIS_COURTS.map((m, i) => <th key={m} className={`droite ${classeMois(i)}`}>{m}</th>)}
              <th className="droite col-prev">Prévision année</th>
              <th className="droite">Objectif année</th>
              <th className="droite">Écart</th>
            </tr>
          </thead>
          {prev.categories.map((c, i) => categorie(c, obj.categories[i]))}
          <tbody>
            {ligne({ nom: "Résultat prévu (ressources − dépenses)", p: prev.resultat, o: obj.resultat, classe: "resultat" })}
          </tbody>
          {prev.neutres && obj.neutres && (
            <>
              <tbody>
                <tr className="titre-categorie">
                  <th scope="rowgroup" colSpan={16} className="col-poste">Neutres (virements entre comptes, hors résultat)</th>
                </tr>
              </tbody>
              {categorie(prev.neutres, obj.neutres)}
            </>
          )}
        </table>
      </div>
      <p className="sous">
        Écart = prévision − objectif. Régulier : on ajoute les opérations encore attendues ce mois-ci. Variable : on
        ajoute l'objectif au prorata des jours restants.
      </p>
    </section>
  );
}

function decrire(o: Objectif): string {
  const sens = o.montant < 0 ? "dépense" : "entrée";
  const mois = o.mois.length === 12 ? "chaque mois" : `en ${o.mois.map((m) => MOIS_LONGS[m - 1]).join(", ")}`;
  return o.mode === "regulier"
    ? `Régulier : ${o.nb_operations} × ${formatMontant(Math.abs(o.montant))} (${sens}) ${mois}`
    : `Variable : ${formatMontant(Math.abs(o.montant))} (${sens}) ${mois}`;
}

function EditeurObjectif({ posteId, nom, objectif, suggestion, envoi, onEnregistrer, onSupprimer, onFermer }: {
  posteId: number;
  nom: string;
  objectif: Objectif | null;
  suggestion: Objectif | null;
  envoi: boolean;
  onEnregistrer: (o: Objectif) => void;
  onSupprimer: () => void;
  onFermer: () => void;
}) {
  const depart = objectif ?? suggestion;
  const [mode, setMode] = useState<Mode>(depart?.mode ?? "variable");
  const [sens, setSens] = useState<"depense" | "entree">(depart && depart.montant > 0 ? "entree" : "depense");
  const [montant, setMontant] = useState(depart ? Math.abs(depart.montant).toFixed(2).replace(".", ",") : "");
  const [nb, setNb] = useState(depart?.nb_operations ?? 1);
  const [mois, setMois] = useState<Set<number>>(new Set(depart?.mois ?? TOUS_LES_MOIS));

  const valeur = lireSaisie(montant);
  const valide = valeur !== null && valeur > 0 && mois.size > 0 && nb >= 1 && nb <= 31;
  const objetSaisi = (): Objectif => ({
    poste_id: posteId, mode, montant: (sens === "depense" ? -1 : 1) * Math.abs(valeur ?? 0),
    nb_operations: mode === "regulier" ? nb : 1, mois: [...mois].sort((a, b) => a - b),
  });
  const basculerMois = (m: number) => {
    const s = new Set(mois);
    if (s.has(m)) s.delete(m);
    else s.add(m);
    setMois(s);
  };

  return (
    <div className="editeur" onClick={(e) => e.stopPropagation()}>
      <strong>Objectif : {nom}</strong>
      {suggestion ? (
        <p className="sous">
          D'après les 12 derniers mois : {decrire(suggestion)}.{" "}
          {objectif && aRevoir(objectif, suggestion) && (
            <button className="lien petit" disabled={envoi} onClick={() => onEnregistrer(suggestion)}>Utiliser cette suggestion</button>
          )}
        </p>
      ) : (
        <p className="sous">Pas assez d'historique pour proposer un objectif.</p>
      )}
      <div className="choix-sens">
        <label className="case"><input type="radio" checked={mode === "variable"} onChange={() => setMode("variable")} /> Variable (au prorata des jours)</label>
        <label className="case"><input type="radio" checked={mode === "regulier"} onChange={() => setMode("regulier")} /> Régulier (nombre d'opérations fixe)</label>
      </div>
      <div className="ligne-poste">
        <select value={sens} onChange={(e) => setSens(e.target.value as "depense" | "entree")}>
          <option value="depense">Dépense</option>
          <option value="entree">Entrée</option>
        </select>
        {mode === "regulier" && (
          <label className="en-ligne">
            <input type="number" min={1} max={31} value={nb} onChange={(e) => setNb(Number(e.target.value))} style={{ width: 70 }} />
            opération{nb > 1 ? "s" : ""} de
          </label>
        )}
        <input inputMode="decimal" className="montant" value={montant} onChange={(e) => setMontant(e.target.value)} style={{ width: 120 }} />
        <span>€ {mode === "regulier" ? "chacune" : "par mois"}</span>
      </div>
      <div>
        <div className="sous">Mois concernés :</div>
        <div className="choix-mois">
          {MOIS_COURTS.map((m, i) => (
            <label key={m} className="case"><input type="checkbox" checked={mois.has(i + 1)} onChange={() => basculerMois(i + 1)} />{m}</label>
          ))}
          <button type="button" className="lien petit" onClick={() => setMois(new Set(TOUS_LES_MOIS))}>tous</button>
        </div>
      </div>
      <p className="actions">
        <button className="principal" disabled={envoi || !valide} onClick={() => onEnregistrer(objetSaisi())}>Enregistrer</button>
        {objectif && <button className="lien" disabled={envoi} onClick={onSupprimer}>Supprimer l'objectif</button>}
        <button className="lien" onClick={onFermer}>Fermer</button>
      </p>
    </div>
  );
}
