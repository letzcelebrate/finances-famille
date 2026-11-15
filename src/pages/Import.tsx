import { useEffect, useState } from "react";
import { formatDate, formatMontant } from "../lib/format";
import { lireCsvRaiffeisen, ErreurImport, type FichierImport } from "../lib/import/raiffeisen";
import { empreinte, separerNouvelles } from "../lib/import/empreinte";
import { preparerClassement, type Proposition } from "../lib/import/classement";
import {
  ajouterRegle,
  chargerComptes,
  chargerExistantes,
  chargerHistorique,
  chargerRegles,
  importer,
  memoriserIdentifiant,
  soldeCompte,
  type CompteImport,
} from "../lib/import/donnees";
import { EditeurDivision, partsInitiales, partsValides, SelectPoste, usePostes, type Part } from "../components/Classement";

type Ligne = {
  cle: number;
  date_operation: string;
  libelle: string;
  montant: number;
  devise: string;
  type_mouvement: string;
  proposition: Proposition;
  poste_id: number | null;
  note: string;
  parts: Part[] | null; // division en plusieurs postes
  modifie: boolean;
  inclure: boolean;
};

type Analyse = {
  nomFichier: string;
  fichier: FichierImport;
  compte: CompteImport | null;
  dejaPresentes: number;
  solde: number | null;
};

const estClassee = (l: Ligne) => (l.parts ? partsValides(l.parts, l.montant) !== null : l.poste_id !== null);

export default function Import() {
  const [comptes, setComptes] = useState<CompteImport[]>([]);
  const { postes, groupes } = usePostes();
  const [etat, setEtat] = useState<"choix" | "analyse" | "revue" | "envoi" | "fini">("choix");
  const [erreur, setErreur] = useState<string | null>(null);
  const [analyse, setAnalyse] = useState<Analyse | null>(null);
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [compteChoisi, setCompteChoisi] = useState<number | "">("");
  const [memoriser, setMemoriser] = useState(true);
  const [resultat, setResultat] = useState<string | null>(null);
  const [regleEnCours, setRegleEnCours] = useState<{ motif: string; poste_id: number | null; a_confirmer: boolean } | null>(null);

  useEffect(() => {
    chargerComptes().then(setComptes).catch((e) => setErreur(e.message));
  }, []);

  const nomPoste = (id: number | null) => postes.find((p) => p.id === id)?.nom ?? null;
  const majLigne = (cle: number, m: Partial<Ligne>) => setLignes((ls) => ls.map((x) => (x.cle === cle ? { ...x, ...m } : x)));

  async function analyser(fichierChoisi: File) {
    setErreur(null);
    setEtat("analyse");
    try {
      const texte = await fichierChoisi.text();
      const fichier = lireCsvRaiffeisen(texte);
      const compte = comptes.find((c) => c.identifiant_import === fichier.identifiant) ?? null;
      setAnalyse({ nomFichier: fichierChoisi.name, fichier, compte, dejaPresentes: 0, solde: null });
      if (compte) await preparer(fichierChoisi.name, fichier, compte);
      else setEtat("revue");
    } catch (e) {
      setErreur(e instanceof ErreurImport ? e.message : `Erreur : ${(e as Error).message}`);
      setEtat("choix");
    }
  }

  async function preparer(nomFichier: string, fichier: FichierImport, compte: CompteImport, garder: Ligne[] = []) {
    setEtat("analyse");
    const depuis = fichier.lignes.map((l) => l.date_operation).sort()[0];
    const [existantes, historique, regles, solde] = await Promise.all([
      chargerExistantes(compte.id, depuis),
      chargerHistorique(),
      chargerRegles(),
      soldeCompte(compte.id),
    ]);
    const chrono = [...fichier.lignes].sort((a, b) => a.date_operation.localeCompare(b.date_operation));
    const { presentes, nouvelles } = separerNouvelles(chrono, existantes);
    const proposer = preparerClassement(historique, regles);
    setLignes(
      nouvelles.map((l, i) => {
        const p = proposer(l.libelle);
        // conserver ce qui a déjà été saisi à la main (ex. après création d'une règle)
        const avant = garder.find((g) => g.cle === i && g.modifie);
        const base = { ...l, cle: i, proposition: p, poste_id: p.poste_id, note: "", parts: null, modifie: false, inclure: true };
        return avant ? { ...base, poste_id: avant.poste_id, note: avant.note, parts: avant.parts, modifie: true, inclure: avant.inclure } : base;
      }),
    );
    setAnalyse({ nomFichier, fichier, compte, dejaPresentes: presentes.length, solde });
    setEtat("revue");
  }

  async function confirmerCompte() {
    if (!analyse || compteChoisi === "") return;
    const compte = comptes.find((c) => c.id === compteChoisi)!;
    try {
      if (memoriser) await memoriserIdentifiant(compte.id, analyse.fichier.identifiant, analyse.fichier.format);
      await preparer(analyse.nomFichier, analyse.fichier, { ...compte, identifiant_import: analyse.fichier.identifiant });
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  async function valider() {
    if (!analyse?.compte) return;
    const aEnvoyer = lignes.filter((l) => l.inclure);
    setEtat("envoi");
    setErreur(null);
    try {
      await importer(
        analyse.compte.id,
        analyse.nomFichier,
        analyse.fichier.lignes.length,
        aEnvoyer.map((l) => ({
          date_operation: l.date_operation,
          libelle: l.libelle,
          montant: l.montant,
          devise: l.devise,
          titulaire: analyse.compte!.titulaire,
          poste_id: l.parts ? null : l.poste_id,
          note: l.note.trim(),
          ventilations: l.parts ? partsValides(l.parts, l.montant)! : [],
          empreinte: empreinte(l.date_operation, l.libelle, l.montant),
        })),
      );
      setResultat(`${aEnvoyer.length} opération(s) importée(s) sur ${analyse.compte.banque} — ${analyse.compte.nom}.`);
      setEtat("fini");
    } catch (e) {
      setErreur(`L'import a échoué, rien n'a été enregistré. (${(e as Error).message})`);
      setEtat("revue");
    }
  }

  async function enregistrerRegle() {
    if (!regleEnCours) return;
    try {
      await ajouterRegle(regleEnCours.motif, regleEnCours.poste_id, regleEnCours.a_confirmer);
      setRegleEnCours(null);
      if (analyse?.compte) await preparer(analyse.nomFichier, analyse.fichier, analyse.compte, lignes);
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  function recommencer() {
    setAnalyse(null);
    setLignes([]);
    setResultat(null);
    setErreur(null);
    setCompteChoisi("");
    setEtat("choix");
  }

  const incluses = lignes.filter((l) => l.inclure);
  const total = incluses.reduce((s, l) => s + l.montant, 0);
  const aClasser = incluses.filter((l) => !estClassee(l)).length;
  const aConfirmer = incluses.filter((l) => !l.modifie && l.poste_id !== null && l.proposition.certitude !== "forte").length;
  const soldeApres = analyse?.solde != null ? analyse.solde + total : null;
  const ecartBanque =
    soldeApres != null && analyse?.fichier.solde_banque != null ? Math.round((analyse.fichier.solde_banque - soldeApres) * 100) / 100 : null;

  return (
    <section>
      {erreur && <p className="carte alerte">{erreur}</p>}

      {etat === "choix" && (
        <div className="carte">
          <h2>Importer un relevé</h2>
          <p className="sous">Fichier CSV téléchargé depuis Raiffeisen (compte courant ou relevé de carte Visa), sans l'ouvrir dans Excel.</p>
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && analyser(e.target.files[0])} />
        </div>
      )}

      {etat === "analyse" && <p>Analyse du fichier…</p>}
      {etat === "envoi" && <p>Enregistrement…</p>}

      {etat === "fini" && (
        <div className="carte">
          <h2>Import terminé</h2>
          <p>{resultat}</p>
          <button className="principal" onClick={recommencer}>Importer un autre fichier</button>
        </div>
      )}

      {etat === "revue" && analyse && !analyse.compte && (
        <div className="carte">
          <h2>Quel compte ?</h2>
          <p>Ce fichier n'est rattaché à aucun compte. Choisis le compte correspondant :</p>
          <div className="filtres">
            <select value={compteChoisi} onChange={(e) => setCompteChoisi(e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">— choisir —</option>
              {comptes.filter((c) => c.ouvert).map((c) => (
                <option key={c.id} value={c.id}>{c.banque} — {c.nom}</option>
              ))}
            </select>
            <label className="case">
              <input type="checkbox" checked={memoriser} onChange={(e) => setMemoriser(e.target.checked)} />
              Reconnaître automatiquement ce compte la prochaine fois
            </label>
          </div>
          <p>
            <button className="principal" disabled={compteChoisi === ""} onClick={confirmerCompte}>Continuer</button>{" "}
            <button className="lien" onClick={recommencer}>Annuler</button>
          </p>
        </div>
      )}

      {etat === "revue" && analyse?.compte && (
        <>
          <div className="carte">
            <h2>{analyse.compte.banque} — {analyse.compte.nom}</h2>
            <p className="sous">{analyse.nomFichier}</p>
            <ul className="bilan">
              {analyse.fichier.periode && (() => {
                const p = analyse.fichier.periode;
                const somme = Math.round(analyse.fichier.lignes.reduce((t, l) => t + l.montant, 0) * 100) / 100;
                return (
                  <li>
                    Relevé du {formatDate(p.debut)} au {formatDate(p.fin)} (prélevé le {formatDate(p.prelevement)}) :{" "}
                    <strong>{formatMontant(p.total)}</strong>
                    {somme === p.total
                      ? <span className="positif"> — identique à la somme des lignes ✓</span>
                      : <span className="negatif"> — la somme des lignes donne {formatMontant(somme)} : fichier incomplet ?</span>}
                  </li>
                );
              })()}
              <li>{analyse.fichier.lignes.length} lignes dans le fichier</li>
              <li>{analyse.dejaPresentes} déjà présentes (ignorées)</li>
              <li><strong>{lignes.length} nouvelles</strong>{lignes.length > 0 && <> — total {formatMontant(total)}</>}</li>
              {aConfirmer > 0 && <li className="attention">{aConfirmer} proposition(s) à confirmer</li>}
              {aClasser > 0 && <li className="negatif">{aClasser} opération(s) à classer avant de pouvoir importer</li>}
              {soldeApres != null && (
                <li>
                  Solde après import : <strong>{formatMontant(soldeApres)}</strong>
                  {ecartBanque != null && (
                    ecartBanque === 0
                      ? <span className="positif"> — identique au solde de la banque ✓</span>
                      : <span className="attention"> — la banque indique {formatMontant(analyse.fichier.solde_banque!)} (écart {formatMontant(ecartBanque)})</span>
                  )}
                </li>
              )}
            </ul>
          </div>

          {regleEnCours && (
            <div className="carte">
              <h2>Nouvelle règle de classement</h2>
              <div className="filtres">
                <label>
                  Si le libellé contient
                  <input value={regleEnCours.motif} onChange={(e) => setRegleEnCours({ ...regleEnCours, motif: e.target.value })} />
                </label>
                <label>
                  Proposer le poste (vide = ne jamais deviner)
                  <SelectPoste valeur={regleEnCours.poste_id} groupes={groupes}
                    onChange={(id) => setRegleEnCours({ ...regleEnCours, poste_id: id })} />
                </label>
                <label className="case">
                  <input type="checkbox" checked={regleEnCours.a_confirmer} disabled={regleEnCours.poste_id === null}
                    onChange={(e) => setRegleEnCours({ ...regleEnCours, a_confirmer: e.target.checked })} />
                  Toujours demander confirmation
                </label>
              </div>
              <p>
                <button className="principal" disabled={regleEnCours.motif.trim().length < 3} onClick={enregistrerRegle}>
                  Enregistrer la règle
                </button>{" "}
                <button className="lien" onClick={() => setRegleEnCours(null)}>Annuler</button>
              </p>
            </div>
          )}

          {lignes.length === 0 ? (
            <div className="carte">
              <p>Aucune nouvelle opération : tout est déjà dans la base.</p>
              <button className="principal" onClick={recommencer}>Choisir un autre fichier</button>
            </div>
          ) : (
            <div className="carte">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Date</th>
                    <th>Libellé et note</th>
                    <th className="droite">Montant</th>
                    <th>Poste</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => {
                    const statut = l.parts
                      ? (estClassee(l) ? "corrige" : "aclasser")
                      : l.modifie ? "corrige" : l.poste_id === null ? "aclasser" : l.proposition.certitude === "forte" ? "sur" : "confirmer";
                    return (
                      <tr key={l.cle} className={l.inclure ? `statut-${statut}` : "exclue"}>
                        <td>
                          <input type="checkbox" title="Importer cette ligne" checked={l.inclure}
                            onChange={(e) => majLigne(l.cle, { inclure: e.target.checked })} />
                        </td>
                        <td className="nowrap">{formatDate(l.date_operation)}</td>
                        <td className="libelle">
                          {l.libelle}
                          <div className="sous">{l.type_mouvement}</div>
                          <input className="note" placeholder="Ajouter une note…" value={l.note}
                            onChange={(e) => majLigne(l.cle, { note: e.target.value })} />
                        </td>
                        <td className={`droite nowrap ${l.montant < 0 ? "negatif" : "positif"}`}>{formatMontant(l.montant, l.devise)}</td>
                        <td className="poste">
                          {l.parts ? (
                            <>
                              <EditeurDivision parts={l.parts} montant={l.montant} groupes={groupes}
                                onChange={(parts) => majLigne(l.cle, { parts, modifie: true })} />
                              <button className="lien petit" onClick={() => majLigne(l.cle, { parts: null })}>annuler la division</button>
                            </>
                          ) : (
                            <>
                              <SelectPoste valeur={l.poste_id} groupes={groupes} manquant={l.inclure && l.poste_id === null}
                                onChange={(id) => majLigne(l.cle, { poste_id: id, modifie: id !== l.proposition.poste_id })} />
                              <div className="sous">
                                {statut === "sur" && <>✓ {l.proposition.raison}</>}
                                {statut === "confirmer" && <span className="attention">⚠ {l.proposition.raison}</span>}
                                {statut === "aclasser" && <span className="negatif">à classer — {l.proposition.raison}</span>}
                                {statut === "corrige" && <>modifié (proposé : {nomPoste(l.proposition.poste_id) ?? "aucun"})</>}
                                {" · "}
                                <button className="lien petit" onClick={() => majLigne(l.cle, { parts: partsInitiales(l.poste_id, l.montant), modifie: true })}>
                                  diviser
                                </button>
                                {" · "}
                                <button className="lien petit" onClick={() =>
                                  setRegleEnCours({ motif: l.libelle.split(",")[0].trim(), poste_id: l.poste_id, a_confirmer: false })}>
                                  créer une règle
                                </button>
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="actions">
                <button className="principal" disabled={incluses.length === 0 || aClasser > 0} onClick={valider}>
                  Importer {incluses.length} opération{incluses.length > 1 ? "s" : ""}
                </button>{" "}
                <button className="lien" onClick={recommencer}>Annuler</button>
                {aClasser > 0 && (
                  <span className="negatif">
                    Choisis un poste (ou termine la division) pour les {aClasser} ligne(s) en rouge, ou décoche-les, pour pouvoir importer.
                  </span>
                )}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
