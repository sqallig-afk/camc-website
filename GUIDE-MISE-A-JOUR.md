# CAMC Compendium — Guide complet

## Structure du site

```
📁 public_html/ (sur Hostinger)
├── index.html          ← Le site complet (NE PAS TOUCHER)
├── analyses.csv        ← Vos données (À ÉDITER)
└── photos/             ← Vos photos de tubes
    ├── tube-rouge.jpg
    ├── tube-violet.jpg
    ├── tube-bleu.jpg
    ├── tube-vert.jpg
    ├── tube-gris.jpg
    ├── pot-urines.jpg
    └── ...
```

## Les pages du site

### Page d'accueil
Présentation du labo avec :
- Description / texte d'accueil
- Horaires d'ouverture
- Adresse + lien Google Maps
- Téléphone + bouton WhatsApp
- Barre de recherche rapide

**Pour personnaliser** : ouvrez index.html et cherchez les commentaires
`PERSONNALISEZ ICI` — changez le texte directement.

### Page Compendium
Catalogue complet avec recherche et filtres par département.

### Fiche détaillée (modale)
Au clic sur une analyse, deux vues :

- **Vue Patient** : nom simplifié, jeûne oui/non, délai, conditions importantes
- **Vue Médecin** : toutes les infos techniques (tube, volume, méthode, valeurs de référence, etc.)

## Colonnes du CSV

| Colonne       | Pour qui     | Description                          | Exemple                    |
|---------------|-------------|--------------------------------------|----------------------------|
| code          | Médecin     | Code court                           | GLU                        |
| nom           | Médecin     | Nom technique complet                | Glucose (Glycémie)         |
| **nom_patient** | **Patient** | **Nom en langage simple**           | **Analyse du sucre dans le sang** |
| departement   | Les deux    | Département du labo                  | Chimie                     |
| echantillon   | Médecin     | Type d'échantillon                   | Sang veineux               |
| tube          | Médecin     | Type de tube                         | Sec (rouge)                |
| couleur_tube  | Les deux    | Couleur du point coloré              | rouge                      |
| volume        | Médecin     | Volume requis                        | 5 mL                       |
| **jeune**     | **Patient** | **Faut-il être à jeun ?**           | **Oui (12h)** ou **Non**  |
| conditions    | Les deux    | Conditions de prélèvement            | À jeun strict 12h          |
| conservation  | Médecin     | Conservation / transport             | T° ambiante 24h            |
| delai         | Les deux    | Délai de résultat                    | 4h                         |
| methode       | Médecin     | Méthode analytique                   | Enzymatique                |
| valeurs_ref   | Médecin     | Valeurs de référence                 | 0.70 – 1.10 g/L           |
| interet       | Médecin     | Intérêt clinique                     | Diagnostic du diabète      |
| remarques     | Médecin     | Remarques                            | Tube fluorure requis       |
| photo         | Les deux    | Nom du fichier photo                 | tube-rouge.jpg             |

### Version simplifiée (recommandée pour démarrer)

Si vous trouvez le CSV “trop lourd”, vous pouvez démarrer avec une feuille beaucoup plus simple (et compléter plus tard). Le site accepte des colonnes manquantes tant que vous avez au minimum:

- `code`
- `nom`
- `departement`

Template minimal prêt:

- `analyses_minimal_template.csv`

## Ajouter / modifier / supprimer une analyse

1. Ouvrez `analyses.csv` avec Excel ou Google Sheets
2. Ajoutez / modifiez / supprimez des lignes
3. Sauvegardez en CSV
4. Re-uploadez sur Hostinger (File Manager → public_html)

## Photos

1. Prenez vos photos (fond neutre, 400-800px de large, JPG ou PNG)
2. Uploadez dans le dossier `photos/` sur Hostinger
3. Dans le CSV, colonne `photo` = nom du fichier

Astuce : une même photo peut servir pour plusieurs analyses (ex: tube-rouge.jpg pour toutes les analyses sur tube sec).

## Valeurs possibles

**couleur_tube** : rouge, violet, bleu, vert, gris, jaune, orange

**departement** : Chimie, Hématologie, Microbiologie, Immunologie, Hormonologie

**jeune** : `Oui (12h)` ou `Oui (8-12h)` ou `Oui (préférable)` ou `Non`

## Règles

- NE supprimez JAMAIS la 1ère ligne du CSV (en-têtes)
- Évitez les virgules dans les textes (utilisez / à la place)
- Sauvegardez toujours en format CSV (pas .xlsx)
- Le fichier doit s'appeler `analyses.csv`

## Tester en local (avant upload)

Le compendium charge `analyses.csv` via `fetch()`, donc il faut ouvrir le site via un petit serveur web (pas en double-cliquant sur le fichier en `file://`).

Depuis ce dossier :

```bash
python3 -m http.server 8000
```

Puis ouvrez `http://localhost:8000/` dans votre navigateur.

## Actualités (optionnel)

Vous pouvez afficher une section **Actualités** sur la page d’accueil via le fichier `actualites.json` (dans le même dossier que `index.html`).

Format :

- `date` : `YYYY-MM-DD`
- `title` : titre
- `summary` : résumé
- `url` : lien (laisser vide pour un item non cliquable)

### Actualités via Google Sheets (recommande)

Vous pouvez aussi brancher une feuille Google Sheets publiee en CSV:

1. Ouvrez votre Google Sheet d'actualites.
2. `Fichier` -> `Partager` -> `Publier sur le Web`.
3. Publiez l'onglet en format `CSV`.
4. Copiez le lien `.../pub?output=csv`.
5. Dans `index.html`, renseignez:
   - `ACTUALITES_URL` (lien CSV publie)
   - `ACTUALITES_EDIT_URL` (lien d'edition du sheet, optionnel)

Colonnes conseillees:

- `date` (`YYYY-MM-DD`)
- `title`
- `summary`
- `url`
- `category`
- `image` (optionnel)

Template pret: `actualites_template.csv`

## Fiches labo (nouvelle page)

La page `Fiches Labo` peut etre alimentee:

- soit par `fiches_labo.json` (local),
- soit par Google Sheets CSV.

Dans `index.html`, renseignez:

- `FICHES_LABO_URL` (CSV publie)
- `FICHES_EDIT_URL` (lien d'edition, optionnel)

Colonnes conseillees:

- `updated_at` (`YYYY-MM-DD`)
- `title`
- `category`
- `summary`
- `url` (page web)
- `download_url` (PDF, DOC, etc.)

Template pret: `fiches_labo_template.csv`

## Alternative "Excel en ligne" (mise a jour automatique)

Si vous voulez editer les analyses dans une interface type Excel, et que le site se mette a jour automatiquement, le plus simple est d'utiliser **Google Sheets** comme source, publiee en **CSV**.

Template pret a importer:

- `analyses_template.xlsx` (recommande): onglet `analyses` + onglet `listes` (valeurs proposees)
- `analyses_template.csv` (minimal): uniquement les entetes

1. Importez `analyses.csv` dans Google Sheets (en gardant la 1ere ligne d'entetes).
   - Alternative: importez `analyses_template.xlsx` si vous repartez de zero.
2. Dans Google Sheets: `Fichier` -> `Partager` -> `Publier sur le Web`.
3. Choisissez la feuille, puis format `CSV`, puis publiez.
4. Copiez le lien CSV publie (il ressemble a `.../pub?output=csv`).
5. Dans `index.html`, remplacez la variable `ANALYSES_URL` par ce lien.

Notes:
- La feuille doit etre **publiee** (lecture publique) pour que le navigateur puisse la charger.
- Les changements dans Google Sheets se refleteront sur le site apres rafraichissement (parfois avec un leger delai de cache).
- Si le CSV Google est vide/invalide, le site bascule automatiquement sur `analyses.csv` local.

## Remplissage initial par scraping (Mayo)

Pour gagner du temps, vous pouvez pre-remplir un CSV avec les fiches du catalogue Mayo, puis corriger le texte, les tubes et les delais selon votre labo.

Script fourni:

- `scripts/scrape_mayo_catalog.py`

Exemple:

```bash
python3 scripts/scrape_mayo_catalog.py --max-tests 300 --output analyses_scraped_mayo.csv
```

Ensuite:

1. Ouvrez `analyses_scraped_mayo.csv` dans Google Sheets.
2. Corrigez/normalisez les champs locaux (`tube`, `couleur_tube`, `jeune`, `delai`, `photo`, etc.).
3. Exportez en CSV final et remplacez `analyses.csv` (ou utilisez votre lien `ANALYSES_URL` Google Sheets).

Important:

- Le scraping sert de base de travail, pas de verite finale pour votre laboratoire.
- Verifiez les conditions de reutilisation des contenus des sites sources.

## Remplissage initial par scraping (CHU Unilab - mode test)

Un script CHU est disponible et fonctionne sans scraper tout le site d'un coup.

- `scripts/scrape_chu_unilab.py`

Test rapide (10 analyses):

```bash
python3 scripts/scrape_chu_unilab.py --max-tests 10 --letters A --with-details --output analyses_scraped_chu_test.csv
```

Puis importez `analyses_scraped_chu_test.csv` dans votre Google Sheet pour verifier le mapping.
