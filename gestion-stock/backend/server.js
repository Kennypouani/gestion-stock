// ============================================================
// SERVEUR PRINCIPAL — Gestion de stock supermarché
// Ce fichier démarre le serveur web et connecte la base de données
// ============================================================

const express = require('express');   // Framework web pour créer l'API
const cors = require('cors');         // Autorise le frontend (React) à appeler l'API
const helmet = require('helmet');     // En-têtes HTTP de sécurité
const db = require('./database');     // Notre connexion à la base de données
const config = require('./config');   // Réglages lus dans l'environnement (.env)

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
const { verifierConnexion, exigerRole, purgerSessionsExpirees } = require('./auth'); // Middlewares d'auth

const app = express();
// Le port d'écoute : PORT de l'environnement, sinon 5000
const PORT = config.port;

// --- Derrière un reverse proxy (Nginx, Caddy) ---
// Sans ce réglage, toutes les requêtes semblent venir de la même IP
// et le limiteur anti-force-brute bloquerait tout le monde à la fois
// (ou ne verrait qu'un seul client). On ne fait confiance qu'au nombre
// de sauts déclaré dans TRUST_PROXY, jamais à l'en-tête seul.
if (config.trustProxy !== false) {
  app.set('trust proxy', config.trustProxy);
}

// --- HTTPS obligatoire ---
// Un visiteur ne doit jamais pouvoir se connecter en clair : le cookie de
// session (et le mot de passe envoyé au login) traverseraient le réseau
// sans chiffrement. On redirige AVANT tout traitement métier.
// 308 (et non 301/302) conserve la méthode et le corps : un POST de
// connexion reste un POST après la redirection.
if (config.forcerHttps) {
  app.use((requete, reponse, suite) => {
    // req.secure s'appuie sur la connexion TLS ou, derrière un proxy de
    // confiance (TRUST_PROXY), sur l'en-tête X-Forwarded-Proto.
    if (requete.secure) return suite();

    // L'hôte vient du client : on refuse tout ce qui n'est pas un nom ou
    // un nom:port valide, pour ne pas fabriquer une redirection piégée.
    const hote = String(requete.get('host') || '').trim();
    if (!/^[a-z0-9.-]+(:\d+)?$/i.test(hote)) {
      return reponse.status(400).json({ erreur: 'En-tête Host invalide' });
    }

    return reponse.redirect(308, `https://${hote.replace(/:80$/, '')}${requete.originalUrl}`);
  });
}

// --- Middlewares (fonctions qui tournent avant chaque requête) ---
// helmet : ajoute les en-têtes de sécurité (X-Frame-Options, anti-sniffing, etc.)
app.use(helmet({
  // Notre frontend React (localhost:3000) doit pouvoir lire les réponses de l'API
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // HSTS : une fois le site vu en HTTPS, le navigateur ne doit plus jamais
  // le contacter en clair. Envoyé uniquement quand HTTPS est imposé
  // (les navigateurs ignorent l'en-tête reçu en HTTP, et un poste de
  // développement en HTTP local ne doit pas être épinglé).
  hsts: config.forcerHttps ? { maxAge: 60 * 60 * 24 * 365 } : false,
}));
app.use(cors({
  // Seule(s) origine(s) déclarée(s) dans ORIGINE_FRONTEND ont le droit d'appeler l'API
  origin: config.originesFrontend,
  credentials: true,                  // Autorise l'envoi du cookie de session
}));
app.use(express.json());     // Comprend le format JSON envoyé par le frontend

// --- Routes publiques (sans connexion) ---
app.use('/api/auth', authRoutes);             // POST /api/auth/connexion, etc.
app.get('/api/sante', (req, res) => {
  res.json({ statut: 'ok', message: 'Le serveur fonctionne ✅' });
});
// Réglages publics lus par le frontend AVANT la connexion.
// Aucune donnée sensible : uniquement ce que l'écran de login doit adapter.
app.get('/api/config', (req, res) => {
  // no-store : un navigateur ne doit pas garder un ancien mode en cache
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    securite_stricte: config.securiteStricte,
    comptes_demo: config.comptesDemo,
  });
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

// --- Route /api inconnue : réponse JSON, jamais la page d'erreur d'Express ---
// Sans ce garde-fou, Express renvoie « Cannot GET /api/... » en HTML anglais,
// ce qui casse le format attendu par le frontend.
app.use('/api', (req, res) => {
  res.status(404).json({
    erreur: 'Route inconnue — vérifiez l’adresse appelée',
    chemin: req.originalUrl,
  });
});

// --- Gestion des erreurs (affiche une erreur claire au lieu de planter) ---
app.use((err, req, res, next) => {
  console.error('Erreur serveur :', err.message);
  res.status(500).json({ erreur: 'Erreur interne du serveur' });
});

// --- Démarrage du serveur ---
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT} (${config.environnement})`);
  // 🧹 Nettoyage des sessions expirées : au démarrage puis toutes les heures
  const supprimees = purgerSessionsExpirees();
  if (supprimees > 0) console.log(`🧹 ${supprimees} session(s) expirée(s) supprimée(s)`);
  const minuterieSessions = setInterval(() => {
    const n = purgerSessionsExpirees();
    if (n > 0) console.log(`🧹 ${n} session(s) expirée(s) supprimée(s)`);
  }, 60 * 60 * 1000);
  minuterieSessions.unref?.(); // Ne bloque pas l'arrêt du serveur
  // 💾 Une copie de la base au démarrage, puis automatiquement toutes les 24 h
  sauvegarde.demarrerAutomatique();
});
