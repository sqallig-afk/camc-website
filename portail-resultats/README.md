# Portail Resultats CAMC (separe du site principal)

Portail prive pour:
- consultation des protocoles/resultats par patient
- conversation patient <-> biologiste par protocole

## Demarrage local

```bash
cd portail-resultats
node server.js
```

Raccourcis double-clic (macOS):
- `start-portail.command`: lance le portail en arriere-plan (daemon), memorise son PID et ouvre l'admin
- `stop-portail.command`: stoppe le portail via PID + ports de test (8085/8091/8092/8093/8094)
- logs demarrage: `data/portail.log`

Puis ouvrir:
- Patient: `http://127.0.0.1:8085/`
- Biologiste: `http://127.0.0.1:8085/biologiste.html`
- Admin: integre dans `biologiste.html` (onglet `Administration`)
- URL legacy: `http://127.0.0.1:8085/admin.html` redirige vers `biologiste.html#admin`

## Stockage SQLite

- Base active: `data/portail.db`
- Au premier lancement, si la DB est vide et `data/store.json` existe, le serveur injecte automatiquement ce JSON.
- Ensuite, le serveur lit/ecrit uniquement dans SQLite.

## Comptes de demo

- Patient telephone: `0612345678`
- Date de naissance: `1990-04-15`

- Biologiste login: `biologiste`
- Mot de passe: `ChangeMe-2026`

## Utilisation admin (web)

- Se connecter sur `/biologiste.html` avec le compte biologiste
- Ouvrir l'onglet `Administration`
- Ajouter des patients (nom, telephone, date naissance)
- Ajouter des protocoles (patient, titre, date, URL PDF, statut)
- La liste patients/protocoles se met a jour directement depuis SQLite

## Reseed manuel

Depuis `data/store.json` vers SQLite:

```bash
node scripts/seed-db.js --reset
```

Depuis un autre fichier JSON:

```bash
node scripts/seed-db.js --reset --source /chemin/vers/store.json
```

## Sauvegarde et restauration

Sauvegarde rapide:

```bash
cp data/portail.db data/portail.backup.db
```

Restauration:

```bash
cp data/portail.backup.db data/portail.db
```

## Notes de production

- Changer les identifiants de demo
- Ne jamais exposer `data/` publiquement
- Activer HTTPS, journalisation, et politique de retention
- Integrer une authentification forte (2FA) cote biologiste
