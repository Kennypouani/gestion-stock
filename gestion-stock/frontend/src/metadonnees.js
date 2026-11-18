// ============================================================
// MÉTADONNÉES — titre et description de chaque écran
// L'application est une SPA : le <head> ne change pas quand on passe
// d'un écran à l'autre. Ces fonctions mettent à jour <title>, la
// description et les balises Open Graph pour que l'onglet du
// navigateur et les aperçus de partage restent exacts.
// ============================================================

const MARQUE = 'Gestion de stock';

export const METADONNEES = {
  application: {
    titre: `${MARQUE} et caisse multi-boutiques & Supermarché`,
    description:
      'Gestion de stock pour supermarché : caisse, mouvements, fournisseurs, commandes et statistiques, avec données cloisonnées par boutique et droits par rôle.',
  },
  connexion: {
    titre: `Connexion — ${MARQUE} supermarché`,
    description:
      'Connectez-vous à la gestion de stock de votre magasin : caisse, stocks, fournisseurs et statistiques selon votre rôle.',
  },
  confidentialite: {
    titre: `Politique de confidentialité — ${MARQUE}`,
    description:
      'Données traitées par l’application (compte, session, ventes, journal), finalités, durées de conservation, sécurité et exercice de vos droits.',
  },
  conditions: {
    titre: `Conditions générales d’utilisation — ${MARQUE}`,
    description:
      'Règles d’utilisation de l’application : comptes et identifiants, usage autorisé, disponibilité, responsabilité et données personnelles.',
  },
  introuvable: {
    titre: `Page introuvable — ${MARQUE}`,
    description:
      'L’adresse demandée ne correspond à aucun écran de l’application de gestion de stock.',
  },
};

function majBalise(selecteur, valeur) {
  const balise = document.head.querySelector(selecteur);
  if (balise) balise.setAttribute('content', valeur);
}

export function appliquerMetadonnees({ titre, description }) {
  document.title = titre;
  majBalise('meta[name="description"]', description);
  majBalise('meta[property="og:title"]', titre);
  majBalise('meta[property="og:description"]', description);
}
