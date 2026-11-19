// ============================================================
// PARCOURS E2E — de l'inscription au ticket de caisse, puis
// sauvegarde et restauration.
//
// 3 scénarios, dans l'ordre (ils partagent la même base jetable) :
//   1. Un compte neuf s'inscrit, se connecte et ne voit QUE le
//      formulaire de création de boutique (aucune donnée d'autrui).
//   2. Le gérant encaisse le panier de référence : 2 × Eau à 0,55
//      avec une remise de 0,10 et 5,00 versés → ticket 1,00, monnaie
//      4,00, stock 102 → 100.
//   3. L'admin sauvegarde, supprime un produit, puis restaure le
//      fichier : le produit supprimé revient, les données de la
//      boutique sont bien remplacées.
//
// Lancement : npm run test:e2e   (dans frontend/)
// ============================================================

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { demarrer } from './harnais.js';

test.describe.configure({ mode: 'serial' });

let serveurs;
let base;

test.beforeAll(async () => {
  serveurs = await demarrer();
  base = serveurs.baseUrl;
});

test.afterAll(async () => {
  if (serveurs) await serveurs.arreter();
});

test.beforeEach(async ({ page }) => {
  // Les suppressions et la restauration demandent confirmation.
  page.on('dialog', (boite) => boite.accept());
  await page.goto(base);
});

// Accès au champ situé sous un libellé non lié (markup : <div class="champ">
// <label>…</label><input></div>, sans for/id).
const champ = (page, libelle) =>
  page.locator('.champ').filter({ hasText: libelle }).locator('input, select');

async function connexionAdmin(page) {
  await page.getByRole('button', { name: /Administrateur — admin@magasin\.fr/ }).click();
  await page.getByRole('button', { name: '🔑 Se connecter' }).click();
  await expect(page.getByRole('button', { name: '🧾 Caisse', exact: true })).toBeVisible();
}

test('1. Un compte neuf crée sa boutique avant tout accès', async ({ page }) => {
  const email = `e2e-${Date.now()}@test.fr`;
  const motDePasse = 'Boutique2026!';

  // --- Inscription ---
  await page.getByRole('link', { name: /Créer un compte administrateur/ }).click();
  await page.locator('input[name="nom"]').fill('Compte E2E');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="mot_de_passe"]').fill(motDePasse);
  await page.locator('input[name="confirmation"]').fill(motDePasse);
  await page.getByRole('button', { name: /Créer mon compte/ }).click();

  await expect(page.locator('.message-succes')).toContainText('Compte administrateur créé');

  // --- Première connexion : uniquement la création de boutique ---
  await page.locator('input[placeholder="exemple@magasin.fr"]').fill(email);
  await page.locator('input[type="password"]').fill(motDePasse);
  await page.getByRole('button', { name: '🔑 Se connecter' }).click();

  await expect(page.getByRole('heading', { name: /Créez votre boutique/ })).toBeVisible();
  // Aucun onglet métier n'est accessible tant que la boutique n'existe pas
  await expect(page.getByRole('button', { name: '🧾 Caisse', exact: true })).toHaveCount(0);

  // --- Création de la boutique (numéro de ticket laissé vide) ---
  await page.locator('input[name="nom"]').fill('Boutique E2E');
  await page.locator('input[name="ville"]').fill('Abidjan');
  await page.locator('input[name="quartier"]').fill('Cocody');
  await page.locator('input[name="telephone"]').fill('+225 07 00 00 00 00');
  await page.getByRole('button', { name: /Créer ma boutique/ }).click();

  // Bulle d'avertissement : le numéro sera attribué automatiquement
  await expect(page.getByRole('heading', { name: /Numéro de ticket non renseigné/ })).toBeVisible();
  await page.getByRole('button', { name: /✅ Enregistrer/ }).click();

  // --- L'application s'ouvre, avec SA boutique et son code ---
  await expect(page.getByRole('button', { name: '📊 Tableau de bord', exact: true })).toBeVisible();
  await expect(page.locator('.info-utilisateur')).toContainText('ADMIN');

  await page.getByRole('button', { name: '🏪 Boutiques', exact: true }).click();
  await expect(page.getByText('🏪 Mes boutiques (1)')).toBeVisible();
  const ligne = page.getByRole('row', { name: /Boutique E2E/ });
  await expect(ligne).toBeVisible();
  // Le code ticket attribué automatiquement (ex. A7K2P9) apparaît dans la ligne
  await expect(ligne).toContainText(/[A-Z0-9]{4,10}/);
});

test('2. Le panier de référence s’encaisse et décrémente le stock', async ({ page }) => {
  await connexionAdmin(page);

  await page.getByRole('button', { name: '🧾 Caisse', exact: true }).click();
  await page.getByPlaceholder('🔍 Nom ou code-barres…').fill('Eau');

  const eau = page.getByRole('button', { name: /Eau minérale 1L/ });
  await eau.click();
  await eau.click();
  await expect(page.locator('.saisie-quantite')).toHaveValue('2');

  // Remise 0,10 puis 5,00 versés (montant pré-rempli = total)
  await champ(page, 'Remise (FCFA)').fill('0.1');
  await champ(page, 'Montant versé (FCFA)').fill('5');
  await page.getByRole('button', { name: /Encaisser .* FCFA/ }).click();

  // --- Ticket affiché ---
  const ticket = page.locator('.modale-ticket');
  await expect(ticket).toBeVisible();
  await expect(ticket.getByRole('heading')).toContainText(/TK-\d{4}-\d{4}/);
  await expect(ticket).toContainText('Eau minérale 1L');
  await expect(ticket.locator('.ticket-total')).toContainText('1 FCFA');
  await expect(ticket).toContainText('Monnaie rendue');
  await expect(ticket).toContainText('4 FCFA');
  await page.getByRole('button', { name: 'Fermer' }).click();

  // --- Stock décrémenté de 2 (102 → 100) ---
  await page.getByRole('button', { name: '📦 Produits', exact: true }).click();
  await page.getByPlaceholder('🔍 Rechercher un produit ou un code-barres…').fill('Eau');
  const ligneEau = page.getByRole('row', { name: /Eau minérale 1L/ });
  await expect(ligneEau).toBeVisible();
  await expect(ligneEau).toContainText('100');
});

test('3. La sauvegarde restaure les données remplacées', async ({ page }) => {
  await connexionAdmin(page);

  // --- Sauvegarde de référence (4 produits) ---
  await page.getByRole('button', { name: '👥 Comptes', exact: true }).click();
  await page.getByRole('button', { name: /Créer une sauvegarde/ }).click();
  await expect(page.locator('.message-succes')).toContainText('Sauvegarde');

  const lien = page.getByRole('link', { name: /Télécharger/ }).first();
  const [telechargement] = await Promise.all([page.waitForEvent('download'), lien.click()]);
  const fichier = path.join(os.tmpdir(), `sauvegarde-e2e-${Date.now()}.json`);
  await telechargement.saveAs(fichier);

  const contenu = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  const texte = JSON.stringify(contenu);
  expect(texte).toContain('Eau minérale 1L');
  expect(texte).toContain('Pain de mie');

  // --- On casse volontairement les données : suppression d'un produit ---
  await page.getByRole('button', { name: '📦 Produits', exact: true }).click();
  const recherche = page.getByPlaceholder('🔍 Rechercher un produit ou un code-barres…');
  await recherche.fill('Pain');
  const lignePain = page.getByRole('row', { name: /Pain de mie/ });
  await expect(lignePain).toBeVisible();
  await lignePain.getByRole('button', { name: '🗑️' }).click();
  await expect(lignePain).toHaveCount(0);

  // --- Restauration du fichier : le produit revient ---
  await page.getByRole('button', { name: '👥 Comptes', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(fichier);

  await expect(page.locator('.message-succes')).toContainText('Restauration terminée');
  await expect(page.locator('.message-succes')).toContainText('4 produit(s)');

  await page.getByRole('button', { name: '📦 Produits', exact: true }).click();
  await page.getByPlaceholder('🔍 Rechercher un produit ou un code-barres…').fill('Pain');
  await expect(page.getByRole('row', { name: /Pain de mie/ })).toBeVisible();

  fs.rmSync(fichier, { force: true });
});
