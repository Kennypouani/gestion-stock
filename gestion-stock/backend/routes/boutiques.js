// ============================================================
// ROUTES BOUTIQUES — Le réseau de magasins (ADMIN)
// Préfixe : /api/boutiques
// Règles :
//   • Le « code » (suffixe des tickets, ex : TK-NORD-2026-0001)
//     est saisi à la création puis FIGÉ : le changer rendrait
//     ambigu l'historique des tickets déjà émis.
//   • Une boutique ne se supprime jamais, elle s'ARCHIVE (actif = 0),
//     comme les fournisseurs — jamais de perte d'historique.
//   • Un compte ne voit et ne modifie QUE les boutiques qui lui sont
//     rattachées (acces_boutiques) : jamais celle d'un autre compte.
//   • Créer une boutique la rattache automatiquement au compte créateur.
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const { exigerRole, porteeBoutique } = require('../auth');

// Rattache une boutique à un compte (idempotent)
function rattacher(utilisateurId, boutiqueId) {
  db.prepare(
    'INSERT OR IGNORE INTO acces_boutiques (utilisateur_id, boutique_id) VALUES (?, ?)'
  ).run(utilisateurId, boutiqueId);
}

const CODE_REGEX = /^[A-Za-z0-9]{2,10}$/;
const TEL_REGEX = /^[0-9+().\s-]{6,30}$/;
const NETTOYER = (valeur, max) => String(valeur ?? '').trim().slice(0, max);

// --- Code ticket attribué automatiquement ---
// Utilisé quand l'admin laisse le champ vide. Alphabet sans caractères
// ambigus (0/O, 1/I) : le code est lu à voix haute et recopié sur le ticket.
function codeAutomatique() {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let essai = 0; essai < 50; essai += 1) {
    let code = '';
    for (let i = 0; i < 6; i += 1) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    const pris = db.prepare('SELECT 1 FROM boutiques WHERE code = ?').get(code);
    if (!pris) return code;
  }
  // Repli déterministe : ne doit jamais arriver en pratique
  return `B${String(Date.now()).slice(-6)}`;
}

// ============================================================
// 1. LISTER LES BOUTIQUES
// GET /api/boutiques  → admin : tout le réseau / gérant : la sienne
// ============================================================
router.get('/', (req, res) => {
  try {
    const portee = porteeBoutique(req);
    // Compte tout neuf : liste vide (pas une erreur — il doit créer la sienne)
    if (portee.ids.length === 0) return res.json([]);
    const marques = portee.ids.map(() => '?').join(', ');
    const boutiques = db
      .prepare(`SELECT * FROM boutiques WHERE id IN (${marques}) ORDER BY nom COLLATE NOCASE`)
      .all(...portee.ids);

    res.json(boutiques);
  } catch (err) {
    console.error('Erreur liste boutiques :', err.message);
    res.status(500).json({ erreur: 'Impossible de lire les boutiques' });
  }
});

// ============================================================
// 2. CRÉER UNE BOUTIQUE (ADMIN)
// POST /api/boutiques  { nom, ville, quartier, telephone, code? }
// ============================================================
router.post('/', exigerRole('admin'), (req, res) => {
  const nom = NETTOYER(req.body.nom, 80);
  const ville = NETTOYER(req.body.ville, 80);
  const quartier = NETTOYER(req.body.quartier, 80);
  const telephone = NETTOYER(req.body.telephone, 30);
  // Le code ticket est FACULTATIF : vide → attribué automatiquement
  const codeSaisi = NETTOYER(req.body.code, 10).toUpperCase();

  if (nom.length < 2) {
    return res.status(400).json({ erreur: 'Le nom de la boutique doit contenir au moins 2 caractères' });
  }
  if (ville.length < 2) {
    return res.status(400).json({ erreur: 'La ville de la boutique est obligatoire' });
  }
  if (quartier.length < 2) {
    return res.status(400).json({ erreur: 'Le quartier de la boutique est obligatoire' });
  }
  if (!TEL_REGEX.test(telephone)) {
    return res.status(400).json({
      erreur:
        'Le numéro de téléphone est obligatoire (chiffres, +, espaces et tirets — 6 caractères minimum)',
    });
  }
  if (codeSaisi && !CODE_REGEX.test(codeSaisi)) {
    return res.status(400).json({
      erreur: 'Le code (suffixe des tickets) doit contenir 2 à 10 lettres ou chiffres, sans accent ni espace',
    });
  }

  try {
    const doublonNom = db
      .prepare('SELECT id FROM boutiques WHERE LOWER(nom) = LOWER(?)')
      .get(nom);
    if (doublonNom) return res.status(409).json({ erreur: 'Une boutique porte déjà ce nom' });

    if (codeSaisi) {
      const doublonCode = db.prepare('SELECT id FROM boutiques WHERE code = ?').get(codeSaisi);
      if (doublonCode) {
        return res.status(409).json({ erreur: 'Ce code est déjà utilisé par une autre boutique' });
      }
    }

    // Champ laissé vide → un code est attribué aléatoirement (unique)
    const code = codeSaisi || codeAutomatique();

    const resultat = db
      .prepare(
        'INSERT INTO boutiques (nom, code, telephone, ville, quartier) VALUES (?, ?, ?, ?, ?)'
      )
      .run(nom, code, telephone, ville, quartier);

    // La boutique appartient à celui qui la crée : c'est ce lien qui
    // ouvre (et limite) l'accès aux données du magasin.
    rattacher(req.utilisateur.id, Number(resultat.lastInsertRowid));

    const cree = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(resultat.lastInsertRowid);
    res.status(201).json(cree);
  } catch (err) {
    console.error('Erreur création boutique :', err.message);
    res.status(500).json({ erreur: 'Impossible de créer la boutique' });
  }
});

// ============================================================
// 3. MODIFIER UNE BOUTIQUE (ADMIN) — le code reste immuable
// PUT /api/boutiques/2  { nom?, ville?, quartier?, telephone?, actif? }
// ============================================================
router.put('/:id', exigerRole('admin'), (req, res) => {
  const cibleId = parseInt(req.params.id, 10);

  try {
    const existant = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(cibleId);
    // Boutique d'un autre compte → inexistence présumée (404)
    if (!existant || !porteeBoutique(req).ids.includes(cibleId)) {
      return res.status(404).json({ erreur: 'Boutique introuvable' });
    }

    // --- Le code ne change JAMAIS (traçabilité des tickets émis) ---
    if (req.body.code !== undefined) {
      const codeDemande = NETTOYER(req.body.code, 10).toUpperCase();
      if (codeDemande !== existant.code) {
        return res.status(400).json({
          erreur: "Le code d'une boutique ne peut plus être modifié (il identifie ses tickets)",
        });
      }
    }

    // Activation / archivage explicite (0 ou 1)
    if (req.body.actif !== undefined) {
      const actif = Number(req.body.actif);
      if (actif !== 0 && actif !== 1) {
        return res.status(400).json({ erreur: 'La valeur « actif » doit être 0 ou 1' });
      }
      // On ne peut pas archiver la dernière boutique active du réseau
      if (actif === 0) {
        const actives = db.prepare('SELECT COUNT(*) AS n FROM boutiques WHERE actif = 1').get().n;
        if (actives <= 1) {
          return res.status(409).json({ erreur: 'Impossible : ceci laisserait le réseau sans boutique active' });
        }
      }
      db.prepare('UPDATE boutiques SET actif = ? WHERE id = ?').run(actif, cibleId);
    }

    // --- Localisation / contact (facultatifs en modification) ---
    if (req.body.ville !== undefined) {
      const ville = NETTOYER(req.body.ville, 80);
      if (ville.length < 2) {
        return res.status(400).json({ erreur: 'La ville de la boutique est obligatoire' });
      }
      db.prepare('UPDATE boutiques SET ville = ? WHERE id = ?').run(ville, cibleId);
    }
    if (req.body.quartier !== undefined) {
      const quartier = NETTOYER(req.body.quartier, 80);
      if (quartier.length < 2) {
        return res.status(400).json({ erreur: 'Le quartier de la boutique est obligatoire' });
      }
      db.prepare('UPDATE boutiques SET quartier = ? WHERE id = ?').run(quartier, cibleId);
    }
    if (req.body.telephone !== undefined) {
      const telephone = NETTOYER(req.body.telephone, 30);
      if (!TEL_REGEX.test(telephone)) {
        return res.status(400).json({ erreur: 'Numéro de téléphone invalide' });
      }
      db.prepare('UPDATE boutiques SET telephone = ? WHERE id = ?').run(telephone, cibleId);
    }

    const nom = NETTOYER(req.body.nom, 80);
    if (nom) {
      if (nom.length < 2) {
        return res.status(400).json({ erreur: 'Le nom de la boutique doit contenir au moins 2 caractères' });
      }
      const doublon = db
        .prepare('SELECT id FROM boutiques WHERE LOWER(nom) = LOWER(?) AND id <> ?')
        .get(nom, cibleId);
      if (doublon) return res.status(409).json({ erreur: 'Une boutique porte déjà ce nom' });
      db.prepare('UPDATE boutiques SET nom = ? WHERE id = ?').run(nom, cibleId);
    }

        res.json(db.prepare('SELECT * FROM boutiques WHERE id = ?').get(cibleId));
  } catch (err) {
    console.error('Erreur modification boutique :', err.message);
    res.status(500).json({ erreur: 'Impossible de modifier la boutique' });
  }
});

// ============================================================
// 4. ARCHIVER UNE BOUTIQUE (ADMIN) — jamais de suppression
// DELETE /api/boutiques/2
// ============================================================
router.delete('/:id', exigerRole('admin'), (req, res) => {
  const cibleId = parseInt(req.params.id, 10);

  try {
    const existant = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(cibleId);
    if (!existant || !porteeBoutique(req).ids.includes(cibleId)) {
      return res.status(404).json({ erreur: 'Boutique introuvable' });
    }
    if (!existant.actif) {
      return res.json({ message: 'Boutique déjà archivée', archive: true });
    }

    // On ne peut pas archiver sa DERNIÈRE boutique active :
    // le compte se retrouverait sans aucun accès.
    const actives = db
      .prepare(`
        SELECT COUNT(*) AS n FROM acces_boutiques a
        JOIN boutiques b ON b.id = a.boutique_id
        WHERE a.utilisateur_id = ? AND b.actif = 1
      `)
      .get(req.utilisateur.id).n;
    if (actives <= 1) {
      return res.status(409).json({
        erreur: 'Impossible : ceci vous laisserait sans aucune boutique active',
      });
    }

    db.prepare('UPDATE boutiques SET actif = 0 WHERE id = ?').run(cibleId);

    // Les comptes rattachés à CETTE SEULE boutique sont désactivés
    // et déconnectés immédiatement (un admin multi-boutiques garde
    // l'accès à ses autres magasins).
    const seuls = db
      .prepare(`
        SELECT utilisateur_id FROM acces_boutiques
        GROUP BY utilisateur_id
        HAVING COUNT(*) = 1 AND MAX(boutique_id) = ?
      `)
      .all(cibleId)
      .map((l) => l.utilisateur_id);

    const desactiver = db.prepare(
      "UPDATE utilisateurs SET actif = 0 WHERE id = ? AND role <> 'admin'"
    );
    const fermerSessions = db.prepare('DELETE FROM sessions WHERE utilisateur_id = ?');
    for (const id of seuls) {
      desactiver.run(id);
      fermerSessions.run(id);
    }
    // Personne ne garde un accès à une boutique archivée du point de vue
    // des sessions : on retire le rattachement devenu inutile.
    db.prepare('DELETE FROM acces_boutiques WHERE boutique_id = ?').run(cibleId);

    const nbLies = db
      .prepare('SELECT COUNT(*) AS n FROM produits WHERE boutique_id = ?')
      .get(cibleId).n;

    res.json({
      message: `Boutique archivée — ${nbLies} produit(s) conservé(s) pour l'historique`,
      archive: true,
    });
  } catch (err) {
    console.error('Erreur archivage boutique :', err.message);
    res.status(500).json({ erreur: 'Impossible d’archiver la boutique' });
  }
});

module.exports = router;