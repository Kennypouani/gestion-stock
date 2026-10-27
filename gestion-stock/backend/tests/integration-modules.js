// ============================================================
// TESTS D'INTÉGRATION — 5 modules (caisse, expirations, export,
// fournisseurs/commandes, sauvegardes/mot de passe)
//
// Prérequis : le serveur backend doit être lancé (node server.js)
// Lancement :  node tests/integration-modules.js
// Sortie :     code 0 si tout passe, code 1 sinon
// Les données de test sont créées puis supprimées à la fin.
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
    ...options, // d'abord les options...
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...options.headers }, // ...puis les en-têtes fusionnés
  });
  const corps = await r.json().catch(() => null);

  // Le limiteur de débit a son propre message : on l'explique au lieu de
  // laisser un échec en cascade illisible plus loin dans le script
  if (r.status === 429) {
    throw new Error(
      `Limiteur de débit atteint sur ${options.method || 'GET'} ${url} — ` +
      'redémarrez le serveur backend pour remettre les compteurs à zéro (fenêtre de 15 min)'
    );
  }

  return { statut: r.status, corps, cookie: r.headers.get('set-cookie') || '' };
}

const J = (cookie) => ({ Cookie: String(cookie).split(';')[0] });
const dateDans = (jours) => {
  const d = new Date(Date.now() + jours * 86400000);
  return d.toISOString().slice(0, 10);
};

// Le fournisseur de test est RÉUTILISÉ d'une exécution à l'autre :
// une commande reçue ne peut pas être supprimée (traçabilité), donc
// on réactive / on archive plutôt que d'accumuler des doublons.
const NOM_FOURNISSEUR = 'Laiterie du Nord';

async function creerOuRecupererFournisseur(A) {
  const liste = (await requete('/fournisseurs', { headers: A })).corps || [];
  let existant = liste.find((f) => f.nom === NOM_FOURNISSEUR);

  if (existant && existant.actif === 0) {
    // Réactivation (un fournisseur archivé ne peut plus être commandé)
    await requete(`/fournisseurs/${existant.id}`, {
      method: 'PUT', headers: A, body: JSON.stringify({ actif: 1 }),
    });
    existant = (await requete('/fournisseurs', { headers: A })).corps
      .find((f) => f.id === existant.id);
  }

  if (existant) return { statut: 200, corps: existant };

  return requete('/fournisseurs', {
    method: 'POST', headers: A,
    body: JSON.stringify({
      nom: NOM_FOURNISSEUR,
      contact_nom: 'Mariam Koné',
      email: 'commandes@laiterie-nord.fr',
      telephone: '+225 01 02 03 04',
    }),
  });
}

(async () => {
  console.log('\n===== CONNEXIONS =====');
  const adm = await requete('/auth/connexion', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@magasin.fr', mot_de_passe: 'admin123' }),
  });
  const emp = await requete('/auth/connexion', {
    method: 'POST',
    body: JSON.stringify({ email: 'awa@magasin.fr', mot_de_passe: 'employe123' }),
  });
  const A = J(adm.cookie);
  let E = J(emp.cookie); // « let » : réattribué après un changement de mot de passe
  verifie('Connexion admin', adm.statut === 200);
  verifie('Connexion employé', emp.statut === 200);

  const produits = (await requete('/produits', { headers: A })).corps;
  const eau = produits.find((p) => p.nom === 'Eau minérale 1L');
  const pain = produits.find((p) => p.nom === 'Pain de mie');
  const yaourt = produits.find((p) => p.nom === 'Yaourt nature');
  const stockInitialEau = eau.quantite;
  verifie('Produits de test trouvés', !!(eau && pain && yaourt));

  // ============================================================
  console.log('\n===== 1. MODULE CAISSE =====');
  // ============================================================

  const panierVide = await requete('/ventes', {
    method: 'POST', headers: E,
    body: JSON.stringify({ lignes: [], moyen_paiement: 'especes' }),
  });
  verifie('Panier vide refusé (400)', panierVide.statut === 400, `→ ${panierVide.statut}`);

  const paiementInvalide = await requete('/ventes', {
    method: 'POST', headers: E,
    body: JSON.stringify({ lignes: [{ produit_id: eau.id, quantite: 1 }], moyen_paillement: 'cheque', moyen_paiement: 'cheque' }),
  });
  verifie('Moyen de paiement invalide refusé (400)', paiementInvalide.statut === 400, `→ ${paiementInvalide.statut}`);

  const stockInsuffisant = await requete('/ventes', {
    method: 'POST', headers: E,
    body: JSON.stringify({ lignes: [{ produit_id: eau.id, quantite: stockInitialEau + 100 }], moyen_paiement: 'especes' }),
  });
  verifie('Stock insuffisant refusé (409)', stockInsuffisant.statut === 409, `→ ${stockInsuffisant.statut}`);

  const verseInsuffisant = await requete('/ventes', {
    method: 'POST', headers: E,
    body: JSON.stringify({
      lignes: [{ produit_id: eau.id, quantite: 2 }],
      moyen_paiement: 'especes', montant_verse: 0.01,
    }),
  });
  verifie('Montant versé insuffisant refusé (400)', verseInsuffisant.statut === 400, `→ ${verseInsuffisant.statut}`);

  const remiseExcessive = await requete('/ventes', {
    method: 'POST', headers: E,
    body: JSON.stringify({
      lignes: [{ produit_id: eau.id, quantite: 2 }],
      moyen_paiement: 'especes', montant_verse: 100, remise: 9999,
    }),
  });
  verifie('Remise supérieure au panier refusée (400)', remiseExcessive.statut === 400, `→ ${remiseExcessive.statut}`);

  // --- Vente valide : 2 × Eau à prix serveur, remise 0.10, espèces ---
  const vente = await requete('/ventes', {
    method: 'POST', headers: E,
    body: JSON.stringify({
      lignes: [{ produit_id: eau.id, quantite: 2 }],
      moyen_paiement: 'especes', montant_verse: 5, remise: 0.10,
    }),
  });
  verifie('Vente encaissée (201)', vente.statut === 201, `→ ${vente.statut} ${JSON.stringify(vente.corps)}`);
  verifie('Numéro de ticket généré', /^TK-\d{4}-\d{4}$/.test(vente.corps?.numero || ''), vente.corps?.numero);
  verifie('Total recalculé par le serveur', vente.corps?.sous_total === 1.1 && vente.corps?.total === 1, JSON.stringify(vente.corps));
  verifie('Monnaie rendue exacte', vente.corps?.monnaie_rendue === 4, JSON.stringify(vente.corps?.monnaie_rendue));
  verifie('Caissier enregistré', vente.corps?.utilisateur_nom === 'Awa Diallo', vente.corps?.utilisateur_nom);
  verifie('Ligne de ticket enregistrée', vente.corps?.lignes?.length === 1 && vente.corps.lignes[0].prix_unitaire === 0.55);

  const apresVente = (await requete('/produits', { headers: A })).corps.find((p) => p.id === eau.id);
  verifie('Stock décrémenté (2 unités)', apresVente.quantite === stockInitialEau - 2, `${apresVente.quantite}`);

  const journal = (await requete(`/produits/${eau.id}/historique`, { headers: A })).corps;
  const ligneVente = journal.find((j) => (j.motif || '').startsWith('Vente ticket'));
  verifie('Journal : sortie liée au ticket', !!ligneVente && ligneVente.action === 'sortie', JSON.stringify(ligneVente));
  verifie('Journal : auteur de la vente', ligneVente?.utilisateur_nom === 'Awa Diallo');

  // --- Vente en carte (sans montant_verse) ---
  const venteCarte = await requete('/ventes', {
    method: 'POST', headers: E,
    body: JSON.stringify({ lignes: [{ produit_id: pain.id, quantite: 1 }], moyen_paiement: 'carte' }),
  });
  verifie('Vente par carte acceptée (201)', venteCarte.statut === 201, `→ ${venteCarte.statut}`);
  verifie('Aucune monnaie pour la carte', venteCarte.corps?.monnaie_rendue === null);

  // --- Historique : l'admin voit tout, l'employé seulement les siens ---
  const ventesAdmin = (await requete('/ventes?limite=50', { headers: A })).corps || [];
  verifie('Admin : liste des tickets complète', ventesAdmin.length >= 2, `${ventesAdmin.length}`);

  const venteEmp = await requete(`/ventes/${vente.corps.id}`, { headers: E });
  verifie('Employé : son propre ticket accessible (200)', venteEmp.statut === 200);

  const venteAutre = await requete('/ventes', { method: 'POST', headers: A,
    body: JSON.stringify({ lignes: [{ produit_id: eau.id, quantite: 1 }], moyen_paiement: 'carte' }) });
  const accesEmp = await requete(`/ventes/${venteAutre.corps.id}`, { headers: E });
  verifie('Employé : ticket d\'un collègue refusé (403)', accesEmp.statut === 403, `→ ${accesEmp.statut}`);

  const venteAnon = await requete('/ventes');
  verifie('Non connecté refusé (401)', venteAnon.statut === 401, `→ ${venteAnon.statut}`);

  // ============================================================
  console.log('\n===== 2. ALERTES D\'EXPIRATION =====');
  // ============================================================

  // Un run interrompu aurait laissé le produit périmé de test :
  // on le supprime d'abord pour que le filtre soit fiable à chaque exécution
  const anterieurs = (await requete('/produits', { headers: A })).corps || [];
  for (const p of anterieurs.filter((x) => x.nom.startsWith('TEST périmé'))) {
    await requete(`/produits/${p.id}`, { method: 'DELETE', headers: A });
  }

  await requete(`/produits/${yaourt.id}`, {
    method: 'PUT', headers: A,
    body: JSON.stringify({ date_expiration: dateDans(3), motif: 'Mise en place des dates de démonstration' }),
  });
  await requete(`/produits/${pain.id}`, {
    method: 'PUT', headers: A,
    body: JSON.stringify({ date_expiration: dateDans(1), motif: 'Mise en place des dates de démonstration' }),
  });

  // Un produit volontairement périmé, supprimé à la fin du test
  const perime = await requete('/produits', {
    method: 'POST', headers: A,
    body: JSON.stringify({
      nom: 'TEST périmé (à ignorer)', categorie: 'Frais', prix_achat: 1, prix_vente: 2,
      quantite: 3, seuil_alerte: 1, date_expiration: dateDans(-5),
    }),
  });
  verifie('Produit périmé de test créé', perime.statut === 201, `→ ${perime.statut}`);

  const septJours = (await requete('/produits?expiration=7', { headers: A })).corps;
  verifie('Filtre « expire sous 7 jours »', septJours.length === 2, `${septJours.length} → ${septJours.map((p) => p.nom).join(', ')}`);

  const perimes = (await requete('/produits?expiration=0', { headers: A })).corps;
  verifie('Filtre « périmés »', perimes.length === 1 && perimes[0].id === perime.corps.id, `${perimes.map((p) => p.nom).join(', ')}`);

  const stats = (await requete('/stats', { headers: A })).corps;
  verifie('Stats : 1 produit périmé', stats?.expirations?.perimes === 1, JSON.stringify(stats?.expirations));
  verifie('Stats : 2 expirant sous 7 jours', stats?.expirations?.bientot === 2);
  verifie('Stats : liste triée par urgence', stats?.expirations?.liste?.[0]?.jours_restants <= stats?.expirations?.liste?.[1]?.jours_restants);
  verifie('Stats : CA du jour présent', typeof stats?.ca_jour?.total === 'number' && stats.ca_jour.nb_tickets >= 1, JSON.stringify(stats?.ca_jour));

  // ============================================================
  console.log('\n===== 3. EXPORT CSV =====');
  // ============================================================

  const exportStock = await fetch(`${BASE}/export/produits`, { headers: A });
  // On lit les OCTETS bruts : .text() supprimerait le BOM automatiquement
  const octetsStock = new Uint8Array(await exportStock.arrayBuffer());
  const texteStock = new TextDecoder('utf-8').decode(octetsStock);
  verifie('Export stock (200)', exportStock.status === 200, `→ ${exportStock.status}`);
  verifie('Type MIME text/csv', (exportStock.headers.get('content-type') || '').includes('text/csv'));
  verifie('Téléchargement forcé (attachment)', (exportStock.headers.get('content-disposition') || '').includes('attachment'));
  verifie('BOM UTF-8 présent (Excel)',
    octetsStock[0] === 0xef && octetsStock[1] === 0xbb && octetsStock[2] === 0xbf,
    Array.from(octetsStock.slice(0, 3)).map((b) => b.toString(16)).join(' '));
  verifie('Séparateur point-virgule', texteStock.split('\r\n')[0].includes('prix_achat;prix_vente'));
  verifie('Colonnes de calcul incluses', texteStock.includes('marge_unite') && texteStock.includes('valeur_stock'));

  const exportJournal = await fetch(`${BASE}/export/journal`, { headers: A });
  const texteJournal = await exportJournal.text();
  verifie('Export journal (200)', exportJournal.status === 200, `→ ${exportJournal.status}`);
  verifie('Journal contient auteur + motif', texteJournal.includes('utilisateur_nom') && texteJournal.includes('motif'));

  const exportEmp = await fetch(`${BASE}/export/produits`, { headers: E });
  verifie('Export refusé à l\'employé (403)', exportEmp.status === 403, `→ ${exportEmp.status}`);

  // ============================================================
  console.log('\n===== 4. FOURNISSEURS & COMMANDES =====');
  // ============================================================

  const fournisseur = await creerOuRecupererFournisseur(A);
  verifie('Fournisseur disponible (créé ou réutilisé)', fournisseur.statut === 201 || fournisseur.statut === 200,
    `→ ${fournisseur.statut} ${JSON.stringify(fournisseur.corps)}`);
  verifie('Fournisseur actif après préparation', fournisseur.corps?.actif === 1, `${fournisseur.corps?.actif}`);

  const doublon = await requete('/fournisseurs', {
    method: 'POST', headers: A,
    body: JSON.stringify({ nom: 'laiterie du nord' }), // variante en minuscules du même nom
  });
  verifie('Nom dupliqué refusé (409)', doublon.statut === 409, `→ ${doublon.statut}`);

  const emailInvalide = await requete('/fournisseurs', {
    method: 'POST', headers: A,
    body: JSON.stringify({ nom: 'Test SA', email: 'pas-un-email' }),
  });
  verifie('Email invalide refusé (400)', emailInvalide.statut === 400, `→ ${emailInvalide.statut}`);

  const fournisseurEmp = await requete('/fournisseurs', { headers: E });
  verifie('Fournisseurs refusés à l\'employé (403)', fournisseurEmp.statut === 403, `→ ${fournisseurEmp.statut}`);

  // --- Commande ---
  const commande = await requete('/commandes', {
    method: 'POST', headers: A,
    body: JSON.stringify({
      fournisseur_id: fournisseur.corps.id,
      notes: 'Livraison hebdomadaire',
      lignes: [{ produit_id: eau.id, quantite: 10, prix_unitaire: 0.2 }],
    }),
  });
  verifie('Commande créée (201)', commande.statut === 201, `→ ${commande.statut} ${JSON.stringify(commande.corps)}`);
  verifie('Numéro CMD généré', /^CMD-\d{4}-\d{4}$/.test(commande.corps?.numero || ''), commande.corps?.numero);
  verifie('Montant total calculé (10 × 0.20)', commande.corps?.montant_total === 2, commande.corps?.montant_total);
  verifie('Statut initial : en attente', commande.corps?.statut === 'en_attente');

  const commandeInvalide = await requete('/commandes', {
    method: 'POST', headers: A,
    body: JSON.stringify({ fournisseur_id: fournisseur.corps.id, lignes: [{ produit_id: eau.id, quantite: 0, prix_unitaire: 1 }] }),
  });
  verifie('Quantité 0 refusée (400)', commandeInvalide.statut === 400, `→ ${commandeInvalide.statut}`);

  const commandeEmp = await requete('/commandes', { headers: E });
  verifie('Commandes refusées à l\'employé (403)', commandeEmp.statut === 403, `→ ${commandeEmp.statut}`);

  const sautDirect = await requete(`/commandes/${commande.corps.id}/statut`, {
    method: 'PUT', headers: A, body: JSON.stringify({ statut: 'recue' }),
  });
  verifie('Réception directe sans envoi refusée (409)', sautDirect.statut === 409, `→ ${sautDirect.statut}`);

  const envoi = await requete(`/commandes/${commande.corps.id}/statut`, {
    method: 'PUT', headers: A, body: JSON.stringify({ statut: 'envoyee' }),
  });
  verifie('Commande marquée envoyée', envoi.statut === 200 && envoi.corps?.statut === 'envoyee');

  // On relit le stock AU MOMENT de la réception (il a bougé depuis)
  const stockAvantReception = (await requete('/produits', { headers: A })).corps.find((p) => p.id === eau.id).quantite;
  const reception = await requete(`/commandes/${commande.corps.id}/statut`, {
    method: 'PUT', headers: A, body: JSON.stringify({ statut: 'recue' }),
  });
  verifie('Réception acceptée', reception.statut === 200 && reception.corps?.statut === 'recue');
  verifie('Réceptionneur enregistré', reception.corps?.recu_par === 'Administrateur', reception.corps?.recu_par);

  const apresReception = (await requete('/produits', { headers: A })).corps.find((p) => p.id === eau.id);
  verifie('Stock augmenté de 10', apresReception.quantite === stockAvantReception + 10, `${apresReception.quantite}`);
  verifie('Prix d\'achat mis à jour (0.20)', apresReception.prix_achat === 0.2, `${apresReception.prix_achat}`);

  const journalReception = (await requete(`/produits/${eau.id}/historique`, { headers: A })).corps;
  verifie('Journal : entrée de réception', journalReception.some((j) => j.action === 'entree' && (j.motif || '').includes(commande.corps.numero)));
  verifie('Journal : prix d\'achat tracé', journalReception.some((j) => j.champ === 'prix_achat' && j.nouvelle_valeur === '0.2'));

  const suppressionRecue = await requete(`/commandes/${commande.corps.id}`, { method: 'DELETE', headers: A });
  verifie('Suppression d\'une commande reçue refusée (409)', suppressionRecue.statut === 409, `→ ${suppressionRecue.statut}`);

  // --- Archivage d'un fournisseur lié ---
  const archivage = await requete(`/fournisseurs/${fournisseur.corps.id}`, { method: 'DELETE', headers: A });
  verifie('Fournisseur lié archivé (pas supprimé)', archivage.statut === 200 && archivage.corps?.archive === true, JSON.stringify(archivage.corps));
  const fourListe = (await requete('/fournisseurs', { headers: A })).corps;
  verifie('Fournisseur archivé conservé', fourListe.some((f) => f.id === fournisseur.corps.id && f.actif === 0));

  // ============================================================
  console.log('\n===== 5. SAUVEGARDES & MOT DE PASSE =====');
  // ============================================================

  const sauvegarde = await requete('/sauvegardes', { method: 'POST', headers: A });
  verifie('Sauvegarde créée (201)', sauvegarde.statut === 201, `→ ${sauvegarde.statut} ${JSON.stringify(sauvegarde.corps)}`);
  verifie('Taille renseignée', (sauvegarde.corps?.taille || 0) > 0, sauvegarde.corps?.taille_lisible);

  const listeSauvegardes = (await requete('/sauvegardes', { headers: A })).corps;
  verifie('Liste des sauvegardes non vide', listeSauvegardes.length >= 1, `${listeSauvegardes.length}`);

  const telechargement = await fetch(`${BASE}/sauvegardes/${sauvegarde.corps.nom}`, { headers: A });
  verifie('Téléchargement de la sauvegarde (200)', telechargement.status === 200, `→ ${telechargement.status}`);
  // Un .db n'a pas de type MIME officiel → octet-stream est normal
  const typeBackup = telechargement.headers.get('content-type') || '';
  verifie('Fichier binaire téléchargeable',
    typeBackup.includes('octet-stream') || typeBackup.includes('sqlite'), typeBackup);
  verifie('Nom du fichier conservé',
    (telechargement.headers.get('content-disposition') || '').includes(sauvegarde.corps.nom));

  const traversal = await fetch(`${BASE}/sauvegardes/..%2F..%2Fstock.db`, { headers: A });
  verifie('Path traversal bloqué (400)', traversal.status === 400, `→ ${traversal.status}`);

  const sauvegardeEmp = await requete('/sauvegardes', { headers: E });
  verifie('Sauvegardes refusées à l\'employé (403)', sauvegardeEmp.statut === 403, `→ ${sauvegardeEmp.statut}`);

  // --- Changement de mot de passe ---
  const tropCourt = await requete('/auth/mot-de-passe', {
    method: 'PUT', headers: E,
    body: JSON.stringify({ ancien_mot_de_passe: 'employe123', nouveau_mot_de_passe: 'court', confirmation: 'court' }),
  });
  verifie('Mot de passe trop court refusé (400)', tropCourt.statut === 400, `→ ${tropCourt.statut}`);

  const confirmationFausse = await requete('/auth/mot-de-passe', {
    method: 'PUT', headers: E,
    body: JSON.stringify({ ancien_mot_de_passe: 'employe123', nouveau_mot_de_passe: 'Nouveau2026!', confirmation: 'Autre2026!' }),
  });
  verifie('Confirmation différente refusée (400)', confirmationFausse.statut === 400, `→ ${confirmationFausse.statut}`);

  const ancienFaux = await requete('/auth/mot-de-passe', {
    method: 'PUT', headers: E,
    body: JSON.stringify({ ancien_mot_de_passe: 'mauvais-code', nouveau_mot_de_passe: 'Nouveau2026!', confirmation: 'Nouveau2026!' }),
  });
  verifie('Ancien mot de passe faux refusé (401)', ancienFaux.statut === 401, `→ ${ancienFaux.statut}`);

  const changement = await requete('/auth/mot-de-passe', {
    method: 'PUT', headers: E,
    body: JSON.stringify({ ancien_mot_de_passe: 'employe123', nouveau_mot_de_passe: 'Nouveau2026!', confirmation: 'Nouveau2026!' }),
  });
  verifie('Changement accepté (200)', changement.statut === 200, `→ ${changement.statut} ${JSON.stringify(changement.corps)}`);

  const ancienRefuse = await requete('/auth/connexion', {
    method: 'POST', body: JSON.stringify({ email: 'awa@magasin.fr', mot_de_passe: 'employe123' }),
  });
  verifie('Ancien mot de passe plus valide (401)', ancienRefuse.statut === 401, `→ ${ancienRefuse.statut}`);

  const nouveauOk = await requete('/auth/connexion', {
    method: 'POST', body: JSON.stringify({ email: 'awa@magasin.fr', mot_de_passe: 'Nouveau2026!' }),
  });
  verifie('Nouveau mot de passe accepté (200)', nouveauOk.statut === 200, `→ ${nouveauOk.statut}`);

  // Restauration du mot de passe d'origine
  const restauration = await requete('/auth/mot-de-passe', {
    method: 'PUT', headers: J(nouveauOk.cookie),
    body: JSON.stringify({ ancien_mot_de_passe: 'Nouveau2026!', nouveau_mot_de_passe: 'employe123', confirmation: 'employe123' }),
  });
  verifie('Mot de passe restauré', restauration.statut === 200, `→ ${restauration.statut}`);

  // Le changement a fermé les anciennes sessions (y compris la nôtre) :
  // on rouvre une session employé pour la suite des droits
  const reconnexion = await requete('/auth/connexion', {
    method: 'POST', body: JSON.stringify({ email: 'awa@magasin.fr', mot_de_passe: 'employe123' }),
  });
  verifie('Session employé rouverte après restauration', reconnexion.statut === 200, `→ ${reconnexion.statut}`);
  E = J(reconnexion.cookie);

  // ============================================================
  // 6. DROITS DE L'EMPLOYÉ — refus « peu importe le moyen »
  // ============================================================
  console.log('\n===== 6. DROITS EMPLOYÉ =====');

  const stockAvantTentative = ((await requete('/produits', { headers: E })).corps || [])
    .find((p) => p.id === eau.id)?.quantite;

  const mouvementsEmp = await requete('/mouvements', { headers: E });
  verifie('Employé : liste des mouvements refusée (403)', mouvementsEmp.statut === 403, `→ ${mouvementsEmp.statut}`);

  const creationEmp = await requete('/mouvements', {
    method: 'POST', headers: E,
    body: JSON.stringify({ produit_id: eau.id, type: 'sortie', quantite: 50, motif: 'tentative directe' }),
  });
  verifie('Employé : création de mouvement refusée (403)', creationEmp.statut === 403, `→ ${creationEmp.statut}`);

  const stockApresTentative = ((await requete('/produits', { headers: E })).corps || [])
    .find((p) => p.id === eau.id)?.quantite;
  verifie('Stock inchangé après la tentative refusée', stockApresTentative === stockAvantTentative,
    `${stockAvantTentative} → ${stockApresTentative}`);

  const statsEmp = await requete('/stats', { headers: E });
  verifie('Employé : statistiques refusées (403)', statsEmp.statut === 403, `→ ${statsEmp.statut}`);

  const mouvementsAdm = await requete('/mouvements', { headers: A });
  verifie('Admin : liste des mouvements accessible (200)', mouvementsAdm.statut === 200, `→ ${mouvementsAdm.statut}`);

  const statsAdm = await requete('/stats', { headers: A });
  verifie('Admin : statistiques accessibles (200)', statsAdm.statut === 200, `→ ${statsAdm.statut}`);

  const stockEmp = await requete('/produits', { headers: E });
  verifie('Employé : accès au STOCK maintenu (200)', stockEmp.statut === 200, `→ ${stockEmp.statut}`);

  const caisseEmp = await requete('/ventes?limite=5', { headers: E });
  verifie('Employé : accès à la CAISSE maintenu (200)', caisseEmp.statut === 200, `→ ${caisseEmp.statut}`);

  const mouvementsAnon = await requete('/mouvements');
  verifie('Non connecté : mouvements refusés (401)', mouvementsAnon.statut === 401, `→ ${mouvementsAnon.statut}`);

  // ============================================================
  // NETTOYAGE DES DONNÉES DE TEST
  // ============================================================
  console.log('\n===== NETTOYAGE =====');
  await requete(`/produits/${perime.corps.id}`, { method: 'DELETE', headers: A });
  // Remise à plat du stock et des prix touchés par les tests
  await requete(`/produits/${eau.id}`, {
    method: 'PUT', headers: A,
    body: JSON.stringify({ quantite: stockInitialEau, prix_achat: 0.25, motif: 'Fin des tests — remise en état' }),
  });
  // Une chaîne vide vide le champ (null serait ignoré par la route)
  await requete(`/produits/${pain.id}`, {
    method: 'PUT', headers: A,
    body: JSON.stringify({ date_expiration: '', motif: 'Fin des tests — suppression de la date de démonstration' }),
  });
  await requete(`/produits/${yaourt.id}`, {
    method: 'PUT', headers: A,
    body: JSON.stringify({ date_expiration: '', motif: 'Fin des tests — suppression de la date de démonstration' }),
  });
  await requete(`/fournisseurs/${fournisseur.corps.id}`, { method: 'DELETE', headers: A });
  console.log('  🧹 données de test supprimées (produit périmé, dates, prix, fournisseur archivé)');

  console.log(`\n========== ${ok} réussis / ${ko} échoués (total ${ok + ko}) ==========`);
  process.exit(ko === 0 ? 0 : 1);
})().catch((err) => {
  console.error('ERREUR FATALE :', err);
  process.exit(1);
});