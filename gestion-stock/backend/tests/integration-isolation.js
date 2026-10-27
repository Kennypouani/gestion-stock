// ============================================================
// TESTS D'ISOLATION MULTI-BOUTIQUES — le test de sécurité n°1
//
// Vérifie qu'un gérant / un employé ne voit, ne modifie et ne
// crée JAMAIS rien hors de SA boutique, et que l'admin voit tout.
//
// Prérequis : serveur backend lancé (node server.js)
// Lancement :  node tests/integration-isolation.js
// Sortie :     code 0 si tout passe, code 1 sinon
// Fixtures réutilisées d'une exécution à l'autre :
//   • Boutique « Boutique Nord (test) » (code NORD)
//   • Compte gerant-nord@test.fr
//   • Produit « TEST Produit Nord »
// ============================================================

const BASE = 'http://localhost:5000/api';
let ok = 0;
let ko = 0;

const verifie = (label, condition, detail = '') => {
  if (condition) { ok++; console.log(`  ✅ ${label}`); }
  else { ko++; console.log(`  ❌ ${label} ${detail}`); }
};

async function requete(url, options = {}) {
  const r = await fetch(`${BASE}${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...options.headers },
  });
  const corps = await r.json().catch(() => null);
  if (r.status === 429) {
    throw new Error(`Limiteur de débit atteint sur ${options.method || 'GET'} ${url} — redémarrez le serveur`);
  }
  return { statut: r.status, corps, cookie: r.headers.get('set-cookie') || '' };
}

const J = (cookie) => ({ Cookie: String(cookie).split(';')[0] });

const CODE_NORD = 'NORD';
const NOM_BOUTIQUE_NORD = 'Boutique Nord (test)';
const EMAIL_GERANT_NORD = 'gerant-nord@test.fr';
const MDP_GERANT_NORD = 'Nord12345';
const NOM_PRODUIT_NORD = 'TEST Produit Nord';

(async () => {
  // ============================================================
  console.log('\n===== CONNEXIONS =====');
  // ============================================================
  const adm = await requete('/auth/connexion', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@magasin.fr', mot_de_passe: 'admin123' }),
  });
  const gerantA = await requete('/auth/connexion', {
    method: 'POST',
    body: JSON.stringify({ email: 'gerant@magasin.fr', mot_de_passe: 'gerant123' }),
  });
  const emp = await requete('/auth/connexion', {
    method: 'POST',
    body: JSON.stringify({ email: 'awa@magasin.fr', mot_de_passe: 'employe123' }),
  });

  const A = J(adm.cookie);   // admin du réseau
  const GA = J(gerantA.cookie); // gérant de la boutique 1
  const E = J(emp.cookie);      // caissier de la boutique 1

  verifie('Connexion admin', adm.statut === 200, `→ ${adm.statut}`);
  verifie('Connexion gérant (boutique 1)', gerantA.statut === 200, `→ ${gerantA.statut}`);
  verifie('Connexion caissier (boutique 1)', emp.statut === 200, `→ ${emp.statut}`);

  // ============================================================
  console.log('\n===== PRÉPARATION DES FIXTURES =====');
  // ============================================================

  // --- Boutique de test Nord ---
  let boutiques = (await requete('/boutiques', { headers: A })).corps || [];
  let nord = boutiques.find((b) => b.code === CODE_NORD);
  if (!nord) {
    const cree = await requete('/boutiques', {
      method: 'POST',
      headers: A,
      body: JSON.stringify({ nom: NOM_BOUTIQUE_NORD, code: CODE_NORD, adresse: 'Quartier Nord' }),
    });
    verifie('Boutique Nord créée (201)', cree.statut === 201, `→ ${cree.statut} ${JSON.stringify(cree.corps)}`);
    nord = cree.corps;
  } else {
    verifie('Boutique Nord réutilisée', true);
  }

  // --- Compte gérant de la boutique Nord ---
  let comptes = (await requete('/utilisateurs', { headers: A })).corps || [];
  let gerantNord = comptes.find((u) => u.email === EMAIL_GERANT_NORD);
  if (!gerantNord) {
    const cree = await requete('/utilisateurs', {
      method: 'POST',
      headers: A,
      body: JSON.stringify({
        nom: 'Gérant Nord',
        email: EMAIL_GERANT_NORD,
        mot_de_passe: MDP_GERANT_NORD,
        role: 'gerant',
        boutique_id: nord.id,
      }),
    });
    verifie('Compte gérant Nord créé (201)', cree.statut === 201, `→ ${cree.statut} ${JSON.stringify(cree.corps)}`);
    gerantNord = cree.corps;
  } else {
    if (gerantNord.actif !== 1) {
      await requete(`/utilisateurs/${gerantNord.id}`, {
        method: 'PUT', headers: A, body: JSON.stringify({ actif: true }),
      });
    }
    verifie('Compte gérant Nord réutilisé', true);
  }

  const gnb = await requete('/auth/connexion', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL_GERANT_NORD, mot_de_passe: MDP_GERANT_NORD }),
  });
  verifie('Connexion gérant Nord', gnb.statut === 200, `→ ${gnb.statut} ${JSON.stringify(gnb.corps)}`);
  const GB = J(gnb.cookie);

  // --- Produit dans la boutique Nord ---
  let tousProduits = (await requete('/produits', { headers: A })).corps || [];
  let produitNord = tousProduits.find((p) => p.nom === NOM_PRODUIT_NORD && p.boutique_id === nord.id);
  if (!produitNord) {
    const cree = await requete('/produits', {
      method: 'POST',
      headers: A,
      body: JSON.stringify({
        nom: NOM_PRODUIT_NORD, categorie: 'Frais',
        prix_achat: 1, prix_vente: 2, quantite: 20, seuil_alerte: 2,
        boutique_id: nord.id,
      }),
    });
    verifie('Produit Nord créé (201)', cree.statut === 201, `→ ${cree.statut} ${JSON.stringify(cree.corps)}`);
    produitNord = cree.corps;
  } else {
    // Stock remis à niveau pour que les ventes de test restent valides
    await requete(`/produits/${produitNord.id}`, {
      method: 'PUT', headers: A,
      body: JSON.stringify({ quantite: 20, motif: 'Remise à niveau (test isolation)' }),
    });
    verifie('Produit Nord réutilisé (stock remis à niveau)', true);
  }

  // --- Fournisseur partagé (pour la commande de test) ---
  let fournisseurs = (await requete('/fournisseurs', { headers: A })).corps || [];
  let fournisseur = fournisseurs.find((f) => f.nom.toLowerCase() === 'laiterie du nord');
  if (!fournisseur) {
    const cree = await requete('/fournisseurs', {
      method: 'POST', headers: A,
      body: JSON.stringify({ nom: 'Laiterie du Nord' }),
    });
    fournisseur = cree.corps;
  }
  // Un fournisseur archivé par une autre suite ne peut plus être commandé :
  // on le réactive (l'archivage est réversible, c'est le principe)
  if (fournisseur?.id && fournisseur.actif === 0) {
    await requete(`/fournisseurs/${fournisseur.id}`, {
      method: 'PUT', headers: A,
      body: JSON.stringify({ nom: fournisseur.nom, actif: 1 }),
    });
    fournisseur = (await requete('/fournisseurs', { headers: A })).corps
      .find((f) => f.id === fournisseur.id);
  }
  verifie('Fournisseur disponible', !!fournisseur?.id && fournisseur.actif === 1, JSON.stringify(fournisseur));

  // --- Données de référence créées par l'admin DANS la boutique Nord ---
  const commandeNord = await requete('/commandes', {
    method: 'POST', headers: A,
    body: JSON.stringify({
      fournisseur_id: fournisseur.id,
      boutique_id: nord.id,
      notes: 'Test isolation',
      lignes: [{ produit_id: produitNord.id, quantite: 5, prix_unitaire: 0.5 }],
    }),
  });
  verifie('Commande créée dans la boutique Nord (201)', commandeNord.statut === 201,
    `→ ${commandeNord.statut} ${JSON.stringify(commandeNord.corps)}`);

  const mouvementNord = await requete('/mouvements', {
    method: 'POST', headers: A,
    body: JSON.stringify({ produit_id: produitNord.id, type: 'entree', quantite: 5, motif: 'Test isolation' }),
  });
  verifie('Mouvement enregistré en boutique Nord (201)', mouvementNord.statut === 201,
    `→ ${mouvementNord.statut}`);

  const venteNord = await requete('/ventes', {
    method: 'POST', headers: A,
    body: JSON.stringify({
      lignes: [{ produit_id: produitNord.id, quantite: 1 }],
      moyen_paiement: 'carte',
      boutique_id: nord.id,
    }),
  });
  verifie('Ticket émis en boutique Nord (201)', venteNord.statut === 201,
    `→ ${venteNord.statut} ${JSON.stringify(venteNord.corps)}`);
  verifie('Ticket Nord rattaché à la boutique Nord', venteNord.corps?.boutique_id === nord.id,
    `${venteNord.corps?.boutique_id}`);

  // ============================================================
  console.log('\n===== 1. ISOLATION DU GÉRANT (boutique 1) =====');
  // ============================================================

  const mesBoutiques = (await requete('/boutiques', { headers: GA })).corps || [];
  verifie('Gérant : voit SA seule boutique', mesBoutiques.length === 1 && mesBoutiques[0].id !== nord.id,
    JSON.stringify(mesBoutiques.map((b) => b.nom)));

  const produitsA = (await requete('/produits', { headers: GA })).corps || [];
  verifie('Gérant : voit les produits de sa boutique',
    produitsA.some((p) => p.nom === 'Eau minérale 1L'), `${produitsA.length} produit(s)`);
  verifie('Gérant : N’VOIT PAS le produit d’une autre boutique',
    !produitsA.some((p) => p.nom === NOM_PRODUIT_NORD),
    produitsA.filter((p) => p.boutique_id === nord.id).map((p) => p.nom).join(', '));

  const lectureNord = await requete(`/produits/${produitNord.id}`, { headers: GA });
  verifie('Gérant : lecture directe d’un produit étranger → 404', lectureNord.statut === 404, `→ ${lectureNord.statut}`);

  const modifNord = await requete(`/produits/${produitNord.id}`, {
    method: 'PUT', headers: GA,
    body: JSON.stringify({ prix_vente: 99, motif: 'Tentative' }),
  });
  verifie('Gérant : modification d’un produit étranger → 404', modifNord.statut === 404, `→ ${modifNord.statut}`);

  const suppressionNord = await requete(`/produits/${produitNord.id}`, { method: 'DELETE', headers: GA });
  verifie('Gérant : suppression d’un produit étranger → 404', suppressionNord.statut === 404, `→ ${suppressionNord.statut}`);

  const prixNord = (await requete(`/produits/${produitNord.id}`, { headers: A })).corps;
  verifie('Gérant : le produit étranger est INTACT', prixNord?.prix_vente === 2, `${prixNord?.prix_vente}`);

  const mouvementSurNord = await requete('/mouvements', {
    method: 'POST', headers: GA,
    body: JSON.stringify({ produit_id: produitNord.id, type: 'sortie', quantite: 1, motif: 'Tentative' }),
  });
  verifie('Gérant : mouvement sur produit étranger → 404', mouvementSurNord.statut === 404, `→ ${mouvementSurNord.statut}`);

  const venteSurNord = await requete('/ventes', {
    method: 'POST', headers: GA,
    body: JSON.stringify({ lignes: [{ produit_id: produitNord.id, quantite: 1 }], moyen_paiement: 'carte' }),
  });
  verifie('Gérant : encaissement d’un produit étranger → 404', venteSurNord.statut === 404, `→ ${venteSurNord.statut}`);

  const ventesGA = (await requete('/ventes?limite=200', { headers: GA })).corps || [];
  verifie('Gérant : aucun ticket d’une autre boutique dans la liste',
    !ventesGA.some((v) => v.boutique_id === nord.id),
    ventesGA.filter((v) => v.boutique_id === nord.id).map((v) => v.numero).join(', '));
  verifie('Gérant : voit les tickets de sa boutique', ventesGA.length >= 1, `${ventesGA.length}`);

  const lectureTicketNord = await requete(`/ventes/${venteNord.corps.id}`, { headers: GA });
  verifie('Gérant : lecture directe d’un ticket étranger → 404', lectureTicketNord.statut === 404, `→ ${lectureTicketNord.statut}`);

  const mouvementsGA = (await requete('/mouvements?limite=200', { headers: GA })).corps || [];
  verifie('Gérant : aucun mouvement d’une autre boutique',
    !mouvementsGA.some((m) => m.boutique_id === nord.id),
    `${mouvementsGA.filter((m) => m.boutique_id === nord.id).length} fuite(s)`);

  const commandesGA = (await requete('/commandes', { headers: GA })).corps || [];
  verifie('Gérant : aucune commande d’une autre boutique',
    !commandesGA.some((c) => c.boutique_id === nord.id),
    `${commandesGA.filter((c) => c.boutique_id === nord.id).length} fuite(s)`);

  const lectureCmdNord = await requete(`/commandes/${commandeNord.corps.id}`, { headers: GA });
  verifie('Gérant : lecture directe d’une commande étrangère → 404', lectureCmdNord.statut === 404, `→ ${lectureCmdNord.statut}`);

  const statutCmdNord = await requete(`/commandes/${commandeNord.corps.id}/statut`, {
    method: 'PUT', headers: GA, body: JSON.stringify({ statut: 'envoyee' }),
  });
  verifie('Gérant : changement de statut d’une commande étrangère → 404', statutCmdNord.statut === 404, `→ ${statutCmdNord.statut}`);

  // ============================================================
  console.log('\n===== 2. ISOLATION DU CAISSIER =====');
  // ============================================================

  const produitsE = (await requete('/produits', { headers: E })).corps || [];
  verifie('Caissier : voit le stock de son magasin',
    produitsE.some((p) => p.nom === 'Eau minérale 1L'), `${produitsE.length}`);
  verifie('Caissier : N’VOIT PAS le produit d’une autre boutique',
    !produitsE.some((p) => p.nom === NOM_PRODUIT_NORD),
    produitsE.filter((p) => p.boutique_id === nord.id).map((p) => p.nom).join(', '));

  const boutiquesE = await requete('/boutiques', { headers: E });
  verifie('Caissier : liste des boutiques refusée (403)', boutiquesE.statut === 403, `→ ${boutiquesE.statut}`);

  const statsE = await requete('/stats', { headers: E });
  verifie('Caissier : statistiques refusées (403)', statsE.statut === 403, `→ ${statsE.statut}`);

  // ============================================================
  console.log('\n===== 3. LE GÉRANT NORD NE VOIT QUE LA SIENNE =====');
  // ============================================================

  const produitsB = (await requete('/produits', { headers: GB })).corps || [];
  verifie('Gérant Nord : voit SON produit', produitsB.some((p) => p.nom === NOM_PRODUIT_NORD),
    `${produitsB.length} produit(s)`);
  verifie('Gérant Nord : N’VOIT PAS la boutique 1',
    !produitsB.some((p) => p.nom === 'Eau minérale 1L'),
    produitsB.filter((p) => p.boutique_id !== nord.id).map((p) => p.nom).join(', '));

  const boutiquesGB = (await requete('/boutiques', { headers: GB })).corps || [];
  verifie('Gérant Nord : voit SA seule boutique',
    boutiquesGB.length === 1 && boutiquesGB[0].id === nord.id,
    JSON.stringify(boutiquesGB.map((b) => b.nom)));

  const statsGB = (await requete('/stats', { headers: GB })).corps;
  verifie('Gérant Nord : stats = uniquement sa boutique',
    statsGB?.total_produits === produitsB.length, `stats=${statsGB?.total_produits} / liste=${produitsB.length}`);

  const lectureProduitA = await requete('/produits/1', { headers: GB });
  verifie('Gérant Nord : produit 1 (boutique 1) → 404', lectureProduitA.statut === 404, `→ ${lectureProduitA.statut}`);

  // ============================================================
  console.log('\n===== 4. TENTATIVES D’ESCAPADE =====');
  // ============================================================

  // Le gérant envoie boutique_id d'une AUTRE boutique : ignoré, il reste chez lui
  const spoof = await requete('/produits', {
    method: 'POST', headers: GA,
    body: JSON.stringify({
      nom: 'TEST Spoof Gérant', categorie: 'Divers',
      prix_achat: 1, prix_vente: 2, quantite: 1, boutique_id: nord.id,
    }),
  });
  verifie('Gérant : boutique_id étranger IGNORÉ à la création',
    spoof.statut === 201 && spoof.corps?.boutique_id === mesBoutiques[0]?.id,
    `→ ${spoof.statut} boutique_id=${spoof.corps?.boutique_id}`);

  const spoofEmp = await requete('/produits', {
    method: 'POST', headers: E,
    body: JSON.stringify({
      nom: 'TEST Spoof Employé', categorie: 'Divers',
      prix_achat: 1, prix_vente: 2, quantite: 1, boutique_id: nord.id,
    }),
  });
  verifie('Caissier : création de produit REFUSÉE (403 — il vend, il ne gère pas)',
    spoofEmp.statut === 403, `→ ${spoofEmp.statut} ${JSON.stringify(spoofEmp.corps)}`);

  const modifEmp = await requete('/produits/1', {
    method: 'PUT', headers: E,
    body: JSON.stringify({ prix_vente: 99, motif: 'Tentative' }),
  });
  verifie('Caissier : modification de produit REFUSÉE (403)', modifEmp.statut === 403, `→ ${modifEmp.statut}`);

  const prixApresTentative = (await requete('/produits/1', { headers: A })).corps;
  verifie('Caissier : prix inchangé après la tentative', prixApresTentative?.prix_vente !== 99,
    `${prixApresTentative?.prix_vente}`);

  const creerBoutique = await requete('/boutiques', {
    method: 'POST', headers: GA, body: JSON.stringify({ nom: 'Boutique pirates', code: 'PIR' }),
  });
  verifie('Gérant : création de boutique refusée (403)', creerBoutique.statut === 403, `→ ${creerBoutique.statut}`);

  const listerComptes = await requete('/utilisateurs', { headers: GA });
  verifie('Gérant : liste des comptes refusée (403)', listerComptes.statut === 403, `→ ${listerComptes.statut}`);

  const creerCompte = await requete('/utilisateurs', {
    method: 'POST', headers: GA,
    body: JSON.stringify({ nom: 'Pirate', email: 'pirate@test.fr', mot_de_passe: 'Pirate123', role: 'admin' }),
  });
  verifie('Gérant : création de compte admin refusée (403)', creerCompte.statut === 403, `→ ${creerCompte.statut}`);

  const sauvegardes = await requete('/sauvegardes', { method: 'POST', headers: GA });
  verifie('Gérant : sauvegarde de la base refusée (403)', sauvegardes.statut === 403, `→ ${sauvegardes.statut}`);

  const archivage = await requete(`/boutiques/${nord.id}`, { method: 'DELETE', headers: GA });
  verifie('Gérant : archivage d’une boutique refusé (403)', archivage.statut === 403, `→ ${archivage.statut}`);

  // ============================================================
  console.log('\n===== 5. EXPORTS FILTRÉS =====');
  // ============================================================

  const csvGA = await fetch(`${BASE}/export/produits`, { headers: GA });
  const texteCsvGA = await csvGA.text();
  verifie('Export gérant (200)', csvGA.status === 200, `→ ${csvGA.status}`);
  verifie('Export gérant : contient SON stock', texteCsvGA.includes('Eau minérale'));
  verifie('Export gérant : PAS de produit étranger', !texteCsvGA.includes(NOM_PRODUIT_NORD));
  verifie('Export gérant : PAS de boutique étrangère', !texteCsvGA.includes(NOM_BOUTIQUE_NORD));

  const journalGA = await fetch(`${BASE}/export/journal`, { headers: GA });
  const texteJournalGA = await journalGA.text();
  verifie('Export journal gérant (200)', journalGA.status === 200, `→ ${journalGA.status}`);
  verifie('Export journal gérant : PAS d’action étrangère', !texteJournalGA.includes(NOM_PRODUIT_NORD));

  const csvAdmin = await fetch(`${BASE}/export/produits`, { headers: A });
  const texteCsvAdmin = await csvAdmin.text();
  verifie('Export admin : les DEUX boutiques présentes',
    texteCsvAdmin.includes('Eau minérale') && texteCsvAdmin.includes(NOM_PRODUIT_NORD));

  // ============================================================
  console.log('\n===== 6. L’ADMIN VOIT TOUT =====');
  // ============================================================

  const produitsAdmin = (await requete('/produits', { headers: A })).corps || [];
  verifie('Admin : voit les produits des DEUX boutiques',
    produitsAdmin.some((p) => p.nom === 'Eau minérale 1L') && produitsAdmin.some((p) => p.nom === NOM_PRODUIT_NORD));

  const statsAdmin = (await requete('/stats', { headers: A })).corps;
  const statsA = (await requete('/stats', { headers: GA })).corps;
  verifie('Admin : stats consolidées > stats du gérant',
    statsAdmin?.total_produits > statsA?.total_produits,
    `admin=${statsAdmin?.total_produits} gérant=${statsA?.total_produits}`);

  const statsAdminCible = (await requete(`/stats?boutique_id=${nord.id}`, { headers: A })).corps;
  verifie('Admin : stats ciblées sur la boutique Nord',
    statsAdminCible?.total_produits === produitsB.length,
    `→ ${statsAdminCible?.total_produits} (attendu ${produitsB.length})`);

  const boutiquesAdmin = (await requete('/boutiques', { headers: A })).corps || [];
  verifie('Admin : voit tout le réseau', boutiquesAdmin.length >= 2, `${boutiquesAdmin.length} boutique(s)`);

  const venteAdmin = await requete(`/ventes/${venteNord.corps.id}`, { headers: A });
  verifie('Admin : accès à n’importe quel ticket', venteAdmin.statut === 200, `→ ${venteAdmin.statut}`);

  // ============================================================
  console.log('\n===== 7. CRÉATION DE COMPTE GÉRANT PAR L’ADMIN =====');
  // ============================================================

  // --- a. Création valide : un gérant DOIT être rattaché à une boutique ---
  const creeGerant = await requete('/utilisateurs', {
    method: 'POST', headers: A,
    body: JSON.stringify({
      nom: 'Gérant de test',
      email: 'gerant-creation@test.fr',
      mot_de_passe: 'Gerant1234',
      role: 'gerant',
      boutique_id: nord.id,
    }),
  });
  verifie('Admin : crée un gérant rattaché à la boutique Nord (201)',
    creeGerant.statut === 201 && creeGerant.corps?.boutique_id === nord.id,
    `→ ${creeGerant.statut} ${JSON.stringify(creeGerant.corps)}`);

  // --- b. Rattachement OBLIGATOIRE : gérant sans boutique refusé ---
  const gerantSansBoutique = await requete('/utilisateurs', {
    method: 'POST', headers: A,
    body: JSON.stringify({
      nom: 'Gérant sans magasin',
      email: 'gerant-sans-magasin@test.fr',
      mot_de_passe: 'Gerant1234',
      role: 'gerant',
    }),
  });
  verifie('Création d’un gérant SANS boutique refusée (400)',
    gerantSansBoutique.statut === 400, `→ ${gerantSansBoutique.statut}`);

  // --- c. Boutique inexistante refusée (le serveur vérifie en base) ---
  const boutiqueInconnue = await requete('/utilisateurs', {
    method: 'POST', headers: A,
    body: JSON.stringify({
      nom: 'Gérant boutique fantôme',
      email: 'gerant-fantome@test.fr',
      mot_de_passe: 'Gerant1234',
      role: 'gerant',
      boutique_id: 999999,
    }),
  });
  verifie('Gérant rattaché à une boutique inexistante refusé (400)',
    boutiqueInconnue.statut === 400, `→ ${boutiqueInconnue.statut}`);

  // --- d. Un admin n’appartient à AUCUNE boutique (le champ est ignoré) ---
  const creeAdmin = await requete('/utilisateurs', {
    method: 'POST', headers: A,
    body: JSON.stringify({
      nom: 'Admin de test',
      email: 'admin-creation@test.fr',
      mot_de_passe: 'Admin1234',
      role: 'admin',
      boutique_id: nord.id,
    }),
  });
  verifie('Création admin : boutique_id ignoré (null)',
    creeAdmin.statut === 201 && creeAdmin.corps?.boutique_id === null,
    `→ ${creeAdmin.statut} ${JSON.stringify(creeAdmin.corps)}`);

  // --- e. Le nouveau gérant ne voit QUE son magasin ---
  const connexionGerantTest = await requete('/auth/connexion', {
    method: 'POST',
    body: JSON.stringify({ email: 'gerant-creation@test.fr', mot_de_passe: 'Gerant1234' }),
  });
  const JGT = J(connexionGerantTest.cookie);
  const moiGerant = (await requete('/auth/moi', { headers: JGT })).corps;
  verifie('Le gérant reçoit le nom de SA boutique (en-tête)',
    moiGerant?.boutique?.nom === NOM_BOUTIQUE_NORD, JSON.stringify(moiGerant?.boutique));

  const boutiquesGerantTest = (await requete('/boutiques', { headers: JGT })).corps || [];
  verifie('Le nouveau gérant ne voit QUE sa boutique',
    boutiquesGerantTest.length === 1 && boutiquesGerantTest[0].id === nord.id,
    JSON.stringify(boutiquesGerantTest.map((b) => b.nom)));

  const produitsGerantTest = (await requete('/produits', { headers: JGT })).corps || [];
  verifie('Le nouveau gérant ne voit QUE les produits de son magasin',
    produitsGerantTest.length > 0 && produitsGerantTest.every((p) => p.boutique_id === nord.id),
    `${produitsGerantTest.length} produit(s)`);

  // --- f. Changement de rôle : le rattachement reste cohérent ---
  if (creeGerant.statut === 201) {
    const compteId = creeGerant.corps.id;

    const promotion = await requete(`/utilisateurs/${compteId}`, {
      method: 'PUT', headers: A, body: JSON.stringify({ role: 'admin' }),
    });
    verifie('Promotion gérant → admin : boutique_id remis à NULL',
      promotion.statut === 200 && promotion.corps?.boutique_id === null,
      `→ ${promotion.statut} ${JSON.stringify(promotion.corps)}`);

    const retrogradation = await requete(`/utilisateurs/${compteId}`, {
      method: 'PUT', headers: A, body: JSON.stringify({ role: 'gerant' }),
    });
    verifie('Rétrogradation admin → gérant SANS boutique refusée (400)',
      retrogradation.statut === 400, `→ ${retrogradation.statut}`);

    const rattache = await requete(`/utilisateurs/${compteId}`, {
      method: 'PUT', headers: A, body: JSON.stringify({ role: 'gerant', boutique_id: 1 }),
    });
    verifie('Rattachement forcé depuis l’admin : rôle + boutique en une passe (200)',
      rattache.statut === 200 && rattache.corps?.boutique_id === 1,
      `→ ${rattache.statut} ${JSON.stringify(rattache.corps)}`);
  }

  // ============================================================
  console.log('\n===== NETTOYAGE =====');
  // ============================================================

  // Le produit de test créé en boutique 1 (aucune vente liée → supprimable)
  for (const p of [spoof.corps]) {
    if (p?.id) await requete(`/produits/${p.id}`, { method: 'DELETE', headers: A });
  }
  // La commande de test (statut « en attente » → supprimable)
  if (commandeNord.corps?.id) {
    await requete(`/commandes/${commandeNord.corps.id}`, { method: 'DELETE', headers: A });
  }
  // Les comptes de test de la section 7 (jamais le dernier admin)
  for (const compte of [creeGerant?.corps, creeAdmin?.corps]) {
    if (compte?.id) await requete(`/utilisateurs/${compte.id}`, { method: 'DELETE', headers: A });
  }
  console.log('  🧹 données de test supprimées (produits spoof, commande Nord, comptes de test)');

  console.log(`\n========== ${ok} réussis / ${ko} échoués (total ${ok + ko}) ==========`);
  process.exit(ko === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\n💥 Interruption des tests :', err.message);
  process.exit(1);
});