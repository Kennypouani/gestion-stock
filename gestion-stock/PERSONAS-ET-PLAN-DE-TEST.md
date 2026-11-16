# Personas et plan de test manuel — Gestion de stock supermarché

Objectif : vérifier « à la main », en 20 minutes et avec des valeurs chiffrées,
que les modules les plus importants fonctionnent réellement.

- API : `http://localhost:5000/api` (démarrer avec `cd backend && node server.js`)
- Interface : `http://localhost:3000` (démarrer avec `cd frontend && npm run dev`)
- Réseau de test : **Magasin principal** (code `MP`, id 1) et **Boutique Nord** (code `NORD`, id 2)
- Les 4 comptes ci-dessous existent déjà en base (vérifiés le 16/11/2026) : rien à créer.

---

## 1. Les personas

| # | Persona | Identifiant | Mot de passe | Rôle | Périmètre | Onglets visibles | Ce qu'il doit prouver |
|---|---------|-------------|--------------|------|-----------|------------------|------------------------|
| P1 | **Nadia Bamba**, administratrice du réseau | `admin@magasin.fr` | `admin123` | admin | Tout le réseau (aucune boutique) | Tableau de bord, Produits, Mouvements, Caisse, Fournisseurs, **Comptes** | Voit les 2 boutiques, gère les comptes, lance les sauvegardes |
| P2 | **Karim Kouassi**, gérant du Magasin principal | `gerant@magasin.fr` | `gerant123` | gérant | Boutique `MP` seulement | Tableau de bord, Produits, Mouvements, Caisse, Fournisseurs | Gère SON stock, ne voit jamais `NORD`, pas d'onglet Comptes |
| P3 | **Awa Diallo**, caissière du Magasin principal | `awa@magasin.fr` | `employe123` | employé | Boutique `MP` seulement | Caisse, Produits (lecture) | Encaisse, ne modifie ni produit ni prix, pas de stats |
| P4 | **Ibrahim Traoré**, gérant de la Boutique Nord | `gerant-nord@test.fr` | `Nord12345` | gérant | Boutique `NORD` seulement | Tableau de bord, Produits, Mouvements, Caisse, Fournisseurs | Isolation inverse : ne voit jamais `MP` |

**Règle d'or à vérifier avec P2/P3/P4 :** changer de persona ne doit jamais
faire apparaître les données de l'autre boutique, y compris en saisissant une
URL ou un identifiant d'article de l'autre magasin.

---

## 2. Valeurs de test à utiliser

### Catalogue existant (Magasin principal)

| Produit | Catégorie | Prix vente | Stock de départ | Seuil |
|---|---|---|---|---|
| Eau minérale 1L | Boissons | 0,55 | 102 | 10 |
| Pain de mie | Boulangerie | 1,00 | 31 | 8 |
| Yaourt nature | Frais | 0,75 | 60 | 10 |
| Riz blanc 1kg | Épicerie | 1,20 | 76 | 10 |

Boutique Nord : `TEST Produit Nord`, 2,00, stock 24.

### Scénario de caisse de référence (persona P3)

Panier : **2 × Eau minérale 1L**
Remise : **0,10** — Paiement : **espèces** — Montant versé : **5,00**

Attendu : sous-total **1,10** → total **1,00** → monnaie **4,00** (montants en FCFA, l'unité affichée dans l'interface),
ticket `TK-2026-XXXX`, stock de l'eau décrémenté de **2** (102 → 100).

### Valeurs à créer pendant le test (persona P2, sauf le fournisseur : P1)

| Élément | Valeurs exactes | Attendu |
|---|---|---|
| Produit | `Jus d'orange 1L`, Boissons, achat 0,40, vente 0,80, quantité 24, seuil 6, code-barres `6001240100097` | Créé dans MP uniquement |
| Mouvement | entrée `+12`, motif `Livraison test` | Stock 24 → 36, ligne dans l'historique |
| Fournisseur | `Laiterie du Nord`, contact `Mariam Koné`, `commandes@laiterie-nord.fr` | Créé, actif |
| Commande | 10 × Eau minérale à 0,20, notes `Livraison hebdomadaire` | `CMD-2026-XXXX`, total **2,00**, statut « en attente » |
| Expiration | Yaourt à **J+3**, Pain à **J+1**, puis produit `Test périmé` à **J−5** | Alertes « bientôt » = 2, « périmés » = 1 |

### Valeurs volontairement invalides (doivent TOUTES être refusées)

| Saisie | Code attendu |
|---|---|
| Panier vide / quantité 0 | 400 |
| Vente de 9 999 unités d'eau | 409 |
| Remise 9 999 sur un panier de 1,10 | 400 |
| Montant versé 0,01 pour un total de 1,10 | 400 |
| Mot de passe de 5 caractères | 400 |
| Email `pas-un-email` sur un fournisseur | 400 |
| Gérant créé sans boutique (P1) | 400 |

---

## 3. Liste courte de tests (18 vérifications)

À faire dans cet ordre ; chaque ligne = 1 action + 1 résultat attendu.

### A. Connexion et rôles — 3 tests

| # | Persona | Action | Attendu |
|---|---------|--------|---------|
| 1 | P3 | Se connecter | Badge « EMPLOYÉ · Magasin principal », 2 onglets seulement (Caisse, Produits) |
| 2 | P2 | Se connecter | Badge « GÉRANT · Magasin principal », 5 onglets, **aucun** onglet Comptes |
| 3 | P1 | Se connecter | Badge « ADMIN », 6 onglets dont Comptes ; le tableau de bord additionne les 2 boutiques |

### B. Caisse — 4 tests

| # | Persona | Action | Attendu |
|---|---------|--------|---------|
| 4 | P3 | Encaisser le scénario de référence (2 × Eau, remise 0,10, versé 5,00) | Total 1,00, monnaie 4,00, ticket `TK-2026-XXXX` affiché |
| 5 | P3 | Vérifier le stock dans Produits | Eau minérale : 102 → **100** |
| 6 | P3 | Tenter une vente de 9 999 unités | Message de refus (stock insuffisant), aucune vente créée |
| 7 | P3 | Vendre 1 Pain par carte (sans montant versé) | Vente acceptée, monnaie vide (carte) |

### C. Produits, stock et traçabilité — 3 tests

| # | Persona | Action | Attendu |
|---|---------|--------|---------|
| 8 | P2 | Créer `Jus d'orange 1L` avec les valeurs du tableau | Produit visible dans la liste, prix/code-barres exacts |
| 9 | P2 | Enregistrer le mouvement entrée +12 puis ouvrir l'historique | Stock 24 → 36, ligne « entrée » avec auteur = Karim Kouassi |
| 10 | P3 | Ouvrir Produits et tenter de modifier un prix | Boutons d'édition absents ; si l'appel API est forcé → **403** |

### D. Isolation multi-boutiques (le test le plus important) — 3 tests

| # | Persona | Action | Attendu |
|---|---------|--------|---------|
| 11 | P2 | Chercher `TEST Produit Nord` dans Produits | Introuvable ; URL directe de l'article Nord → **404** |
| 12 | P4 | Se connecter, ouvrir Produits et le tableau de bord | Uniquement `TEST Produit Nord` (et ses produits) ; aucun produit du Magasin principal |
| 13 | P1 | Ouvrir Produits et chercher successivement `Eau minérale` puis `TEST Produit Nord` | Les 2 catalogues visibles dans une seule liste consolidée (l'admin n'a pas de sélecteur de boutique) |

### E. Fournisseurs et commandes — 2 tests

| # | Persona | Action | Attendu |
|---|---------|--------|---------|
| 14 | P1 | Créer le fournisseur `Laiterie du Nord` avec les valeurs du tableau (création réservée à l'admin) | Créé, actif ; le recréer en minuscules → refus doublon (409) |
| 15 | P2 | Commander 10 × Eau à 0,20 puis passer « en attente » → « envoyée » → « reçue » | Total 2,00 ; réception impossible sans envoi préalable ; stock +10 et prix d'achat = 0,20 |

### F. Tableau de bord et alertes d'expiration — 1 test

| # | Persona | Action | Attendu |
|---|---------|--------|---------|
| 16 | P2 | Mettre Yaourt à J+3, Pain à J+1, créer `Test périmé` à J−5, ouvrir le tableau de bord | 2 produits « bientôt périmés », 1 « périmé », liste triée du plus urgent au moins urgent, CA du jour non nul |

### G. Comptes et sauvegardes (admin) — 2 tests

| # | Persona | Action | Attendu |
|---|---------|--------|---------|
| 17 | P1 | Créer un compte `Test Caissier` (`test.caissier@magasin.fr`, `Test1234`, rôle employé, boutique MP) | Compte créé et rattaché à MP ; se connecter avec → 2 onglets ; le désactiver → connexion refusée |
| 18 | P1 | Lancer une sauvegarde depuis Comptes | Fichier `.db` listé, taille > 0, téléchargeable ; un gérant ou un employé n'y a pas accès (**403**) |

---

## 4. Remise en état après le test manuel

1. Supprimer `Jus d'orange 1L`, `Test périmé`, le compte `Test Caissier`.
2. Remettre l'Eau minérale à **102** unités et le prix d'achat à **0,25**.
3. Vider les dates d'expiration du Yaourt et du Pain.
4. Archiver le fournisseur `Laiterie du Nord` (jamais le supprimer : une commande reçue reste traçable).
5. Optionnel : `DELETE FROM sessions;` (ou redémarrer le serveur) pour fermer les sessions de test.

Pour un retour à un état 100 % propre : `cd backend && node tests/integration-modules.js`
puis `node tests/integration-isolation.js` — les deux scripts nettoient leurs données.

---

## 5. Ce qui est déjà couvert par l'automatisation

Les deux suites du dossier `backend/tests/` ont été exécutées le 16/11/2026 :
**86/86** (modules : caisse, expirations, export CSV, fournisseurs/commandes,
sauvegardes, mot de passe, droits employé) et **68/68** (isolation
multi-boutiques). La liste ci-dessus ne rejoue donc que **le parcours visible
dans l'interface** : elle sert à vérifier l'affichage, les libellés et
l'enchaînement des écrans, pas la logique serveur déjà prouvée.
