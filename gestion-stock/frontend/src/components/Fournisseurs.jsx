// ============================================================
// FOURNISSEURS & COMMANDES (ADMIN uniquement)
// 1. Répertoire des fournisseurs (création, modification, archivage)
// 2. Bons de commande : en attente → envoyée → reçue
//    « Reçue » met le stock à jour côté serveur et journalise.
// ============================================================

import { useState, useEffect } from 'react';
import {
  getFournisseurs,
  creerFournisseur,
  modifierFournisseur,
  supprimerFournisseur,
  getCommandes,
  getCommande,
  creerCommande,
  changerStatutCommande,
  supprimerCommande,
  getProduits,
} from '../api';

const FORMULAIRE_VIDE = {
  nom: '',
  contact_nom: '',
  email: '',
  telephone: '',
  adresse: '',
};

const LIGNE_VIDE = { produit_id: '', quantite: 1, prix_unitaire: '' };

const LIBELLES_STATUT = {
  en_attente: '⏳ En attente',
  envoyee: '📤 Envoyée',
  recue: '✅ Reçue',
  annulee: '🚫 Annulée',
};

const FCFA = (m) => Number(m || 0).toLocaleString('fr-FR');

function Fournisseurs({ estAdmin = false }) {
  const [fournisseurs, setFournisseurs] = useState([]);
  const [commandes, setCommandes] = useState([]);
  const [produits, setProduits] = useState([]);
  const [message, setMessage] = useState(null);

  // Formulaire fournisseur
  const [formF, setFormF] = useState(FORMULAIRE_VIDE);
  const [editionF, setEditionF] = useState(null);

  // Formulaire de commande
  const [fournisseurId, setFournisseurId] = useState('');
  const [notes, setNotes] = useState('');
  const [lignes, setLignes] = useState([{ ...LIGNE_VIDE }]);

  // Détail d'une commande ouverte en modale
  const [commandeOuverte, setCommandeOuverte] = useState(null);

  useEffect(() => {
    charger();
  }, []);

  async function charger() {
    try {
      const [f, c, p] = await Promise.all([getFournisseurs(), getCommandes(), getProduits()]);
      setFournisseurs(f);
      setCommandes(c);
      setProduits(p);
    } catch (e) {
      afficher('erreur', e.message);
    }
  }

  function afficher(type, texte) {
    setMessage({ type, texte });
    setTimeout(() => setMessage(null), 5000);
  }

  // ============================ FOURNISSEURS ============================

  async function soumettreFournisseur(e) {
    e.preventDefault();
    try {
      if (editionF) {
        await modifierFournisseur(editionF, formF);
        afficher('succes', `✅ « ${formF.nom} » modifié`);
      } else {
        await creerFournisseur(formF);
        afficher('succes', `✅ Fournisseur « ${formF.nom} » créé`);
      }
      setFormF(FORMULAIRE_VIDE);
      setEditionF(null);
      charger();
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  function editerFournisseur(f) {
    setFormF({
      nom: f.nom,
      contact_nom: f.contact_nom || '',
      email: f.email || '',
      telephone: f.telephone || '',
      adresse: f.adresse || '',
    });
    setEditionF(f.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // --- Réactivation d'un fournisseur archivé ---
  async function reactiverFournisseur(f) {
    try {
      await modifierFournisseur(f.id, { actif: 1 });
      afficher('succes', `🟢 « ${f.nom} » est de nouveau actif`);
      charger();
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  async function supprimerF(f) {
    if (!window.confirm(`Supprimer ou archiver « ${f.nom} » ?`)) return;
    try {
      const reponse = await supprimerFournisseur(f.id);
      afficher('succes', `🗑️ ${reponse.message}`);
      charger();
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  // ============================ COMMANDES ============================

  function changerLigne(index, champ, valeur) {
    setLignes((ancien) =>
      ancien.map((l, i) => (i === index ? { ...l, [champ]: valeur } : l))
    );
  }

  // Quand on choisit un produit, on pré-remplit le prix d'achat connu
  function choisirProduit(index, produitId) {
    const produit = produits.find((p) => String(p.id) === String(produitId));
    changerLigne(index, 'produit_id', produitId);
    changerLigne(index, 'prix_unitaire', produit ? produit.prix_achat : '');
  }

  const totalCommande = lignes.reduce(
    (somme, l) => somme + (parseFloat(l.prix_unitaire) || 0) * (parseInt(l.quantite, 10) || 0),
    0
  );

  async function soumettreCommande(e) {
    e.preventDefault();
    if (!fournisseurId) return afficher('erreur', '❌ Choisissez un fournisseur');
    const valides = lignes.filter((l) => l.produit_id && parseInt(l.quantite, 10) > 0);
    if (valides.length === 0) return afficher('erreur', '❌ Ajoutez au moins une ligne à la commande');

    try {
      const commande = await creerCommande({
        fournisseur_id: parseInt(fournisseurId, 10),
        notes,
        lignes: valides.map((l) => ({
          produit_id: parseInt(l.produit_id, 10),
          quantite: parseInt(l.quantite, 10),
          prix_unitaire: parseFloat(l.prix_unitaire) || 0,
        })),
      });
      afficher('succes', `✅ Commande ${commande.numero} créée — ${FCFA(commande.montant_total)} FCFA`);
      setNotes('');
      setLignes([{ ...LIGNE_VIDE }]);
      charger();
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  async function changerStatut(commande, statut) {
    const messageConfirm = {
      envoyee: `Marquer la commande ${commande.numero} comme ENVOYÉE ?`,
      recue: `Réceptionner la commande ${commande.numero} ? Le stock sera mis à jour automatiquement.`,
      annulee: `Annuler la commande ${commande.numero} ?`,
    }[statut];
    if (!window.confirm(messageConfirm)) return;

    try {
      await changerStatutCommande(commande.id, statut);
      afficher(
        'succes',
        statut === 'recue'
          ? `✅ Commande ${commande.numero} reçue — stock et journal mis à jour`
          : `✅ Commande ${commande.numero} → ${LIBELLES_STATUT[statut]}`
      );
      charger();
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  async function supprimerCommandeLigne(commande) {
    if (!window.confirm(`Supprimer la commande ${commande.numero} ?`)) return;
    try {
      await supprimerCommande(commande.id);
      afficher('succes', '🗑️ Commande supprimée');
      charger();
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  async function ouvrirCommande(commande) {
    try {
      setCommandeOuverte(await getCommande(commande.id));
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  const actifs = fournisseurs.filter((f) => f.actif === 1 || f.actif === undefined);

  return (
    <div>
      {message && (
        <div className={`message ${message.type === 'erreur' ? 'message-erreur' : 'message-succes'}`}>
          {message.texte}
        </div>
      )}

      {/* ---------------- Formulaire fournisseur (admin seul) ---------------- */}
      {estAdmin && (
      <section className="bloc">
        <h2>{editionF ? '✏️ Modifier le fournisseur' : '➕ Nouveau fournisseur'}</h2>
        <form className="formulaire" onSubmit={soumettreFournisseur}>
          <div className="champ">
            <label>Nom *</label>
            <input
              value={formF.nom}
              onChange={(e) => setFormF({ ...formF, nom: e.target.value })}
              placeholder="Ex : Laiterie du Nord"
              required
            />
          </div>
          <div className="champ">
            <label>Contact</label>
            <input
              value={formF.contact_nom}
              onChange={(e) => setFormF({ ...formF, contact_nom: e.target.value })}
              placeholder="Ex : Mariam Koné"
            />
          </div>
          <div className="champ">
            <label>Email</label>
            <input
              type="email"
              value={formF.email}
              onChange={(e) => setFormF({ ...formF, email: e.target.value })}
              placeholder="contact@fournisseur.fr"
            />
          </div>
          <div className="champ">
            <label>Téléphone</label>
            <input
              value={formF.telephone}
              onChange={(e) => setFormF({ ...formF, telephone: e.target.value })}
              placeholder="+225 07 00 00 00"
            />
          </div>
          <div className="champ champ-large">
            <label>Adresse</label>
            <input
              value={formF.adresse}
              onChange={(e) => setFormF({ ...formF, adresse: e.target.value })}
              placeholder="Rue, ville…"
            />
          </div>
          <div className="actions-formulaire">
            <button type="submit" className="btn-principal">
              {editionF ? '💾 Enregistrer' : '➕ Ajouter'}
            </button>
            {editionF && (
              <button
                type="button"
                className="btn-secondaire"
                onClick={() => { setFormF(FORMULAIRE_VIDE); setEditionF(null); }}
              >
                Annuler
              </button>
            )}
          </div>
        </form>
      </section>
      )}

      {/* ---------------- Liste des fournisseurs ---------------- */}
      <section className="bloc">
        <h2>🏢 Fournisseurs ({fournisseurs.length})</h2>
        {fournisseurs.length === 0 ? (
          <p className="vide">Aucun fournisseur enregistré pour l'instant.</p>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Téléphone</th>
                <th>Commandes</th>
                {estAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {fournisseurs.map((f) => (
                <tr key={f.id} className={f.actif === 0 ? 'ligne-archive' : ''}>
                  <td>
                    {f.nom}
                    {f.actif === 0 && <span className="badge-alerte">ARCHIVÉ</span>}
                  </td>
                  <td>{f.contact_nom || '—'}</td>
                  <td>{f.email || '—'}</td>
                  <td>{f.telephone || '—'}</td>
                  <td>{f.nb_commandes}</td>
                  {/* Écriture sur le répertoire : réservée à l'admin.
                      Le gérant garde la consultation pour passer ses commandes. */}
                  {estAdmin && (
                  <td className="cellule-actions">
                    <button className="btn-modifier" onClick={() => editerFournisseur(f)}>✏️</button>
                    {f.actif === 0 ? (
                      <button
                        className="btn-modifier"
                        title="Réactiver ce fournisseur"
                        onClick={() => reactiverFournisseur(f)}
                      >
                        🟢
                      </button>
                    ) : (
                      <button className="btn-supprimer" onClick={() => supprimerF(f)}>🗑️</button>
                    )}
                  </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ---------------- Nouveau bon de commande ---------------- */}
      <section className="bloc">
        <h2>📦 Nouveau bon de commande</h2>
        <form className="formulaire" onSubmit={soumettreCommande}>
          <div className="champ">
            <label>Fournisseur *</label>
            <select
              value={fournisseurId}
              onChange={(e) => setFournisseurId(e.target.value)}
              required
            >
              <option value="">— Choisir —</option>
              {actifs.map((f) => (
                <option key={f.id} value={f.id} disabled={f.actif === 0}>
                  {f.nom}{f.actif === 0 ? ' (archivé)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="champ champ-large">
            <label>Notes</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex : livraison attendue vendredi"
            />
          </div>

          <div className="lignes-commande">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Produit *</th>
                  <th>Quantité *</th>
                  <th>Prix d'achat (FCFA) *</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((ligne, index) => (
                  <tr key={index}>
                    <td>
                      <select
                        value={ligne.produit_id}
                        onChange={(e) => choisirProduit(index, e.target.value)}
                        required
                      >
                        <option value="">— Choisir —</option>
                        {produits.map((p) => (
                          <option key={p.id} value={p.id}>{p.nom}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        className="saisie-quantite"
                        value={ligne.quantite}
                        onChange={(e) => changerLigne(index, 'quantite', e.target.value)}
                        required
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="saisie-prix"
                        value={ligne.prix_unitaire}
                        onChange={(e) => changerLigne(index, 'prix_unitaire', e.target.value)}
                        required
                      />
                    </td>
                    <td>{FCFA((parseFloat(ligne.prix_unitaire) || 0) * (parseInt(ligne.quantite, 10) || 0))}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-supprimer"
                        onClick={() => setLignes((ancien) => ancien.filter((_, i) => i !== index))}
                        disabled={lignes.length === 1}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="actions-formulaire">
              <button
                type="button"
                className="btn-secondaire"
                onClick={() => setLignes((ancien) => [...ancien, { ...LIGNE_VIDE }])}
              >
                ➕ Ajouter une ligne
              </button>
            </div>
          </div>

          <div className="ligne-total ligne-total-grand">
            <span>Montant de la commande</span>
            <strong>{FCFA(totalCommande)} FCFA</strong>
          </div>

          <div className="actions-formulaire">
            <button type="submit" className="btn-principal">📝 Créer le bon de commande</button>
          </div>
        </form>
      </section>

      {/* ---------------- Liste des commandes ---------------- */}
      <section className="bloc">
        <h2>🧾 Bons de commande ({commandes.length})</h2>
        {commandes.length === 0 ? (
          <p className="vide">Aucune commande.</p>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>N°</th>
                <th>Fournisseur</th>
                <th>Date</th>
                <th>Montant</th>
                <th>Statut</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {commandes.map((c) => (
                <tr key={c.id}>
                  <td>
                    <button className="valeur-lien" onClick={() => ouvrirCommande(c)}>
                      {c.numero}
                    </button>
                  </td>
                  <td>{c.fournisseur_nom}</td>
                  <td className="date-historique">{String(c.date_commande).slice(0, 16)}</td>
                  <td>{FCFA(c.montant_total)} FCFA</td>
                  <td>
                    <span className={`statut-${c.statut}`}>{LIBELLES_STATUT[c.statut]}</span>
                  </td>
                  <td className="cellule-actions">
                    {c.statut === 'en_attente' && (
                      <button className="btn-modifier" title="Marquer envoyée"
                              onClick={() => changerStatut(c, 'envoyee')}>📤</button>
                    )}
                    {c.statut === 'envoyee' && (
                      <button className="btn-modifier" title="Réceptionner (met à jour le stock)"
                              onClick={() => changerStatut(c, 'recue')}>📥</button>
                    )}
                    {(c.statut === 'en_attente' || c.statut === 'envoyee') && (
                      <button className="btn-supprimer" title="Annuler"
                              onClick={() => changerStatut(c, 'annulee')}>🚫</button>
                    )}
                    {(c.statut === 'en_attente' || c.statut === 'annulee') && (
                      <button className="btn-supprimer" title="Supprimer"
                              onClick={() => supprimerCommandeLigne(c)}>🗑️</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ---------------- Modale détail commande ---------------- */}
      {commandeOuverte && (
        <div className="modale-fond" onClick={() => setCommandeOuverte(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <div className="modale-entete">
              <h2>🧾 {commandeOuverte.numero} — {commandeOuverte.fournisseur_nom}</h2>
              <button className="modale-fermer" onClick={() => setCommandeOuverte(null)}>✕</button>
            </div>

            <p className="date-historique">
              Statut : <strong>{LIBELLES_STATUT[commandeOuverte.statut]}</strong>
              {' · '}commandée le {String(commandeOuverte.date_commande).replace(' ', ' à ')}
              {' · '}par {commandeOuverte.utilisateur_nom}
              {commandeOuverte.recu_par && ` · reçue par ${commandeOuverte.recu_par}`}
            </p>
            {commandeOuverte.notes && <p>📝 {commandeOuverte.notes}</p>}

            <table className="tableau">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Quantité</th>
                  <th>Prix d'achat</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {(commandeOuverte.lignes || []).map((l) => (
                  <tr key={l.id}>
                    <td>{l.produit_nom}</td>
                    <td>{l.quantite}</td>
                    <td>{FCFA(l.prix_unitaire)}</td>
                    <td>{FCFA(l.sous_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="ligne-total ligne-total-grand">
              <span>Total</span>
              <strong>{FCFA(commandeOuverte.montant_total)} FCFA</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Fournisseurs;