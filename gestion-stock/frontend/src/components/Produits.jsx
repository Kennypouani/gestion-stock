// ============================================================
// PRODUITS — Liste + recherche + formulaire d'ajout/modification
// C'est l'écran principal de gestion du catalogue
// ============================================================

import { useState, useEffect } from 'react';
import {
  getProduits,
  creerProduit,
  modifierProduit,
  supprimerProduit,
  getHistoriqueProduit,
  telechargerCSV,
} from '../api';

// Modèle d'un produit vide (pour réinitialiser le formulaire)
const PRODUIT_VIDE = {
  nom: '',
  categorie: 'Épicerie',
  prix_achat: '',
  prix_vente: '',
  quantite: 0,
  seuil_alerte: 5,
  code_barre: '',
  date_expiration: '',
};

function Produits({ peutGerer = false, estAdmin = false }) {
  const [produits, setProduits] = useState([]);
  const [recherche, setRecherche] = useState('');
  // Filtre d'expiration : null = tous, 0 = périmés, 7 = expire sous 7 jours
  const [filtreExpiration, setFiltreExpiration] = useState(null);
  const [formulaire, setFormulaire] = useState(PRODUIT_VIDE);
  const [enEdition, setEnEdition] = useState(null); // id du produit modifié, ou null = création
  const [motif, setMotif] = useState('');            // raison de la modification (traçabilité)
  const [message, setMessage] = useState(null);     // { type: 'succes'|'erreur', texte }
  const [chargement, setChargement] = useState(true);
  // Historique affiché : { nom, lignes } ou null (fermé)
  const [historique, setHistorique] = useState(null);

  // Recharge la liste à chaque changement de la recherche OU du filtre
  useEffect(() => {
    charger();
  }, [recherche, filtreExpiration]);

  async function charger() {
    setChargement(true);
    try {
      const criteres = {};
      if (recherche) criteres.recherche = recherche;
      if (filtreExpiration !== null) criteres.expiration = filtreExpiration;
      const liste = await getProduits(criteres);
      setProduits(liste);
    } catch (e) {
      afficher('erreur', e.message);
    } finally {
      setChargement(false); // "finally" = que ça réussisse ou non
    }
  }

  // --- Export CSV du stock (réservé à l'admin côté serveur) ---
  async function exporterCSV() {
    try {
      await telechargerCSV('/export/produits', 'stock.csv');
      afficher('succes', '⬇️ Fichier CSV du stock téléchargé');
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  function afficher(type, texte) {
    setMessage({ type, texte });
    // Efface le message après 4 secondes
    setTimeout(() => setMessage(null), 4000);
  }

  // --- Gestion du formulaire : met à jour un champ à la fois ---
  function changerChamp(e) {
    const { name, value } = e.target;
    setFormulaire((ancien) => ({ ...ancien, [name]: value }));
  }

  // --- Soumission : création OU modification selon l'état ---
  async function soumettre(e) {
    e.preventDefault(); // Empêche le rechargement de la page
    try {
      if (enEdition) {
        // Le motif part avec la modification → enregistré dans le journal
        await modifierProduit(enEdition, { ...formulaire, motif });
        afficher('succes', `✅ « ${formulaire.nom} » modifié — motif : ${motif}`);
      } else {
        await creerProduit(formulaire);
        afficher('succes', `✅ « ${formulaire.nom} » ajouté`);
      }
      setFormulaire(PRODUIT_VIDE);
      setEnEdition(null);
      charger();
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  // --- Remplit le formulaire avec les données du produit à modifier ---
  function editer(p) {
    setFormulaire({ ...p });
    setEnEdition(p.id);
    setMotif(''); // Chaque modification redémarre avec un motif vierge
    window.scrollTo({ top: 0, behavior: 'smooth' }); // Monte en haut pour voir le formulaire
  }

  async function supprimer(p) {
    // window.confirm = boîte de dialogue "Êtes-vous sûr ?"
    if (!window.confirm(`Supprimer définitivement « ${p.nom} » ?`)) return;
    try {
      await supprimerProduit(p.id);
      afficher('succes', `🗑️ « ${p.nom} » supprimé`);
      charger();
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  function annuler() {
    setFormulaire(PRODUIT_VIDE);
    setEnEdition(null);
    setMotif('');
  }

  // --- Ouvre l'historique d'un produit (ADMIN : clic sur une valeur) ---
  async function voirHistorique(p) {
    try {
      const lignes = await getHistoriqueProduit(p.id);
      setHistorique({ nom: p.nom, lignes });
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    }
  }

  return (
    <div>
      {/* --- Message de retour (succès ou erreur) --- */}
      {message && (
        <div className={`message ${message.type === 'erreur' ? 'message-erreur' : 'message-succes'}`}>
          {message.texte}
        </div>
      )}

      {/* --- Formulaire : réservé à l'admin et au gérant (le caissier ne vend que) --- */}
      {peutGerer && (
      <section className="bloc">
        <h2>{enEdition ? '✏️ Modifier le produit' : '➕ Ajouter un produit'}</h2>
        <form className="formulaire" onSubmit={soumettre}>
          <div className="champ">
            <label>Nom *</label>
            <input name="nom" value={formulaire.nom} onChange={changerChamp}
                   placeholder="Ex : Croissant" required />
          </div>
          <div className="champ">
            <label>Catégorie</label>
            <select name="categorie" value={formulaire.categorie} onChange={changerChamp}>
              <option>Épicerie</option>
              <option>Frais</option>
              <option>Boissons</option>
              <option>Entretien</option>
              <option>Hygiène</option>
              <option>Divers</option>
            </select>
          </div>
          <div className="champ">
            <label>Prix d'achat (FCFA) *</label>
            <input type="number" step="0.01" min="0" name="prix_achat"
                   value={formulaire.prix_achat} onChange={changerChamp} required />
          </div>
          <div className="champ">
            <label>Prix de vente (FCFA) *</label>
            <input type="number" step="0.01" min="0" name="prix_vente"
                   value={formulaire.prix_vente} onChange={changerChamp} required />
          </div>
          <div className="champ">
            <label>Quantité initiale</label>
            <input type="number" min="0" name="quantite"
                   value={formulaire.quantite} onChange={changerChamp} />
          </div>
          <div className="champ">
            <label>Seuil d'alerte</label>
            <input type="number" min="0" name="seuil_alerte"
                   value={formulaire.seuil_alerte} onChange={changerChamp} />
          </div>
          <div className="champ">
            <label>Code-barres</label>
            <input name="code_barre" value={formulaire.code_barre || ''} onChange={changerChamp} />
          </div>
          <div className="champ">
            <label>Date d'expiration</label>
            <input type="date" name="date_expiration"
                   value={formulaire.date_expiration || ''} onChange={changerChamp} />
          </div>
          {/* --- Motif OBLIGATOIRE lors d'une modification (traçabilité admin) --- */}
          {enEdition && (
            <div className="champ champ-motif">
              <label>📝 Motif de la modification *</label>
              <input
                name="motif"
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                placeholder="Ex : Réapprovisionnement, correction de prix, inventaire…"
                maxLength={200}
                required
              />
              <small>Ce motif sera associé à votre nom dans le journal (visible par l'admin).</small>
            </div>
          )}
          <div className="actions-formulaire">
            <button type="submit" className="btn-principal">
              {enEdition ? '💾 Enregistrer' : '➕ Ajouter'}
            </button>
            {enEdition && (
              <button type="button" className="btn-secondaire" onClick={annuler}>
                Annuler
              </button>
            )}
          </div>
        </form>
      </section>
      )}

      {/* --- Barre de recherche --- */}
      <section className="bloc">
        <div className="barre-recherche">
          <input
            placeholder="🔍 Rechercher un produit ou un code-barres…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
          <span className="compteur">{produits.length} produit(s)</span>
        </div>

        {/* --- Filtres d'expiration + export (admin / gérant) --- */}
        <div className="filtres">
          <button
            className={`filtre ${filtreExpiration === null ? 'filtre-actif' : ''}`}
            onClick={() => setFiltreExpiration(null)}
          >
            Tous
          </button>
          <button
            className={`filtre ${filtreExpiration === 7 ? 'filtre-actif' : ''}`}
            onClick={() => setFiltreExpiration(7)}
          >
            ⏰ Expire sous 7 jours
          </button>
          <button
            className={`filtre ${filtreExpiration === 0 ? 'filtre-actif' : ''}`}
            onClick={() => setFiltreExpiration(0)}
          >
            ❌ Périmés
          </button>
          {peutGerer && (
            <button className="filtre filtre-export" onClick={exporterCSV}>
              ⬇️ Exporter en CSV
            </button>
          )}
        </div>

        {/* --- Tableau des produits --- */}
        {chargement ? (
          <p className="message-chargement">Chargement…</p>
        ) : produits.length === 0 ? (
          <p className="vide">Aucun produit trouvé.</p>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Catégorie</th>
                <th>Achat</th>
                <th>Vente</th>
                <th>Stock</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {produits.map((p) => {
                // Calcul de la marge bénéficiaire par unité
                const marge = (p.prix_vente - p.prix_achat).toLocaleString('fr-FR');
                return (
                  <tr key={p.id} className={p.quantite <= p.seuil_alerte ? 'ligne-alerte' : ''}>
                    <td>
                      {p.nom}
                      {p.quantite === 0 && <span className="badge-rupture">RUPTURE</span>}
                      {p.quantite > 0 && p.quantite <= p.seuil_alerte && (
                        <span className="badge-alerte">FAIBLE</span>
                      )}
                      {expirationBadge(p.date_expiration)}
                    </td>
                    <td>{p.categorie}</td>
                    {/* Pour l'admin et le gérant, chaque valeur tracée est cliquable */}
                    <td>
                      {peutGerer ? (
                        <button className="valeur-lien" title="Voir l'historique (admin)"
                                onClick={() => voirHistorique(p)}>
                          {p.prix_achat.toLocaleString('fr-FR')} FCFA
                        </button>
                      ) : (
                        `${p.prix_achat.toLocaleString('fr-FR')} FCFA`
                      )}
                    </td>
                    <td>
                      {peutGerer ? (
                        <button className="valeur-lien" title="Voir l'historique (admin)"
                                onClick={() => voirHistorique(p)}>
                          {p.prix_vente.toLocaleString('fr-FR')} FCFA
                        </button>
                      ) : (
                        `${p.prix_vente.toLocaleString('fr-FR')} FCFA`
                      )}
                      <small className="marge"> (+{marge} FCFA)</small>
                    </td>
                    <td className={p.quantite <= p.seuil_alerte ? 'stock-alerte' : ''}>
                      {peutGerer ? (
                        <button className="valeur-lien" title="Voir l'historique (admin)"
                                onClick={() => voirHistorique(p)}>
                          {p.quantite}
                        </button>
                      ) : (
                        p.quantite
                      )}
                    </td>
                    <td className="cellule-actions">
                      {peutGerer && (
                        <button className="btn-modifier" onClick={() => editer(p)}>✏️</button>
                      )}
                      {/* La suppression est réservée à l'administrateur */}
                      {estAdmin && (
                        <button className="btn-supprimer" onClick={() => supprimer(p)}>🗑️</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* --- PANNEAU D'HISTORIQUE (modal) --- */}
      {historique && (
        <div className="modale-fond" onClick={() => setHistorique(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <div className="modale-entete">
              <h2>🕘 Historique — {historique.nom}</h2>
              <button className="modale-fermer" onClick={() => setHistorique(null)}>✕</button>
            </div>

            {historique.lignes.length === 0 ? (
              <p className="vide">
                Aucune modification enregistrée pour ce produit.
                <br />
                <small>Le journal trace les actions à partir de maintenant.</small>
              </p>
            ) : (
              <table className="tableau tableau-historique">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Heure</th>
                    <th>Effectué par</th>
                    <th>Action</th>
                    <th>Motif</th>
                    <th>Valeur mise à jour</th>
                  </tr>
                </thead>
                <tbody>
                  {historique.lignes.map((l) => {
                    const { date, heure } = decouperDate(l.date_action);
                    return (
                      <tr key={l.id}>
                        <td className="date-historique">{date}</td>
                        <td className="date-historique">{heure}</td>
                        <td>
                          {l.utilisateur_nom}
                          {/* Badge seulement si le rôle est connu :
                              jamais d'"EMPLOYÉ" par défaut si le rôle est absent */}
                          {l.utilisateur_role && (
                            <span className={l.utilisateur_role === 'admin' ? 'badge-role-sombre' : 'badge-role-clair'}>
                              {l.utilisateur_role === 'admin' ? 'ADMIN' : l.utilisateur_role === 'gerant' ? 'GÉRANT' : 'EMPLOYÉ'}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={
                            l.action === 'sortie' || l.action === 'suppression' ? 'badge-sortie' :
                            l.action === 'entree' || l.action === 'creation' ? 'badge-entree' :
                            'badge-modification'
                          }>
                            {ACTION_LIBELLES[l.action] || l.action}
                          </span>
                        </td>
                        <td className="cellule-motif">{l.motif || '—'}</td>
                        <td>{formaterDetail(l)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Sépare "2026-10-25 17:27:36" en date et heure lisibles
function decouperDate(valeur) {
  if (!valeur) return { date: '—', heure: '—' };
  const [date, heure] = String(valeur).split(' ');
  return { date: date || '—', heure: heure || '—' };
}

// ⏰ Badge d'expiration : rouge = périmé, orange = très proche,
// jaune = dans la semaine, gris = simple rappel de date
function expirationBadge(dateStr) {
  if (!dateStr) return null;
  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);
  const dateExpiration = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dateExpiration.getTime())) return null;

  const jours = Math.round((dateExpiration - aujourdhui) / 86400000);

  if (jours < 0) return <span className="badge-perime">PÉRIMÉ</span>;
  if (jours === 0) return <span className="badge-perime">EXPIRE AUJOURD'HUI</span>;
  if (jours <= 3) return <span className="badge-perime">EXPIRE DANS {jours} J</span>;
  if (jours <= 7) return <span className="badge-expiration">EXPIRE DANS {jours} J</span>;
  return <span className="date-expiration">exp. {String(dateStr).slice(0, 10)}</span>;
}

// Libellés français des actions du journal
const ACTION_LIBELLES = {
  creation: '➕ Création',
  modification: '✏️ Modification',
  suppression: '🗑️ Suppression',
  entree: '⬇️ Entrée',
  sortie: '⬆️ Sortie',
};

// Affiche une ligne d'historique de façon lisible
function formaterDetail(l) {
  if (l.action === 'creation') return l.nouvelle_valeur || '—';
  if (l.action === 'suppression') return l.ancienne_valeur || '—';
  if (l.action === 'entree' || l.action === 'sortie') {
    return `Quantité : ${l.ancienne_valeur} → ${l.nouvelle_valeur}`;
  }
  // 'modification' : le champ concerné + avant → après
  const champ = CHAMPS_LIBELLES[l.champ] || l.champ;
  return `${champ} : ${l.ancienne_valeur} → ${l.nouvelle_valeur}`;
}

// Noms de champs traduits en français
const CHAMPS_LIBELLES = {
  nom: 'Nom',
  categorie: 'Catégorie',
  prix_achat: 'Prix d’achat',
  prix_vente: 'Prix de vente',
  quantite: 'Quantité',
  seuil_alerte: 'Seuil d’alerte',
  code_barre: 'Code-barres',
  date_expiration: 'Date d’expiration',
};

export default Produits;
