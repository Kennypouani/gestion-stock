# Gestion de stock multi-boutiques

Application web de gestion commerciale pour un réseau de boutiques : catalogue produits,
passages en caisse, mouvements de stock, commandes fournisseurs, statistiques et exports —
avec **cloisonnement strict des données par boutique** et trois niveaux de droits.

> Projet personnel full-stack — backend Node.js/Express + SQLite, interface React/Vite.
> Fonctionne en local (auto-hébergeable), sans service externe.

---

## Fonctionnalités

- **Catalogue produits** — création, modification, suppression, seuil d'alerte, date de
  péremption, code-barres, prix d'achat / prix de vente.
- **Caisse** — saisie des ventes multi-lignes, calcul du total côté serveur (jamais côté client),
  génération du ticket, décrémentation automatique du stock.
- **Mouvements de stock** — entrées (réapprovisionnement) et sorties, avec motif et historique.
- **Tableau de bord** — chiffre d'affaires du jour, valeur du stock, produits en rupture,
  produits périmés ou proches de la péremption.
- **Fournisseurs & commandes** — répertoire fournisseurs, bons de commande et réception.
- **Exports CSV** — export du stock et du journal d'audit.
- **Journal d'audit** — chaque modification sensible est tracée : qui, quand, quel produit,
  ancienne et nouvelle valeur (noms recopiés pour rester lisibles même après suppression d'un compte).
- **Sauvegardes automatiques** — copie de la base au démarrage puis toutes les 24 h, rotation
  sur les 7 dernières.
- **Gestion des comptes** — création, changement de rôle, activation/désactivation,
  changement de mot de passe.

## Rôles et isolation des données

| Rôle | Périmètre |
|---|---|
| **admin** | Tout le réseau : boutiques, comptes, fournisseurs, sauvegardes, exports |
| **gérant** | **Sa** boutique uniquement : produits, mouvements, caisse, stats, commandes |
| **employé** | Caisse et consultation du stock de **sa** boutique |

L'isolation n'est pas seulement visuelle : chaque requête est filtrée côté serveur par la
boutique de la session. Un gérant qui forge un `id` de produit ou de boutique appartenant à
une autre enseigne reçoit un `403` — comportement couvert par la suite de tests d'isolation.

## Stack

- **Backend** — Node.js, Express 4, SQLite via `node:sqlite` (aucun serveur de base à installer),
  `bcryptjs` (mots de passe hachés), `helmet`, `express-rate-limit`, sessions par cookie.
- **Frontend** — React 19, Vite 8, CSS natif (aucune librairie UI).
- **Tests** — deux suites d'intégration écrites en Node, sans framework : elles interrogent
  l'API réelle et vérifient les réponses.

## Prérequis

- **Node.js 22 ou plus** (le projet utilise le module natif `node:sqlite`)
- npm

## Installation

Deux terminaux sont nécessaires : le serveur et l'interface tournent en parallèle.

```bash
git clone https://github.com/Kennypouani/gestion-stock.git
cd gestion-stock
```

**Terminal 1 — API et base de données**

```bash
cd backend
npm install
npm start          # http://localhost:5000  (npm run dev = redémarrage automatique)
```

**Terminal 2 — interface**

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

Au **premier démarrage**, la base `stock.db` est créée automatiquement, avec la boutique,
les produits et trois comptes de démonstration (voir `backend/database.js`). Aucun fichier
de données n'est versionné : chaque clone repart d'une base neuve et identique.

| Compte de démonstration | Rôle |
|---|---|
| `admin@magasin.fr` | administrateur du réseau |
| `gerant@magasin.fr` | gérant de la boutique 1 |
| `awa@magasin.fr` | employé / caissier |

> Identifiants de démonstration générés par le script d'initialisation — à remplacer
> avant tout usage réel.

## Tests

Serveur lancé, dans `backend/` :

```bash
node tests/integration-modules.js     # 86 contrôles : auth, produits, ventes, stats, commandes…
node tests/integration-isolation.js   # 68 contrôles : cloisonnement entre boutiques et rôles
```

Les deux suites affichent un récapitulatif `X réussis / Y échoués` et sortent en code non nul
en cas d'échec. Elles constituent le filet de sécurité du projet : l'isolation multi-boutiques
et les règles de droits y sont vérifiées de bout en bout, pas seulement en unitaire.

## Structure du projet

```
gestion-stock/
├── backend/
│   ├── server.js            # démarrage, middlewares, montage des routes
│   ├── database.js          # schéma SQLite + jeu de données initial
│   ├── auth.js              # sessions, hachage, middlewares de rôle
│   ├── journal.js           # journal d'audit
│   ├── sauvegarde.js        # sauvegardes automatiques (24 h, rotation)
│   ├── routes/              # 11 modules : produits, ventes, mouvements, stats,
│   │                        #   auth, utilisateurs, fournisseurs, commandes,
│   │                        #   export, sauvegardes, boutiques
│   └── tests/               # 2 suites d'intégration
└── frontend/
    └── src/
        ├── api.js           # client HTTP centralisé
        └── components/      # Connexion, TableauDeBord, Produits, Caisse,
                             #   Mouvements, Fournisseurs, EspaceAdmin…
```

## API

Toutes les routes sont préfixées par `/api`. Les routes protégées exigent une session valide,
et les routes sensibles un rôle précis.

| Module | Exemples |
|---|---|
| `auth` | `POST /auth/connexion`, `POST /auth/deconnexion`, `GET /auth/moi` |
| `produits` | `GET /produits`, `POST /produits`, `PUT /produits/:id` |
| `ventes` | `POST /ventes` (ticket), `GET /ventes` |
| `mouvements` | `POST /mouvements`, `GET /mouvements` *(admin, gérant)* |
| `stats` | `GET /stats` — CA, valeur du stock, alertes *(admin, gérant)* |
| `fournisseurs` / `commandes` | CRUD et bons de commande *(admin, gérant)* |
| `export` | `GET /export/produits`, `GET /export/journal` (CSV) |
| `utilisateurs` / `sauvegardes` / `boutiques` | administration |

## Limites connues

- Application **auto-hébergée** : pas de déploiement public ni de démonstration en ligne.
- SQLite en fichier local — adapté à une ou quelques boutiques, pas à une montée en charge massive.
- Pas encore de CI : les tests s'exécutent manuellement.
- Express 4 volontairement conservé (la migration vers Express 5 demande une réécriture des routes).

## Auteur

**Kenny Pouani** — [github.com/Kennypouani](https://github.com/Kennypouani)

Projet réalisé pour concevoir et mettre en œuvre une application de gestion complète :
modélisation des données, API REST, authentification et permissions, interface React,
et vérification par tests automatisés.
