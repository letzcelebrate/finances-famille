"""Reprise de l'historique : envoie dans Supabase les fichiers JSON produits
par extraire_excel.py.

Usage :
    python3 scripts/reprise/charger_supabase.py <dossier_json> [--essai]

--essai : prépare tout sans rien envoyer.

La clé secrète n'est jamais lue par ce programme : elle est ajoutée aux
requêtes par le proxy réseau de l'environnement Claude Code.

Sécurité : le programme refuse de s'exécuter si les tables ne sont pas vides.
"""

import json
import pathlib
import sys
import urllib.request

URL = "https://owwykjbunmyjugmiuvmu.supabase.co/rest/v1"
LOT = 1000


def requete(methode, chemin, corps=None, retour=False):
    entetes = {
        "apikey": "proxy-injected",
        "Content-Type": "application/json",
        "Prefer": "return=representation" if retour else "return=minimal",
    }
    donnees = None if corps is None else json.dumps(corps, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(f"{URL}/{chemin}", data=donnees, headers=entetes, method=methode)
    with urllib.request.urlopen(req, timeout=120) as rep:
        contenu = rep.read()
        return json.loads(contenu) if contenu else None


def main(dossier, essai):
    d = pathlib.Path(dossier)
    lire = lambda nom: json.loads((d / f"{nom}.json").read_text(encoding="utf-8"))
    categories, postes, comptes, operations = (
        lire("categories"), lire("postes"), lire("comptes"), lire("operations"))

    for table in ("categories", "postes", "comptes", "operations", "imports"):
        if requete("GET", f"{table}?select=id&limit=1"):
            raise SystemExit(f"ARRÊT : la table {table} n'est pas vide.")
    print("Tables vides : OK")

    if essai:
        print(f"Essai : {len(categories)} catégories, {len(postes)} postes, "
              f"{len(comptes)} comptes, {len(operations)} opérations prêts. Rien envoyé.")
        return

    ids_cat = {c["nom"]: c["id"] for c in requete(
        "POST", "categories", [{"nom": c["nom"], "rang": c["rang"]} for c in categories], retour=True)}
    print(f"Catégories envoyées : {len(ids_cat)}")

    ids_poste = {p["nom"]: p["id"] for p in requete("POST", "postes", [{
        "nom": p["nom"], "categorie_id": ids_cat[p["categorie"]],
        "description": p["description"], "ordre": p["ordre"]} for p in postes], retour=True)}
    print(f"Postes envoyés : {len(ids_poste)}")

    ids_compte = {(c["banque"], c["nom"]): c["id"] for c in requete("POST", "comptes", [{
        "banque": c["banque"], "nom": c["nom"], "type_compte": c["type_compte"],
        "titulaire": c["titulaire"], "ouvert": c["ouvert"]} for c in comptes], retour=True)}
    print(f"Comptes envoyés : {len(ids_compte)}")

    lignes = [{
        "compte_id": ids_compte[tuple(o["compte"])],
        "date_operation": o["date_operation"],
        "mois_rattachement": o["mois_rattachement"],
        "libelle": o["libelle"],
        "montant": o["montant"],
        "devise": o["devise"],
        "titulaire": o["titulaire"],
        "poste_id": ids_poste[o["poste"]] if o["poste"] else None,
        "empreinte": o["empreinte"],
        "occurrence": o["occurrence"],
    } for o in operations]
    for debut in range(0, len(lignes), LOT):
        requete("POST", "operations", lignes[debut:debut + LOT])
        print(f"Opérations envoyées : {min(debut + LOT, len(lignes))} / {len(lignes)}")
    print("Terminé.")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--essai"]
    if len(args) != 1:
        raise SystemExit(__doc__)
    main(args[0], "--essai" in sys.argv)
