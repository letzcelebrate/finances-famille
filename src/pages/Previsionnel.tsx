import { Fragment, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { formatDate, formatMontant } from "../lib/format";
import { lireSaisie, usePostes } from "../components/Classement";
import { useEstMobile } from "../lib/mobile";
import { organiserBilan, NOM_NEUTRES, type BlocCategorie, type LigneBilanBrute, type Montants } from "../lib/bilan";
import {
  aRevoir, cleMois, decaler, ilYaNAns, periode, prevoirPoste, reference, statut, suggererObjectif, TOUS_LES_MOIS,
  type Historique, type Mode, type MoisAbs, type Objectif, type Reference, type Vue,
} from "../lib/previsionnel";

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MOIS_LONGS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const nombre = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const K = ["m01", "m02", "m03", "m04", "m05", "m06", "m07", "m08", "m09", "m10", "m11", "m12"] as const;
const iso = (m: MoisAbs) => `${m.annee}-${String(m.mois).padStart(2, "0")}-01`;
const rang = (m: MoisAbs) => m.annee * 12 + m.mois;
const nomLong = (m: MoisAbs) => `${MOIS_LONGS[m.mois - 1]} ${m.annee}`;
const plage = (a: MoisAbs, b: MoisAbs) => (rang(a) === rang(b) ? nomLong(a) : `${nomLong(a)} → ${nomLong(b)}`);
const majuscule = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const somme = (v: number[]) => Math.round(v.reduce((t, x) => t + Math.round(x * 100), 0)) / 100;
const arr = (n: number) => Math.round(n * 100) / 100;
const moyenne = (total: number) => Math.round((total / 12) * 100) / 100;
// Années de comparaison proposées : 1, 2 ou 3 ans avant la période affichée.
const DECALAGES = [1, 2, 3];
// Comparaison fixée automatiquement à l'année précédente (N-1).
const COMPARAISON_AUTO = new Set([1]);

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

/** Écart de comparaison : vert si on fait mieux (positif), rouge sinon. */
function CelluleEcart({ valeur, classe = "" }: { valeur: number; classe?: string }) {
  if (valeur === 0) return <td className={`droite nowrap vide ${classe}`}>–</td>;
  const signe = valeur > 0 ? "+" : "−";
  return (
    <td className={`droite nowrap ${classe}`}>
      <span className={`delta ${valeur > 0 ? "pos" : "neg"}`}>{signe}{nombre.format(Math.abs(valeur))}</span>
    </td>
  );
}

/** Cellule d'un mois ; cliquable (postes) pour ouvrir l'éditeur rapide de target. */
function CelluleMois({ valeur, classe = "", onClick }: {
  valeur: number; classe?: string; onClick?: (e: MouseEvent<HTMLTableCellElement>) => void;
}) {
  const vide = valeur === 0;
  return (
    <td className={`droite nowrap ${valeur < 0 ? "negatif" : ""} ${vide ? "vide" : ""} ${onClick ? "cliquable-mois" : ""} ${classe}`}
      onClick={onClick}>
      {vide ? "–" : nombre.format(valeur)}
    </td>
  );
}

/** Une comparaison affichée : le décalage (en années) et le bilan réel correspondant. */
type Comparaison = { decalage: number; bilan: ReturnType<typeof organiserBilan> };

export default function Previsionnel() {
  const { postes } = usePostes();
  const estMobile = useEstMobile();
  const [donnees, setDonnees] = useState<{
    ref: Reference;
    jour: Date;
    /** réel par année puis par poste (null = opérations sans poste) */
    reel: Map<number, Map<number | null, LigneBilanBrute>>;
    /** nombre d'opérations par poste et par mois, sur les mois affichables */
    nb: Map<number, Historique>;
    passe: Map<number, Historique>;
    objectifs: Objectif[];
    derniere: string | null;
  } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [vue, setVue] = useState<Vue>("glissant");
  const decalages = COMPARAISON_AUTO;
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const [edition, setEdition] = useState<number | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [infoOuverte, setInfoOuverte] = useState(false);
  const [vueMontant, setVueMontant] = useState<"mensuel" | "annuel">("mensuel");
  // « + LetzCelebrate » : intègre les opérations des comptes LetzCelebrate (désactivé à l'ouverture)
  const [avecLetzCelebrate, setAvecLetzCelebrate] = useState(false);
  const [cible, setCible] = useState<{ posteId: number; nom: string; moisLabel: string; x: number; y: number } | null>(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      const { data: derniere, error: e1 } = await supabase.rpc("derniere_date_import");
      if (e1) return !annule && setErreur(e1.message);
      const jour = new Date();
      const ref = reference((derniere as string | null) ?? null, jour);
      // Les deux vues (glissante et civile) et leurs 3 années de comparaison : tout est chargé une fois.
      const affichables = [...periode("glissant", ref, jour), ...periode("civile", ref, jour)];
      const avant = DECALAGES.flatMap((n) => ilYaNAns(affichables, n));
      const tous = [...affichables, ...avant];
      const annees = [...new Set(tous.map((m) => m.annee))].sort((a, b) => a - b);
      const premier = affichables.reduce((a, b) => (rang(b) < rang(a) ? b : a));
      const dernier = affichables.reduce((a, b) => (rang(b) > rang(a) ? b : a));
      const p_groupes = avecLetzCelebrate ? ["Famille", "LetzCelebrate"] : ["Famille"];
      const [bilans, hn, hp, ob] = await Promise.all([
        Promise.all(annees.map((a) => supabase.rpc("bilan_par_mois", { p_annee: a, p_groupes }))),
        supabase.rpc("historique_postes", { p_debut: iso(premier), p_fin: iso(decaler(dernier, 1)), p_groupes }),
        // 24 mois terminés avant le mois en cours, pour les suggestions
        supabase.rpc("historique_postes", { p_debut: iso(decaler(ref, -24)), p_fin: iso(ref), p_groupes }),
        supabase.from("objectifs").select("poste_id, mode, montant, nb_operations, mois"),
      ]);
      if (annule) return;
      const err = bilans.find((b) => b.error)?.error ?? hn.error ?? hp.error ?? ob.error;
      if (err) return setErreur(err.message);
      setErreur(null);
      const reel = new Map<number, Map<number | null, LigneBilanBrute>>();
      bilans.forEach((b, i) => {
        const parPoste = new Map<number | null, LigneBilanBrute>();
        for (const l of (b.data ?? []) as LigneBilanBrute[]) parPoste.set(l.poste_id === null ? null : Number(l.poste_id), l);
        reel.set(annees[i], parPoste);
      });
      setDonnees({
        ref,
        jour,
        reel,
        nb: versHistorique((hn.data ?? []) as LigneHisto[]),
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
  }, [version, avecLetzCelebrate]);

  const calcul = useMemo(() => {
    if (!donnees || postes.length === 0) return null;
    const { ref } = donnees;
    const per = periode(vue, ref, donnees.jour);
    const decal = [...decalages].sort((a, b) => a - b);
    const avants = decal.map((n) => ({ decalage: n, per: ilYaNAns(per, n) }));
    const objectifs = new Map(donnees.objectifs.map((o) => [o.poste_id, o]));
    const valeur = (id: number | null, m: MoisAbs) => {
      const l = donnees.reel.get(m.annee)?.get(id);
      return l ? Number(l[K[m.mois - 1]]) : 0;
    };

    const lignesPrev: LigneBilanBrute[] = [];
    const lignesObj: LigneBilanBrute[] = [];
    const lignesCmp: LigneBilanBrute[][] = avants.map(() => []);
    const suggestions = new Map<number, Objectif | null>();
    const ids = new Map<string, number>(); // nom du poste -> id
    const versLigne = (base: object, v: number[]) =>
      ({ ...base, ...Object.fromEntries(K.map((k, i) => [k, v[i]])), total: somme(v) }) as LigneBilanBrute;

    const tries = [...postes].sort((a, b) => a.rang - b.rang || a.ordre - b.ordre);
    for (const p of tries) {
      const o = objectifs.get(p.id) ?? null;
      const reel = per.map((m) => valeur(p.id, m));
      const reelsAvant = avants.map((a) => a.per.map((m) => valeur(p.id, m)));
      const vide = reel.every((v) => v === 0) && reelsAvant.every((r) => r.every((v) => v === 0));
      if (!o && vide) continue;
      const suggestion = p.categorie === NOM_NEUTRES ? null : suggererObjectif(p.id, donnees.passe.get(p.id) ?? new Map(), ref.annee, ref.mois);
      suggestions.set(p.id, suggestion);
      ids.set(p.nom, p.id);
      const h = donnees.nb.get(p.id);
      const nb = per.map((m) => h?.get(cleMois(m.annee, m.mois))?.nb ?? 0);
      const { prevision, objectif } = prevoirPoste(o, per, reel, nb, ref);
      const base = { categorie_id: null, categorie: p.categorie, categorie_rang: p.rang, poste_id: p.id, poste: p.nom, poste_ordre: p.ordre };
      lignesPrev.push(versLigne(base, prevision));
      lignesObj.push(versLigne(base, objectif));
      reelsAvant.forEach((r, k) => lignesCmp[k].push(versLigne(base, r)));
    }
    // Opérations sans poste : réel seulement
    const sansPoste = per.map((m) => valeur(null, m));
    const sansPosteAvant = avants.map((a) => a.per.map((m) => valeur(null, m)));
    if (sansPoste.some((v) => v !== 0) || sansPosteAvant.some((r) => r.some((v) => v !== 0))) {
      const base = { categorie_id: null, categorie: null, categorie_rang: null, poste_id: null, poste: null, poste_ordre: null };
      lignesPrev.push(versLigne(base, sansPoste));
      lignesObj.push(versLigne(base, sansPoste.map(() => 0)));
      sansPosteAvant.forEach((r, k) => lignesCmp[k].push(versLigne(base, r)));
    }
    return {
      ref, per,
      prev: organiserBilan(lignesPrev), obj: organiserBilan(lignesObj),
      comparaisons: avants.map((a, k) => ({ decalage: a.decalage, bilan: organiserBilan(lignesCmp[k]) })) as Comparaison[],
      objectifs, suggestions, ids,
    };
  }, [donnees, postes, vue, decalages]);

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

  const { ref, per, prev, obj, comparaisons, objectifs, suggestions, ids } = calcul;
  const statuts = per.map((m) => statut(m, ref));
  const classeMois = (i: number) => (statuts[i] === "passe" ? "" : statuts[i]);
  const passes = per.filter((_, i) => statuts[i] === "passe");
  const enCours = per.find((_, i) => statuts[i] === "en-cours");
  const aVenir = per.filter((_, i) => statuts[i] === "a-venir");

  // Version app (téléphone) : uniquement le mois en cours, réel/prévu face à l'objectif du mois.
  if (estMobile) {
    const i = statuts.findIndex((s) => s === "en-cours");
    const iMois = i >= 0 ? i : 6;
    const m = (x: Montants) => x.mois[iMois];
    return (
      <section>
        <div className="carte prev-mobile">
          <h2>{majuscule(nomLong(per[iMois]))}</h2>
          <table>
            <thead>
              <tr>
                <th>Poste</th>
                <th className="droite">Ce mois</th>
                <th className="droite">Objectif</th>
                <th className="droite">Écart</th>
              </tr>
            </thead>
            <tbody>
              {prev.categories.map((c, k) => {
                const o = obj.categories[k];
                return (
                  <tr key={c.nom} className="cat">
                    <th scope="row" className="col-poste">{c.nom}</th>
                    <Cellule valeur={m(c.sousTotal)} />
                    <Cellule valeur={m(o.sousTotal)} />
                    <Cellule valeur={arr(m(c.sousTotal) - m(o.sousTotal))} />
                  </tr>
                );
              })}
              <tr className="resultat">
                <th scope="row" className="col-poste">Résultat</th>
                <Cellule valeur={m(prev.resultat)} />
                <Cellule valeur={m(obj.resultat)} />
                <Cellule valeur={arr(m(prev.resultat) - m(obj.resultat))} />
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  const enteteMois = (m: MoisAbs) => (vue === "glissant" ? `${MOIS_COURTS[m.mois - 1]} ${String(m.annee).slice(2)}` : MOIS_COURTS[m.mois - 1]);
  const libellePeriode = majuscule(plage(per[0], per[11]));
  const motTotal = vue === "civile" ? "année" : "12 mois";
  const parMois = vueMontant === "mensuel";
  // Synthèse de droite : moyenne mensuelle (total ÷ 12) ou total sur la période.
  const val = (total: number) => (parMois ? moyenne(total) : total);
  const anneeComparee = (dec: number) => per[6].annee - dec; // année « principale » de la fenêtre comparée
  const fenetreAvant = (dec: number) => ilYaNAns(per, dec);
  const NB_COLONNES = 16 + 2 * comparaisons.length; // poste + 12 mois + prévision, objectif, écart + 2 par année comparée

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

  const ouvrirCible = (posteId: number, nom: string, i: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setCible({ posteId, nom, moisLabel: majuscule(nomLong(per[i])), x: Math.min(r.left, window.innerWidth - 290), y: r.bottom + 4 });
  };

  const ligne = ({ nom, p, o, cmps, classe, avant: debut, apres, posteId }: {
    nom: string; p: Montants; o: Montants; cmps: Montants[]; classe?: string; avant?: ReactNode; apres?: ReactNode; posteId?: number;
  }) => (
      <tr className={classe}>
        <th scope="row" className="col-poste">{debut}{nom}{apres}</th>
        {p.mois.map((v, i) => (
          <CelluleMois key={i} valeur={v} classe={classeMois(i)}
            onClick={posteId !== undefined ? (e) => ouvrirCible(posteId, nom, i, e.currentTarget) : undefined} />
        ))}
        <Cellule valeur={val(p.total)} classe="col-resume col-prev bord" />
        <Cellule valeur={val(o.total)} classe="col-resume" />
        <Cellule valeur={arr(val(p.total) - val(o.total))} classe="col-resume" />
        {cmps.map((m, k) => (
          <Fragment key={k}>
            <Cellule valeur={val(m.total)} classe="col-resume col-cmp bord" />
            <CelluleEcart valeur={arr(val(p.total) - val(m.total))} classe="col-resume col-cmp" />
          </Fragment>
        ))}
      </tr>
    );

  const categorie = (bp: BlocCategorie, bo: BlocCategorie, bcs: BlocCategorie[]) => {
    const ouverte = ouvertes.has(bp.nom);
    const revoir = bp.postes.some((p) => {
      const id = ids.get(p.nom);
      const o = id !== undefined ? objectifs.get(id) : undefined;
      return o ? aRevoir(o, suggestions.get(o.poste_id) ?? null) : false;
    });
    return (
      <tbody key={bp.nom}>
        {ligne({ nom: bp.nom, p: bp.sousTotal, o: bo.sousTotal, cmps: bcs.map((b) => b.sousTotal),
          classe: `categorie ${ouverte ? "ouverte" : ""}`,
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
                {ligne({ nom: pp.nom, p: pp.montants, o: bo.postes[i].montants, cmps: bcs.map((b) => b.postes[i].montants),
                  posteId: id,
                  classe: `poste ${edition === id ? "ouverte" : ""}`,
                  apres: (
                    <>
                      {id !== undefined && !o && s && <span className="pastille neutre">sans objectif</span>}
                      {revoirPoste && <span className="pastille">à revoir</span>}
                      {id !== undefined && (
                        <button type="button" className={`objectif-ico ${edition === id ? "actif" : ""}`}
                          onClick={() => setEdition(edition === id ? null : id)}
                          title={edition === id ? "Fermer l'objectif" : "Modifier l'objectif"} aria-label="Objectif">
                          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                      )}
                    </>
                  ),
                })}
                {id !== undefined && edition === id && (
                  <tr className="edition">
                    <td colSpan={NB_COLONNES}>
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

  return (
    <section>
      <div className="carte barre-bilan">
        <strong>Prévisionnel</strong>
        <span className="bascule" role="group" aria-label="Période affichée">
          <button type="button" className={vue === "glissant" ? "actif" : ""} aria-pressed={vue === "glissant"} onClick={() => setVue("glissant")}>
            12 mois glissants
          </button>
          <button type="button" className={vue === "civile" ? "actif" : ""} aria-pressed={vue === "civile"} onClick={() => setVue("civile")}>
            Année civile {donnees.jour.getFullYear()}
          </button>
        </span>
        <span className="bascule" role="group" aria-label="Montants de la synthèse">
          <button type="button" className={parMois ? "actif" : ""} aria-pressed={parMois} onClick={() => setVueMontant("mensuel")}>
            Mensuel
          </button>
          <button type="button" className={!parMois ? "actif" : ""} aria-pressed={!parMois} onClick={() => setVueMontant("annuel")}>
            Annuel
          </button>
        </span>
        <label className="case">
          <input type="checkbox" checked={toutOuvert} onChange={(e) => setOuvertes(new Set(e.target.checked ? toutes : []))} />
          Afficher le détail des postes
        </label>
        <span className="bascule">
          <button type="button" className={avecLetzCelebrate ? "actif" : ""} aria-pressed={avecLetzCelebrate}
            title="Intégrer les dépenses et rentrées des comptes LetzCelebrate"
            onClick={() => setAvecLetzCelebrate((v) => !v)}>
            + LetzCelebrate
          </button>
        </span>
        <button type="button" className="info-bouton" aria-expanded={infoOuverte} aria-label="Informations sur le tableau"
          onClick={() => setInfoOuverte((v) => !v)}>i</button>
      </div>

      {infoOuverte && (
        <div className="carte info-panneau">
          <p className="sous">
            <strong>{libellePeriode}</strong>
            {passes.length > 0 && <> · {plage(passes[0], passes[passes.length - 1])} : réel</>}
            {enCours && (
              <> · <span className="legende-en-cours">{nomLong(enCours)} : prévision</span> (données jusqu'au {formatDate(donnees.derniere)})</>
            )}
            {aVenir.length > 0 && <> · <span className="legende-a-venir">{plage(aVenir[0], aVenir[aVenir.length - 1])} : objectifs</span></>}
            {!enCours && aVenir.length === 0 && " · tout est réel"}
            {comparaisons.length > 0 && <> · comparé au réel de {comparaisons.map((c) => anneeComparee(c.decalage)).join(", ")}</>}
          </p>
          {nbARevoir > 0 && (
            <p className="sous">
              <span className="pastille">à revoir</span> {nbARevoir} objectif{nbARevoir > 1 ? "s" : ""} ne correspond
              {nbARevoir > 1 ? "ent" : ""} plus aux 12 derniers mois : ouvrez la catégorie puis « objectif » pour voir la suggestion.
            </p>
          )}
          <p className="sous">
            Moy. = total ÷ 12. Objectif / Écart : votre objectif saisi et l'écart avec la prévision. « Comparé à … » : le réel
            des mêmes mois cette année-là ; l'écart (vert = mieux, rouge = moins bien) est la prévision moins ce réel.
            Régulier : on ajoute les opérations encore attendues ce mois-ci. Variable : on ajoute l'objectif au prorata des jours restants.
          </p>
        </div>
      )}

      {objectifs.size === 0 && (
        <div className="carte">
          <p>
            Aucun objectif enregistré. Je peux les pré-remplir à partir de vos deux dernières années (nombre d'opérations
            par mois, montant habituel, mois concernés). Vous pourrez ensuite corriger chaque poste.
          </p>
          <button className="principal" disabled={envoi} onClick={preRemplir}>Pré-remplir les objectifs</button>
        </div>
      )}
      <div className="carte tableau-bilan tableau-prev">
        <table>
          <thead>
            <tr className="bandeau">
              <th className="col-poste" />
              <th colSpan={12} className="bandeau-periode">{libellePeriode}</th>
              <th colSpan={3} className="col-resume bord bandeau-cmp">{parMois ? "Moyenne par mois" : "Sur la période"}</th>
              {comparaisons.map((c) => (
                <th key={c.decalage} colSpan={2} className="col-resume col-cmp bord bandeau-cmp">
                  Comparé à {anneeComparee(c.decalage)}<br />
                  <span className="sous-titre">{plage(fenetreAvant(c.decalage)[0], fenetreAvant(c.decalage)[11])}</span>
                </th>
              ))}
            </tr>
            <tr>
              <th className="col-poste">Poste</th>
              {per.map((m, i) => <th key={i} className={`droite ${classeMois(i)}`}>{enteteMois(m)}</th>)}
              <th className="droite col-resume col-prev bord">Prévision {parMois ? "mensuelle" : motTotal}</th>
              <th className="droite col-resume">Objectif {parMois ? "mensuel" : motTotal}</th>
              <th className="droite col-resume">Écart</th>
              {comparaisons.map((c) => (
                <Fragment key={c.decalage}>
                  <th className="droite col-resume col-cmp bord">Réel {anneeComparee(c.decalage)}{parMois ? " /mois" : ""}</th>
                  <th className="droite col-resume col-cmp">Écart</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          {prev.categories.map((c, i) => categorie(c, obj.categories[i], comparaisons.map((cm) => cm.bilan.categories[i])))}
          <tbody>
            {ligne({ nom: "Résultat prévu (ressources − dépenses)", p: prev.resultat, o: obj.resultat,
              cmps: comparaisons.map((c) => c.bilan.resultat), classe: "resultat" })}
          </tbody>
          {prev.neutres && obj.neutres && (
            <>
              <tbody>
                <tr className="titre-categorie">
                  <th scope="rowgroup" colSpan={NB_COLONNES} className="col-poste">Neutres (virements entre comptes, hors résultat)</th>
                </tr>
              </tbody>
              {categorie(prev.neutres, obj.neutres, comparaisons.map((c) => c.bilan.neutres as BlocCategorie))}
            </>
          )}
        </table>
      </div>

      {cible && (
        <div className="popover-fond" onClick={() => setCible(null)}>
          <EditeurTarget posteId={cible.posteId} nom={cible.nom} moisLabel={cible.moisLabel} x={cible.x} y={cible.y}
            objectif={objectifs.get(cible.posteId) ?? null} suggestion={suggestions.get(cible.posteId) ?? null} envoi={envoi}
            onEnregistrer={(o) => { setCible(null); enregistrer(o); }} onFermer={() => setCible(null)} />
        </div>
      )}
    </section>
  );
}

function EditeurTarget({ posteId, nom, moisLabel, x, y, objectif, suggestion, envoi, onEnregistrer, onFermer }: {
  posteId: number; nom: string; moisLabel: string; x: number; y: number;
  objectif: Objectif | null; suggestion: Objectif | null; envoi: boolean;
  onEnregistrer: (o: Objectif) => void; onFermer: () => void;
}) {
  const base = objectif ?? suggestion;
  const signe = base && base.montant > 0 ? 1 : -1;
  const [montant, setMontant] = useState(objectif ? Math.abs(objectif.montant).toFixed(2).replace(".", ",") : "");
  const valeur = lireSaisie(montant);
  const valide = valeur !== null && valeur >= 0;

  const appliquer = () => {
    if (!valide) return;
    onEnregistrer({
      poste_id: posteId,
      mode: base?.mode ?? "variable",
      montant: signe * Math.abs(valeur ?? 0),
      nb_operations: base?.mode === "regulier" ? base?.nb_operations ?? 1 : 1,
      mois: base?.mois ? [...base.mois] : [...TOUS_LES_MOIS],
    });
  };

  return (
    <div className="popover-target" style={{ top: y, left: x }} onClick={(e) => e.stopPropagation()}>
      <strong>{nom}</strong>
      <div className="sous">{moisLabel} · objectif mensuel {signe < 0 ? "(dépense)" : "(entrée)"}</div>
      <div className="popover-ligne">
        <input autoFocus inputMode="decimal" className="montant" value={montant} placeholder="Nouvelle target"
          onChange={(e) => setMontant(e.target.value)} />
        <span>€/mois</span>
        {suggestion && (
          <button type="button" className="calc-ico" title="Calculer depuis l'historique des 12 derniers mois"
            onClick={() => setMontant(Math.abs(suggestion.montant).toFixed(2).replace(".", ","))}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="8" y1="10" x2="8" y2="10" /><line x1="12" y1="10" x2="12" y2="10" /><line x1="16" y1="10" x2="16" y2="10" /><line x1="8" y1="14" x2="8" y2="14" /><line x1="12" y1="14" x2="12" y2="14" /><line x1="8" y1="18" x2="16" y2="18" />
            </svg>
          </button>
        )}
      </div>
      <div className="popover-actions">
        <button type="button" className="principal" disabled={envoi || !valide} onClick={appliquer}>Appliquer à tous les mois</button>
        <button type="button" className="lien" onClick={onFermer}>Fermer</button>
      </div>
    </div>
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
  const valide = valeur !== null && valeur >= 0 && mois.size > 0 && nb >= 1 && nb <= 31;
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
