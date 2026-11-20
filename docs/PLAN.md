# Finances Famille — Plan du projet

Ce document est la mémoire du projet entre les sessions de travail.
Il ne contient **aucune donnée financière** (ni montant, ni IBAN, ni numéro de carte).

## Objectif

Remplacer le classeur Excel « Relevés de Compte » et les 3 fichiers Excel de
conversion des relevés Raiffeisen par **une seule application web privée** :

- je dépose le CSV téléchargé depuis la banque ;
- l'application reconnaît le compte, écarte les opérations déjà importées
  et me propose un classement ;
- je valide ou corrige le classement ;
- je consulte mes soldes et mes analyses en ligne.

Outils retenus : base de données **Supabase** (projet « Finances-Famille »,
région Francfort, organisation « Famille ») et hébergement **Netlify**, en accès privé.

## Ce que fait l'existant (Excel)

### Fichiers de conversion (3 fichiers, même logique)

| Fichier | Compte | Type de compte | Format du CSV |
|---|---|---|---|
| 1. Extraction.Raiffeisen | Compte Courant | Courant | relevé de compte (5 colonnes) |
| 2. Extraction.Raiffeisen.Visa. SAG | Visa Gold SA | Carte Bancaire | relevé de carte (13 colonnes) |
| 2. Extraction.Raiffeisen.Visa. MG | Visa Gold MG | Carte Bancaire | relevé de carte (13 colonnes) |

Étapes réalisées par les macros :

1. coller le CSV, découper les colonnes, convertir les dates et les montants
   (virgule → point) ;
2. trier par date ;
3. repérer les opérations déjà importées en comparant avec le précédent import :
   - compte courant : date + libellé,
   - cartes : date + libellé + montant ;
4. produire les nouvelles lignes au format de la base, avec des valeurs fixes
   (banque Raiffeisen, nom du compte, type de compte, « Joint », EUR) ;
5. le classement (poste de dépense) est choisi **à la main** ligne par ligne ;
   la catégorie et le rang en découlent automatiquement.

Le CSV contient l'IBAN (compte courant) ou le numéro de carte masqué (cartes) :
l'application pourra donc reconnaître le compte toute seule.

### Classeur « Relevés de Compte »

- **Base** : environ 22 000 opérations de 2008 à aujourd'hui, une dizaine de
  banques (dont des comptes fermés), comptes courants, cartes, épargne, liquide,
  retraite, titres. Colonnes : date, banque, nom du compte, type de compte,
  joint/perso, détails, poste de dépense, catégorie, devise, montant.
- **Paramètres** : environ 85 postes de dépense répartis en 15 catégories
  (Ressources, Logement, Alimentation, Éducation, Santé, Taxes, Télécom,
  Services, Services bancaires, Transport quotidien, Habillement, Loisirs,
  Voyage, Indéfini, Neutres), chacun avec un rang d'affichage et parfois une
  description.
- **Analyses** :
  - Synthèse : solde de chaque compte à date, comparé au solde affiché par la banque ;
  - Soldes annuels par type de compte ;
  - Bilan par mois (par catégorie et poste) ;
  - Bilan par années et moyennes mensuelles par année ;
  - Objectifs / prévisionnel mensuel ;
  - Bénéfice de l'activité SA ;
  - Tableau croisé (poste × mois × année).

### À ne pas reproduire

- Libellés abîmés par un ancien « rechercher/remplacer » (« Animauxégories »,
  « EduAnimauxion », « CommuniAnimauxion ») : à corriger lors de la reprise.
- Repérage des doublons trop grossier : deux opérations réellement identiques
  le même jour sont fusionnées. L'application doit les conserver toutes les deux.

## Étapes

- [x] **Étape 0** — Protéger le dépôt : les fichiers tableur et CSV ne peuvent
  pas être enregistrés dans Git.
- [x] **Étape 1** — Comprendre l'existant (ce document).
- [x] **Étape 2** — Base de données Supabase : comptes, postes et catégories,
  opérations, historique des imports ; accès réservé aux personnes autorisées.
- [x] **Étape 3** — Reprise de l'historique : charger les ~22 000 opérations et
  les paramètres depuis le classeur Excel, puis vérifier que les soldes sont
  identiques à ceux d'Excel.
- [x] **Étape 4** — Import des CSV Raiffeisen (compte courant + 2 cartes Visa) :
  reconnaissance du compte, écart des doublons, proposition de classement,
  écran de validation.
- [ ] **Étape 5** — Écrans d'analyse : synthèse des soldes, bilans par mois et
  par année, objectifs.
  - [x] Bilan par mois (fonction `bilan_par_mois`, écran « Bilan par mois »).
  - [ ] Bilan par années.
  - [x] Objectifs / prévisionnel (table `objectifs`, écran « Prév & Targets »).
  - [x] Soldes annuels (fonction `soldes_annuels`, écran « Soldes annuels »).
- [ ] **Étape 6** — Mise en ligne sur Netlify avec connexion obligatoire.
  En cours : site Netlify privé (équipe « Famille Giraud », compte familial),
  mis à jour à la main en glissant le dossier `dist` dans l'onglet Deploys.

## Questions ouvertes

- Classement automatique : proposer un poste à partir des opérations passées
  ayant un libellé similaire ? (à confirmer à l'étape 4)
- Faut-il garder toutes les analyses, ou certaines ne servent plus ?

## Décisions prises

- Accès : Sandrine et Marc uniquement. Un seul compte créé pour l'instant
  (ajout de Marc : issue #1). Inscriptions publiques désactivées.
- Reprise : 21 858 opérations, 54 comptes (dont 10 ouverts), 84 postes,
  16 catégories. Soldes identiques à la Synthèse Excel au centime près.
- Chaque opération garde sa date réelle et son mois de rattachement (celui des
  bilans Excel), ainsi que son titulaire (Joint / Perso SA / Perso MG).
- Les comptes fermés regroupés sous « Compte Fermé » dans Excel sont recréés
  un par un à partir de leur description ; des doublons de libellé restent
  possibles (à fusionner plus tard si besoin).
- Programmes de reprise : `scripts/reprise/` (les données restent hors du dépôt).

- Import : compte reconnu par l'IBAN ou le numéro de carte masqué ;
  opérations déjà présentes ignorées (y compris celles dont le libellé Excel
  avait été complété d'une note) ; une ligne sans poste bloque l'import.
- Classement proposé : règles des membres d'abord (ex. HESPERANGE → Garde
  d'enfants, à confirmer ; AMAZON / AMZN → toujours à classer), puis historique.
- Les notes sont séparées du libellé de la banque (le libellé n'est jamais
  modifié, pour garder la détection des doublons).
- Une opération peut être divisée en plusieurs postes ; le total doit tomber
  juste (contrôlé par la base). Les bilans comptent chaque part dans son poste
  (vue `v_lignes_analyse`).

- Bilan par mois : mois de rattachement ; une ligne par poste, sous-total par
  catégorie ; moyenne mensuelle = total ÷ 12 pour une année passée ; pour l'année
  en cours, moyenne des seuls mois terminés (le mois en cours n'est pas compté) ; la ligne « Résultat » exclut les Neutres
  (virements entre comptes), affichés à part ; les opérations sans poste
  apparaissent dans « À classer ». Totaux calculés dans la base (fonction
  `bilan_par_mois`).
- Prévisionnel : un objectif par poste, modifiable à tout moment.
  « Régulier » = N opérations par mois d'un montant habituel ; « variable » =
  un montant par mois ; chaque objectif peut ne concerner que certains mois
  (ex. impôts). Mois passés = réel ; mois en cours = réel + reste attendu
  (régulier : opérations encore attendues ; variable : objectif au prorata des
  jours restants, comptés jusqu'à la date du dernier import) ; mois suivants =
  objectif. Les objectifs sont pré-remplis à partir des 24 derniers mois
  (mois précis seulement si la dépense revient au même mois l'année d'avant) ;
  une pastille « à revoir » signale un objectif qui ne correspond plus aux
  12 derniers mois, sans jamais le modifier automatiquement.
- Prév & Targets, période affichée : « 12 mois glissants » par défaut (les
  6 mois avant le mois en cours, le mois en cours, les 5 mois suivants), ou
  « Année civile » (janvier à décembre de l'année en cours). Comparaison
  toujours avec le réel des mêmes 12 mois un an plus tôt (total et moyenne
  par mois), affichée tout à droite. Mois en cours sur fond jaune soutenu,
  mois suivants sur fond jaune très pâle.

- Soldes annuels (format de l'onglet Excel) : une ligne par type de compte
  (Courant = comptes courants + cartes + cash, Epargne, Retraite, Titres),
  le solde « au jour », puis pour chaque année la variation du solde (date
  réelle des opérations, comptes fermés inclus) ; années affichables au choix
  (par défaut depuis 2020).
- Corrections de données (session du 20/11/2026) : deux opérations Cash datées
  par erreur de 1982 remises en octobre 2024 (leur mois de rattachement) ;
  les comptes fermés qui gardaient quelques centimes (arrondis de la reprise)
  remis à zéro par une opération « Remise à zéro du solde (compte fermé) »
  classée en Neutres. Total général inchangé.

## Règles de travail

- Aucune donnée financière réelle dans le dépôt Git (fichiers Excel et CSV bloqués).
- Aucune modification de la base Supabase sans accord explicite.
- Aucun commit ni envoi sur GitHub sans accord explicite.
