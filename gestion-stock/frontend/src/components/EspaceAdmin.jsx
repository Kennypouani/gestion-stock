// ============================================================
// ESPACE ADMIN — Gestion des comptes utilisateurs
// Visible UNIQUEMENT pour le rôle admin (filtré dans App.jsx)
// Interface simple : liste + création + modification en ligne
// ============================================================

import { useState, useEffect } from 'react';
import {
  getUtilisateurs,
  getBoutiques,
  creerUtilisateur,
  modifierUtilisateur,
  reinitialiserMotDePasse,
  supprimerUtilisateur,
  getSauvegardes,
  creerSauvegarde,
} from '../api';

// Formulaire de création vide
// boutique_id : OBLIGATOIRE pour le gérant et l'employé, ignoré pour l'admin
const COMPTE_VIDE = { nom: '', email: '', mot_de_passe: '', role: 'employe', boutique_id: '' };

// Libellés complets des rôles (messages et panneaux)
const LIBELLE_ROLE = {
  admin: 'Administrateur',
  gerant: 'Gérant',
  employe: 'Employé',
};

function EspaceAdmin({ utilisateurCourant }) {
  const [liste, setListe] = useState([]);
  const [formulaire, setFormulaire] = useState(COMPTE_VIDE);
  const [message, setMessage] = useState(null);
  const [enCours, setEnCours] = useState(false);
  // Champ de réinitialisation ouvert : { id, motDePasse }
  const [reset, setReset] = useState(null);
  // Copies de sécurité de la base de données
  const [sauvegardes, setSauvegardes] = useState([]);
  // Boutiques du réseau : pour rattacher un gérant / un employé à un magasin
  const [boutiques, setBoutiques] = useState([]);
  // Panneau de rattachement ouvert : { id, nom, boutique_id, rolePrevue? }
  const [rattachement, setRattachement] = useState(null);

  // Seules les boutiques NON archivées peuvent accueillir un compte
  const boutiquesActives = boutiques.filter((b) => Number(b.actif) === 1);

  useEffect(() => {
    charger();
    chargerBoutiques();
    chargerSauvegardes();
  }, []);

  // Dès que les boutiques arrivent, on présélectionne la première :
  // le rattachement reste obligatoire, on évite juste un clic inutile
  useEffect(() => {
    if (boutiquesActives.length === 0) return;
    setFormulaire((f) =>
      f.boutique_id ? f : { ...f, boutique_id: String(boutiquesActives[0].id) }
    );
  }, [boutiques]);

  async function charger() {
    try {
      setListe(await getUtilisateurs());
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  // Les boutiques sont stables : un seul chargement suffit
  async function chargerBoutiques() {
    try {
      setBoutiques(await getBoutiques());
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  async function chargerSauvegardes() {
    try {
      setSauvegardes(await getSauvegardes());
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  // --- Création manuelle d'une sauvegarde ---
  async function creerCopie() {
    try {
      const copie = await creerSauvegarde();
      afficher('succes', `💾 Sauvegarde ${copie.nom} créée (${copie.taille_lisible})`);
      chargerSauvegardes();
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  function afficher(type, texte) {
    setMessage({ type, texte });
    setTimeout(() => setMessage(null), 4000);
  }

  function changerChamp(e) {
    const { name, value } = e.target;
    setFormulaire((a) => ({ ...a, [name]: value }));
  }

  // --- Création d'un compte ---
  async function creer(e) {
    e.preventDefault();
    setEnCours(true);
    try {
      // L'admin n'appartient à AUCUNE boutique : le champ n'est pas envoyé.
      // Pour les autres rôles, boutique_id est converti en nombre (l'API l'exige).
      const aEnvoyer = { ...formulaire };
      if (aEnvoyer.role === 'admin') {
        delete aEnvoyer.boutique_id;
      } else {
        aEnvoyer.boutique_id = parseInt(aEnvoyer.boutique_id, 10);
      }

      await creerUtilisateur(aEnvoyer);

      const boutiqueChoisie = boutiques.find(
        (b) => String(b.id) === String(formulaire.boutique_id)
      );
      afficher(
        'succes',
        `✅ Compte « ${formulaire.nom} » créé` +
          (formulaire.role === 'admin'
            ? ' — administration du réseau'
            : boutiqueChoisie
              ? ` — ${LIBELLE_ROLE[formulaire.role]} de « ${boutiqueChoisie.nom} »`
              : '')
      );
      setFormulaire({
        ...COMPTE_VIDE,
        // On garde la boutique présélectionnée : l'admin crée souvent
        // plusieurs comptes pour le même magasin d'un coup
        boutique_id: boutiquesActives[0] ? String(boutiquesActives[0].id) : '',
      });
      charger();
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    } finally {
      setEnCours(false);
    }
  }

  // --- Changement de rôle (menu déroulant) ---
  async function changerRole(u, role) {
    // Un gérant ou un employé DOIT appartenir à une boutique :
    // si le compte n'en a pas encore (ex : on promeut un admin),
    // on ouvre le panneau de rattachement AVANT d'envoyer le rôle.
    if (role !== 'admin' && !u.boutique_id) {
      setRattachement({ id: u.id, nom: u.nom, boutique_id: '', rolePrevue: role });
      return;
    }
    try {
      await modifierUtilisateur(u.id, { role });
      afficher('succes', `✅ Rôle modifié → ${LIBELLE_ROLE[role]}`);
      charger();
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
      charger(); // Remet l'ancienne valeur affichée
    }
  }

  // --- Rattachement à une boutique (ou association rôle + boutique) ---
  function demanderRattachement(u, rolePrevue = null) {
    setRattachement({
      id: u.id,
      nom: u.nom,
      boutique_id: u.boutique_id ? String(u.boutique_id) : '',
      rolePrevue,
    });
  }

  async function confirmerRattachement() {
    if (!rattachement || !rattachement.boutique_id) return;
    try {
      const donnees = { boutique_id: parseInt(rattachement.boutique_id, 10) };
      if (rattachement.rolePrevue) donnees.role = rattachement.rolePrevue;
      await modifierUtilisateur(rattachement.id, donnees);

      const boutique = boutiques.find(
        (b) => String(b.id) === rattachement.boutique_id
      );
      afficher(
        'succes',
        `✅ ${rattachement.nom} → ${boutique ? boutique.nom : ''} — ses sessions ont été fermées`
      );
      setRattachement(null);
      charger();
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  // --- Activation / désactivation ---
  async function basculerStatut(u) {
    const confirmation = u.actif
      ? window.confirm(`Désactiver le compte de ${u.nom} ? Ses sessions seront fermées.`)
      : window.confirm(`Réactiver le compte de ${u.nom} ?`);
    if (!confirmation) return;
    try {
      await modifierUtilisateur(u.id, { actif: !u.actif });
      afficher('succes', u.actif ? '🔴 Compte désactivé' : '🟢 Compte réactivé');
      charger();
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  // --- Réinitialisation du mot de passe ---
  async function confirmerReset() {
    if (!reset || !reset.motDePasse) return;
    try {
      await reinitialiserMotDePasse(reset.id, reset.motDePasse);
      afficher('succes', '🔑 Mot de passe réinitialisé — les sessions ont été fermées');
      setReset(null);
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  // --- Suppression ---
  async function supprimer(u) {
    if (!window.confirm(`Supprimer définitivement le compte de ${u.nom} ?`)) return;
    try {
      await supprimerUtilisateur(u.id);
      afficher('succes', `🗑️ Compte de ${u.nom} supprimé`);
      charger();
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  return (
    <div>
      {message && (
        <div className={`message ${message.type === 'erreur' ? 'message-erreur' : 'message-succes'}`}>
          {message.texte}
        </div>
      )}

      {/* --- Formulaire de création --- */}
      <section className="bloc">
        <h2>➕ Créer un compte</h2>
        <form className="formulaire" onSubmit={creer}>
          <div className="champ">
            <label>Nom complet *</label>
            <input name="nom" value={formulaire.nom} onChange={changerChamp}
                   placeholder="Ex : Mariam Koné" required />
          </div>
          <div className="champ">
            <label>Email *</label>
            <input type="email" name="email" value={formulaire.email} onChange={changerChamp}
                   placeholder="prenom@magasin.fr" required />
          </div>
          <div className="champ">
            <label>Mot de passe * (8 caractères min.)</label>
            <input type="password" name="mot_de_passe" value={formulaire.mot_de_passe}
                   onChange={changerChamp} placeholder="••••••••" minLength={8} required />
          </div>
          <div className="champ">
            <label>Rôle</label>
            <select name="role" value={formulaire.role} onChange={changerChamp}>
              <option value="employe">🧑‍💼 Employé — la caisse</option>
              <option value="gerant">🧑‍🏫 Gérant — sa boutique</option>
              <option value="admin">👔 Administrateur — tout le réseau</option>
            </select>
          </div>

          {/* --- Rattachement OBLIGATOIRE pour le gérant et l'employé --- */}
          {formulaire.role !== 'admin' && (
            <div className="champ">
              <label>Boutique *</label>
              {boutiquesActives.length === 0 ? (
                <p className="vide">
                  Aucune boutique active : créez d'abord une boutique pour rattacher un compte.
                </p>
              ) : (
                <select
                  name="boutique_id"
                  value={formulaire.boutique_id}
                  onChange={changerChamp}
                  required
                >
                  <option value="">— Choisir la boutique —</option>
                  {boutiquesActives.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nom} (code ticket : {b.code})
                    </option>
                  ))}
                </select>
              )}
              <small>
                Ce compte ne verra QUE les produits, tickets et chiffres de cette boutique.
              </small>
            </div>
          )}
          <div className="actions-formulaire">
            <button type="submit" className="btn-principal" disabled={enCours}>
              {enCours ? 'Création…' : '➕ Créer le compte'}
            </button>
          </div>
        </form>
      </section>

      {/* --- Liste des comptes --- */}
      <section className="bloc">
        <h2>👥 Comptes ({liste.length})</h2>
        {liste.length === 0 ? (
          <p className="vide">Aucun compte.</p>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Email</th>
                <th>Rôle</th>
                <th>Boutique</th>
                <th>Statut</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((u) => {
                const moi = u.id === utilisateurCourant.id;
                return (
                  <tr key={u.id} className={u.actif ? '' : 'ligne-alerte'}>
                    <td>
                      {u.nom}
                      {moi && <span className="badge-moi"> (vous)</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      {/* Le rôle se change directement dans le menu */}
                      <select
                        value={u.role}
                        disabled={moi}
                        onChange={(e) => changerRole(u, e.target.value)}
                        className="select-role"
                      >
                        <option value="employe">Employé</option>
                        <option value="gerant">Gérant</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    {/* --- Boutique de rattachement --- */}
                    <td>
                      {u.role === 'admin' ? (
                        <span className="badge-role">🌐 Réseau entier</span>
                      ) : u.boutique_nom ? (
                        <span title={u.boutique_nom}>
                          📍 {u.boutique_nom} <span className="badge-role">[{u.boutique_code}]</span>
                        </span>
                      ) : (
                        <button
                          className="btn-modifier"
                          title="Ce compte n'appartient à aucune boutique : rattachez-le"
                          onClick={() => demanderRattachement(u, u.role)}
                        >
                          ⚠️ À rattacher
                        </button>
                      )}
                    </td>
                    <td>
                      <span className={u.actif ? 'badge-actif' : 'badge-inactif'}>
                        {u.actif ? '🟢 Actif' : '🔴 Inactif'}
                      </span>
                    </td>
                    <td className="cellule-actions">
                      {/* Réinitialiser le mot de passe */}
                      <button
                        className="btn-modifier"
                        title="Réinitialiser le mot de passe"
                        onClick={() => setReset({ id: u.id, nom: u.nom, motDePasse: '' })}
                      >
                        🔑
                      </button>
                      {/* Changer la boutique de rattachement */}
                      {u.role !== 'admin' && !moi && (
                        <button
                          className="btn-modifier"
                          title="Changer la boutique de ce compte"
                          onClick={() => demanderRattachement(u)}
                        >
                          🏠
                        </button>
                      )}
                      {/* Activer / désactiver */}
                      {!moi && (
                        <button
                          className={u.actif ? 'btn-supprimer' : 'btn-modifier'}
                          title={u.actif ? 'Désactiver' : 'Réactiver'}
                          onClick={() => basculerStatut(u)}
                        >
                          {u.actif ? '🚫' : '✅'}
                        </button>
                      )}
                      {/* Supprimer */}
                      {!moi && (
                        <button
                          className="btn-supprimer"
                          title="Supprimer le compte"
                          onClick={() => supprimer(u)}
                        >
                          🗑️
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* --- Panneau de réinitialisation (apparaît sous le tableau) --- */}
        {reset && (
          <div className="panneau-reset">
            <p>
              🔑 Nouveau mot de passe pour <strong>{reset.nom}</strong> :
            </p>
            <input
              type="password"
              value={reset.motDePasse}
              placeholder="8 caractères minimum"
              onChange={(e) => setReset({ ...reset, motDePasse: e.target.value })}
              autoFocus
            />
            <button className="btn-principal" onClick={confirmerReset}>
              Confirmer
            </button>
            <button className="btn-secondaire" onClick={() => setReset(null)}>
              Annuler
            </button>
          </div>
        )}

        {/* --- Panneau de rattachement à une boutique --- */}
        {rattachement && (
          <div className="panneau-reset">
            <p>
              🏠{' '}
              {rattachement.rolePrevue
                ? `Nouveau rôle « ${LIBELLE_ROLE[rattachement.rolePrevue]} » pour `
                : 'Boutique de rattachement de '}
              <strong>{rattachement.nom}</strong> :
            </p>
            <select
              value={rattachement.boutique_id}
              onChange={(e) =>
                setRattachement({ ...rattachement, boutique_id: e.target.value })
              }
              autoFocus
            >
              <option value="">— Choisir la boutique —</option>
              {boutiquesActives.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nom} ({b.code})
                </option>
              ))}
            </select>
            <button
              className="btn-principal"
              onClick={confirmerRattachement}
              disabled={!rattachement.boutique_id}
            >
              Confirmer
            </button>
            <button className="btn-secondaire" onClick={() => setRattachement(null)}>
              Annuler
            </button>
            <small>
              Les sessions ouvertes de ce compte seront fermées : il devra se reconnecter.
            </small>
          </div>
        )}
      </section>

      {/* ================= Sauvegardes de la base ================= */}
      <section className="bloc">
        <div className="entete-section">
          <h2>💾 Sauvegardes de la base</h2>
          <button className="btn-principal" onClick={creerCopie}>
            📌 Créer une sauvegarde
          </button>
        </div>

        <p className="note-securite">
          Une copie est créée automatiquement au démarrage du serveur, puis toutes les 24 h.
          Les 7 plus récentes sont conservées.
        </p>

        {sauvegardes.length === 0 ? (
          <p className="vide">Aucune sauvegarde pour l'instant.</p>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Fichier</th>
                <th>Date</th>
                <th>Taille</th>
                <th>Téléchargement</th>
              </tr>
            </thead>
            <tbody>
              {sauvegardes.map((s) => (
                <tr key={s.nom}>
                  <td>{s.nom}</td>
                  <td className="date-historique">{s.date}</td>
                  <td>{s.taille_lisible}</td>
                  <td>
                    {/* Le cookie de session accompagne la requête */}
                    <a
                      className="valeur-lien"
                      href={`${import.meta.env.VITE_API_URL || 'http://localhost:5000/api'}/sauvegardes/${s.nom}`}
                    >
                      ⬇️ Télécharger
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export default EspaceAdmin;
