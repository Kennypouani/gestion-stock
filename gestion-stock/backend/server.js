// ============================================================
// SERVEUR PRINCIPAL — Gestion de stock supermarché
// Ce fichier démarre le serveur web et connecte la base de données
// ============================================================

const express = require('express');   // Framework web pour créer l'API
const cors = require('cors');         // Autorise le frontend (React) à appeler l'API
const helmet = require('helmet');     // En-têtes HTTP de sécurité
const db = require('./database');     // Notre connexion à la base de données

const produitRoutes = require('./routes/produits');   // Routes des produits
const mouvementRoutes = require('./routes/mouvements'); // Routes des entrées/sorties de stock
const statsRoutes = require('./routes/stats');         // Routes des statistiques
const authRoutes = require('./routes/auth');           // Routes de connexion/déconnexion
const utilisateurRoutes = require('./routes/utilisateurs'); // Gestion des comptes (admin)
const venteRoutes = require('./routes/ventes');        // Tickets de caisse
const fournisseurRoutes = require('./routes/fournisseurs'); // Répertoire fournisseurs (admin)
const commandeRoutes = require('./routes/commandes');  // Bons de commande (admin)
const exportRoutes = require('./routes/export');       // Exports CSV (admin)
const sauvegardeRoutes = require('./routes/sauvegardes'); // Sauvegardes (admin)
const boutiqueRoutes = require('./routes/boutiques');   // Réseau de boutiques
const sauvegarde = require('./sauvegarde');            // Sauvegarde automatique de la base
const { verifierConnexion, exigerRole } = require('./auth'); // Middlewares d'auth

const app = express();
// Le port d'écoute : 5000 par défaut
// On vérifie que la variable PORT de l'environnement est valide (nombre > 0),
// sinon on utilise 5000 (sinon le serveur écoute sur un port inexistant)
const PORT = (parseInt(process.env.PORT, 10) > 0) ? parseInt(process.env.PORT, 10) : 5000;

// --- Middlewares (fonctions qui tournent avant chaque requête) ---
// helmet : ajoute les en-têtes de sécurité (X-Frame-Options, anti-sniffing, etc.)
app.use(helmet({
  // Notre frontend React (localhost:3000) doit pouvoir lire les réponses de l'API
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: ['http://localhost:3000'], // Seulement notre frontend React a le droit d'appeler l'API
  credentials: true,                  // Autorise l'envoi du cookie de session
}));
app.use(express.json());     // Comprend le format JSON envoyé par le frontend

// --- Routes publiques (sans connexion) ---
app.use('/api/auth', authRoutes);             // POST /api/auth/connexion, etc.
app.get('/api/sante', (req, res) => {
  res.json({ statut: 'ok', message: 'Le serveur fonctionne ✅' });
});

// --- Routes protégées (connexion OBLIGATOIRE) ---
// Produits (stock) et ventes : tous les rôles connectés,
// mais CHAQUE route filtre ensuite par la boutique de la session
app.use('/api/produits', verifierConnexion, produitRoutes);
app.use('/api/ventes', verifierConnexion, venteRoutes);

// --- Isolation multi-boutiques ---
//   admin  → tout le réseau
//   gerant → SA boutique uniquement (filtré dans chaque route)
//   employé→ refusé sur mouvements/stats (il encaisse via /api/ventes)
app.use('/api/mouvements', verifierConnexion, exigerRole('admin', 'gerant'), mouvementRoutes);
app.use('/api/stats', verifierConnexion, exigerRole('admin', 'gerant'), statsRoutes);
// Boutiques : le gérant peut CONSULTER la sienne ; création/modif = admin (dans la route)
app.use('/api/boutiques', verifierConnexion, exigerRole('admin', 'gerant'), boutiqueRoutes);
// Gestion des comptes : connexion obligatoire ET rôle admin
app.use('/api/utilisateurs', verifierConnexion, exigerRole('admin'), utilisateurRoutes);
// Achats, exports : admin + gérant (le gérant ne voit que sa boutique)
// Écritures fournisseurs (création/modif/suppression) = admin seul, garde dans la route
app.use('/api/fournisseurs', verifierConnexion, exigerRole('admin', 'gerant'), fournisseurRoutes);
app.use('/api/commandes', verifierConnexion, exigerRole('admin', 'gerant'), commandeRoutes);
app.use('/api/export', verifierConnexion, exigerRole('admin', 'gerant'), exportRoutes);
// Sauvegardes de la base : réservées à l'administration
app.use('/api/sauvegardes', verifierConnexion, exigerRole('admin'), sauvegardeRoutes);

// --- Gestion des erreurs (affiche une erreur claire au lieu de planter) ---
app.use((err, req, res, next) => {
  console.error('Erreur serveur :', err.message);
  res.status(500).json({ erreur: 'Erreur interne du serveur' });
});

// --- Démarrage du serveur ---
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  // 💾 Une copie de la base au démarrage, puis automatiquement toutes les 24 h
  sauvegarde.demarrerAutomatique();
});
