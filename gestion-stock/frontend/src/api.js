// ============================================================
// API — Tous les appels vers le backend sont centralisés ici
// React n'appelle JAMAIS la base de données directement :
// il passe toujours par ces fonctions → qui appellent Express
// ============================================================

// Adresse de notre serveur backend
const BASE = 'http://localhost:5000/api';

// Fonction utilitaire : envoie une requête et gère les erreurs réseau
async function requete(url, options = {}) {
  const reponse = await fetch(url, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    // credentials: 'include' = envoie le cookie de session avec la requête
    credentials: 'include',
    ...options,
  });

  // Si le serveur répond avec une erreur (400, 404, 500...)
  if (!reponse.ok) {
    const donnees = await reponse.json().catch(() => ({}));
    // On lance une exception avec le message français du serveur
    throw new Error(donnees.erreur || 'Erreur réseau');
  }

  // 204 = succès sans contenu (suppression)
  if (reponse.status === 204) return null;
  return reponse.json();
}

// --- Authentification ---
export const connexion = (email, motDePasse) =>
  requete(`${BASE}/auth/connexion`, {
    method: 'POST',
    body: JSON.stringify({ email, mot_de_passe: motDePasse }),
  });

export const deconnexion = () =>
  requete(`${BASE}/auth/deconnexion`, { method: 'POST' });

export const getUtilisateurCourant = () => requete(`${BASE}/auth/moi`);

// --- Gestion des comptes (admin uniquement) ---
export const getUtilisateurs = () => requete(`${BASE}/utilisateurs`);

export const creerUtilisateur = (donnees) =>
  requete(`${BASE}/utilisateurs`, {
    method: 'POST',
    body: JSON.stringify(donnees),
  });

export const modifierUtilisateur = (id, donnees) =>
  requete(`${BASE}/utilisateurs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(donnees),
  });

export const reinitialiserMotDePasse = (id, motDePasse) =>
  requete(`${BASE}/utilisateurs/${id}/mot-de-passe`, {
    method: 'PUT',
    body: JSON.stringify({ mot_de_passe: motDePasse }),
  });

export const supprimerUtilisateur = (id) =>
  requete(`${BASE}/utilisateurs/${id}`, { method: 'DELETE' });

// --- Boutiques du réseau (admin : toutes / gérant : la sienne) ---
export const getBoutiques = () => requete(`${BASE}/boutiques`);

// --- Produits ---
export const getProduits = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return requete(`${BASE}/produits${query ? '?' + query : ''}`);
};

export const getProduit = (id) => requete(`${BASE}/produits/${id}`);

export const creerProduit = (donnees) =>
  requete(`${BASE}/produits`, {
    method: 'POST',
    body: JSON.stringify(donnees),
  });

export const modifierProduit = (id, donnees) =>
  requete(`${BASE}/produits/${id}`, {
    method: 'PUT',
    body: JSON.stringify(donnees),
  });

export const supprimerProduit = (id) =>
  requete(`${BASE}/produits/${id}`, { method: 'DELETE' });

// Historique d'un produit (admin uniquement)
export const getHistoriqueProduit = (id) => requete(`${BASE}/produits/${id}/historique`);

// --- Mouvements de stock ---
export const getMouvements = (limite = 50) =>
  requete(`${BASE}/mouvements?limite=${limite}`);

export const creerMouvement = (donnees) =>
  requete(`${BASE}/mouvements`, {
    method: 'POST',
    body: JSON.stringify(donnees),
  });

// --- Statistiques du tableau de bord ---
export const getStats = () => requete(`${BASE}/stats`);

// --- Caisse : tickets de caisse ---
export const creerVente = (donnees) =>
  requete(`${BASE}/ventes`, {
    method: 'POST',
    body: JSON.stringify(donnees),
  });

export const getVentes = (limite = 20) => requete(`${BASE}/ventes?limite=${limite}`);

export const getVente = (id) => requete(`${BASE}/ventes/${id}`);

// --- Fournisseurs (admin uniquement) ---
export const getFournisseurs = () => requete(`${BASE}/fournisseurs`);

export const creerFournisseur = (donnees) =>
  requete(`${BASE}/fournisseurs`, {
    method: 'POST',
    body: JSON.stringify(donnees),
  });

export const modifierFournisseur = (id, donnees) =>
  requete(`${BASE}/fournisseurs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(donnees),
  });

export const supprimerFournisseur = (id) =>
  requete(`${BASE}/fournisseurs/${id}`, { method: 'DELETE' });

// --- Bons de commande (admin uniquement) ---
export const getCommandes = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return requete(`${BASE}/commandes${query ? '?' + query : ''}`);
};

export const getCommande = (id) => requete(`${BASE}/commandes/${id}`);

export const creerCommande = (donnees) =>
  requete(`${BASE}/commandes`, {
    method: 'POST',
    body: JSON.stringify(donnees),
  });

export const changerStatutCommande = (id, statut) =>
  requete(`${BASE}/commandes/${id}/statut`, {
    method: 'PUT',
    body: JSON.stringify({ statut }),
  });

export const supprimerCommande = (id) =>
  requete(`${BASE}/commandes/${id}`, { method: 'DELETE' });

// --- Sauvegardes de la base (admin uniquement) ---
export const getSauvegardes = () => requete(`${BASE}/sauvegardes`);

export const creerSauvegarde = () =>
  requete(`${BASE}/sauvegardes`, { method: 'POST' });

// --- Changement de son propre mot de passe ---
export const changerMotDePasse = (donnees) =>
  requete(`${BASE}/auth/mot-de-passe`, {
    method: 'PUT',
    body: JSON.stringify(donnees),
  });

// --- Export CSV : téléchargement avec la session (cookie) ---
// On récupère le fichier en blob, puis on déclenche le téléchargement
export async function telechargerCSV(chemin, nomFichier) {
  const reponse = await fetch(`${BASE}${chemin}`, { credentials: 'include' });
  if (!reponse.ok) {
    const donnees = await reponse.json().catch(() => ({}));
    throw new Error(donnees.erreur || 'Export impossible');
  }
  const blob = await reponse.blob();
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichier || 'export.csv';
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  URL.revokeObjectURL(url);
}
