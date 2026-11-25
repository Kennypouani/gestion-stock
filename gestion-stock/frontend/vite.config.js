// ============================================================
// CONFIGURATION VITE — serveur de développement React
// et génération des fichiers SEO (robots.txt, sitemap.xml)
// ============================================================
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Domaine public utilisé pour robots.txt et sitemap.xml.
// À remplacer à UN SEUL endroit : SITE_URL dans frontend/.env
// (modèle : frontend/.env.example — détail : MISE-EN-PRODUCTION.md).
const SITE_URL_PAR_DEFAUT = 'https://stock-magasin.duckdns.org';

// --- Contenu des deux fichiers, calculé à partir du domaine ---
function fichiersSeo(siteUrl) {
  const robots = `# robots.txt — Gestion de stock
# Généré au build depuis SITE_URL (frontend/.env).

User-agent: *
# L'API n'a rien à faire dans un moteur de recherche : les routes protégées
# répondent 401 et les pages publiques sont déjà listées dans le sitemap.
Disallow: /api/

Sitemap: ${siteUrl}/sitemap.xml
`;

  // Pages publiques uniquement : l'application connectée n'est pas indexée.
  const pages = [
    { chemin: '/', frequence: 'monthly', priorite: '1.0' },
    { chemin: '/confidentialite', frequence: 'yearly', priorite: '0.6' },
    { chemin: '/conditions-generales', frequence: 'yearly', priorite: '0.6' },
  ];
  const date = new Date().toISOString().slice(0, 10);

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map(
    (page) => `  <url>
    <loc>${siteUrl}${page.chemin}</loc>
    <lastmod>${date}</lastmod>
    <changefreq>${page.frequence}</changefreq>
    <priority>${page.priorite}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;

  return { robots, sitemap };
}

// --- Plugin : sert les fichiers en développement, les écrit dans dist/ ---
function pluginSeo(siteUrl) {
  const { robots, sitemap } = fichiersSeo(siteUrl);

  return {
    name: 'fichiers-seo',
    configureServer(serveur) {
      serveur.middlewares.use((requete, reponse, suite) => {
        if (requete.url === '/robots.txt') {
          reponse.setHeader('Content-Type', 'text/plain; charset=utf-8');
          return reponse.end(robots);
        }
        if (requete.url === '/sitemap.xml') {
          reponse.setHeader('Content-Type', 'application/xml; charset=utf-8');
          return reponse.end(sitemap);
        }
        suite();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const siteUrl = (env.SITE_URL || SITE_URL_PAR_DEFAUT).replace(/\/+$/, '');

  if (mode === 'production' && siteUrl === SITE_URL_PAR_DEFAUT) {
    console.warn(
      `⚠️  SITE_URL non défini : robots.txt et sitemap.xml utilisent ${SITE_URL_PAR_DEFAUT}. ` +
        'Renseignez SITE_URL dans frontend/.env avant la mise en ligne.'
    );
  }

  return {
    plugins: [react(), pluginSeo(siteUrl)],
    server: {
      port: 3000, // React tournera sur http://localhost:3000
    },
  };
});
