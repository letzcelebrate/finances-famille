"""Reprise de l'historique : lit le classeur Excel « Relevés de Compte »
et produit des fichiers JSON prêts à charger dans la base.

Usage :
    python3 scripts/reprise/extraire_excel.py <classeur.xlsm> <dossier_sortie>

Le dossier de sortie doit être HORS du dépôt Git : il contient des données
financières personnelles.

Le programme s'arrête avec une erreur à la moindre valeur inattendue
(poste inconnu, titulaire inconnu, date illisible...).
"""

import calendar
import collections
import datetime
import decimal
import hashlib
import json
import pathlib
import re
import sys

import openpyxl

MOIS = {
    m: i
    for i, m in enumerate(
        ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
         "août", "septembre", "octobre", "novembre", "décembre"],
        start=1,
    )
}

TITULAIRES = {"Joint": "Joint", "Join": "Joint", "Perso SA": "Perso SA", "Perso MG": "Perso MG"}

TYPES_COMPTE = {
    "Courant": "Courant",
    "Carte Bancaire": "Carte Bancaire",
    "Epargne": "Epargne",
    "Cash": "Cash",
    "Retraite": "Retraite",
    "Titres": "Titres",
    "Fermé": "Epargne",  # valeur erronée dans Excel, uniquement sur des livrets
}

# Colonnes de l'onglet Database (index à partir de 0)
C_JOUR, C_MOIS, C_ANNEE, C_TYPE = 2, 3, 4, 5
C_OUVERT, C_DETAIL_FERME, C_TITULAIRE = 6, 7, 8
C_DATE, C_BANQUE, C_NOM, C_DETAILS, C_POSTE = 9, 10, 11, 12, 13
C_DEVISE, C_MONTANT = 16, 17

COMPTE_FERME = "Compte Fermé"


def reparer_texte(texte):
    """Répare un ancien rechercher/remplacer « cat » -> « Animaux » dans les mots.

    « Animaux » seul (un vrai poste de dépense) n'est pas touché.
    """
    if not isinstance(texte, str):
        return texte

    def remplacer(m):
        avant = m.string[m.start() - 1] if m.start() > 0 else ""
        apres = m.string[m.end()] if m.end() < len(m.string) else ""
        if (avant.isalpha() and avant.isupper()) or (apres.isalpha() and apres.isupper()):
            return "CAT"
        if not avant.isalpha():
            return "Cat"
        return "cat"

    return re.sub(r"(?<=\w)Animaux|Animaux(?=\w)", remplacer, texte)


def normaliser(texte):
    return re.sub(r"\s+", " ", (texte or "")).strip().upper()


def empreinte(date_op, libelle, montant):
    cle = f"{date_op.isoformat()}|{normaliser(libelle)}|{montant:.2f}"
    return hashlib.md5(cle.encode("utf-8")).hexdigest()


def lire_compte_ferme(detail):
    """Déduit (banque, nom) d'un compte fermé à partir de sa description Excel."""
    d = (detail or "").strip()
    if d in ("", "n/a") or "Compte Fermé" in d:
        return ("Inconnue", "Compte fermé non identifié")
    m = re.match(r"Banque:\s*(.+?);\s*Compte:\s*(.+)$", d)
    if m:
        return (m.group(1).strip(), m.group(2).strip())
    m = re.match(r"(.+?)\s*(?::|,| - )\s*(.+)$", d)
    if m:
        return (m.group(1).strip(), m.group(2).strip())
    return ("Inconnue", d)


def main(chemin_classeur, dossier_sortie):
    sortie = pathlib.Path(dossier_sortie)
    sortie.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.load_workbook(chemin_classeur, data_only=True)

    # ---------------- Paramètres : catégories et postes ----------------
    categories, postes = {}, {}
    for ligne in wb["Paramètres"].iter_rows(min_row=15, max_row=99, values_only=True):
        nom_poste, nom_cat, rang, description = ligne[1], ligne[2], ligne[3], ligne[4]
        if not nom_poste or nom_cat in (None, "n/a"):
            continue
        nom_poste = reparer_texte(str(nom_poste)).strip()
        nom_cat = reparer_texte(str(nom_cat)).strip()
        rang = int(rang)
        categories.setdefault(nom_cat, rang)
        postes[nom_poste] = {
            "nom": nom_poste,
            "categorie": nom_cat,
            "description": reparer_texte(description).strip() if description else None,
            "ordre": len(postes) + 1,
        }
    postes_par_cle = {p.lower(): p for p in postes}

    # ---------------- Database : opérations ----------------
    lignes = []
    for num, r in enumerate(wb["Database"].iter_rows(min_row=4, values_only=True), start=4):
        if r[C_MONTANT] in (None, "") or r[C_ANNEE] in (None, "Année"):
            continue
        lignes.append((num, r))

    comptes = {}
    operations = []
    # Quelques montants Excel ont plus de 2 décimales (ex. une dépense partagée
    # en deux : -30,975 et -30,975). Arrondir chaque ligne fausserait le solde
    # d'un centime : on arrondit le cumul par compte, ce qui garde les soldes exacts.
    cumul_exact = collections.defaultdict(decimal.Decimal)
    cumul_arrondi = collections.defaultdict(decimal.Decimal)
    centime = decimal.Decimal("0.01")
    anomalies = collections.Counter()
    for num, r in lignes:
        # dates
        annee, mois_txt = int(r[C_ANNEE]), str(r[C_MOIS]).strip().lower()
        if mois_txt not in MOIS:
            raise SystemExit(f"Ligne {num} : mois illisible {r[C_MOIS]!r}")
        mois = MOIS[mois_txt]
        if isinstance(r[C_DATE], datetime.datetime):
            date_op = r[C_DATE].date()
        else:
            jour = min(int(r[C_JOUR]), calendar.monthrange(annee, mois)[1])
            date_op = datetime.date(annee, mois, jour)
            anomalies["date reconstruite"] += 1
        mois_ratt = datetime.date(annee, mois, 1)

        # compte
        banque, nom = str(r[C_BANQUE]).strip(), str(r[C_NOM]).strip()
        ferme = banque == COMPTE_FERME
        if ferme:
            banque, nom = lire_compte_ferme(r[C_DETAIL_FERME])
        cle_compte = (banque, nom)
        c = comptes.setdefault(cle_compte, {
            "banque": banque, "nom": nom, "ferme_excel": ferme,
            "types": collections.Counter(), "titulaires": collections.Counter(),
            "etats": collections.Counter(),
        })
        type_brut = str(r[C_TYPE]).strip()
        if type_brut not in TYPES_COMPTE:
            raise SystemExit(f"Ligne {num} : type de compte inconnu {type_brut!r}")
        c["types"][TYPES_COMPTE[type_brut]] += 1
        c["etats"][str(r[C_OUVERT]).strip()] += 1

        # titulaire
        tit_brut = str(r[C_TITULAIRE]).strip()
        if tit_brut not in TITULAIRES:
            raise SystemExit(f"Ligne {num} : titulaire inconnu {tit_brut!r}")
        titulaire = TITULAIRES[tit_brut]
        c["titulaires"][titulaire] += 1

        # poste
        poste = None
        if r[C_POSTE] not in (None, ""):
            brut = reparer_texte(str(r[C_POSTE])).strip()
            poste = postes_par_cle.get(brut.lower())
            if poste is None:
                raise SystemExit(f"Ligne {num} : poste inconnu {r[C_POSTE]!r}")
            if poste != brut:
                anomalies["poste corrigé (majuscules)"] += 1

        # montant, libellé, devise
        cumul_exact[cle_compte] += decimal.Decimal(repr(float(r[C_MONTANT])))
        nouveau = cumul_exact[cle_compte].quantize(centime, rounding=decimal.ROUND_HALF_UP)
        montant = float(nouveau - cumul_arrondi[cle_compte])
        cumul_arrondi[cle_compte] = nouveau
        if abs(montant - float(r[C_MONTANT])) > 1e-9:
            anomalies["montant arrondi au centime"] += 1
        libelle_brut = "" if r[C_DETAILS] is None else str(r[C_DETAILS])
        libelle = reparer_texte(libelle_brut).strip()
        if libelle != libelle_brut.strip():
            anomalies["libellé réparé"] += 1
        devise = str(r[C_DEVISE] or "EUR").strip()

        operations.append({
            "ligne_excel": num,
            "compte": list(cle_compte),
            "date_operation": date_op.isoformat(),
            "mois_rattachement": mois_ratt.isoformat(),
            "libelle": libelle,
            "montant": montant,
            "devise": devise,
            "titulaire": titulaire,
            "poste": poste,
            "empreinte": empreinte(date_op, libelle, montant),
        })

    # occurrences : opérations identiques sur un même compte -> 1, 2, 3...
    compteur = collections.Counter()
    for op in operations:
        k = (tuple(op["compte"]), op["empreinte"])
        compteur[k] += 1
        op["occurrence"] = compteur[k]
    anomalies["opérations identiques conservées"] = sum(v - 1 for v in compteur.values() if v > 1)

    liste_comptes = []
    for (banque, nom), c in sorted(comptes.items()):
        ouvert = not c["ferme_excel"] and nom != COMPTE_FERME and c["etats"].most_common(1)[0][0] != "Fermé"
        liste_comptes.append({
            "banque": banque,
            "nom": nom,
            "type_compte": c["types"].most_common(1)[0][0],
            "titulaire": c["titulaires"].most_common(1)[0][0],
            "ouvert": ouvert,
            "nb_operations": sum(c["types"].values()),
        })

    donnees = {
        "categories": [{"nom": k, "rang": v} for k, v in categories.items()],
        "postes": list(postes.values()),
        "comptes": liste_comptes,
        "operations": operations,
    }
    for nom, contenu in donnees.items():
        (sortie / f"{nom}.json").write_text(json.dumps(contenu, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"Catégories : {len(categories)}")
    print(f"Postes     : {len(postes)}")
    print(f"Comptes    : {len(liste_comptes)} ({sum(c['ouvert'] for c in liste_comptes)} ouverts)")
    print(f"Opérations : {len(operations)}")
    for k, v in sorted(anomalies.items()):
        print(f"  - {k} : {v}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
