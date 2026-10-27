// ============================================================
// MOUVEMENTS — Enregistrer une entrée/sortie + voir l'historique
// C'est l'écran utilisé au quotidien par les employés (caisse, réappro)
// ============================================================

import { useState, useEffect } from 'react';
import { getProduits, getMouvements, creerMouvement } from '../api';

function Mouvements({ peutGerer = false }) {
  const [produits, setProduits] = useState([]);
  const [historique, setHistorique] = useState([]);
  const [message, setMessage] = useState(null);

  // Formulaire de mouvement
  const [produitId, setProduitId] = useState('');
  const [type, setType] = useState('entree');       // 'entree' ou 'sortie'
  const [quantite, setQuantite] = useState(1);
  const [motif, setMotif] = useState('');

  useEffect(() => {
    charger();
  }, []);

  async function charger() {
    try {
      const [listeProduits, listeMouvements] = await Promise.all([
        getProduits(),
        getMouvements(50),
      ]);
      setProduits(listeProduits);
      setHistorique(listeMouvements);
    } catch (e) {
      setMessage({ type: 'erreur', texte: `❌ ${e.message}` });
    }
  }

  async function soumettre(e) {
    e.preventDefault();
    try {
      const produit = await creerMouvement({
        produit_id: parseInt(produitId),
        type,
        quantite: parseInt(quantite),
        motif: motif || (type === 'entree' ? 'Réapprovisionnement' : 'Vente'),
      });
      setMessage({
        type: 'succes',
        texte: `✅ ${type === 'entree' ? 'Entrée' : 'Sortie'} enregistrée — nouveau stock : ${produit.quantite}`,
      });
      // Réinitialise le formulaire (sauf le type choisi)
      setQuantite(1);
      setMotif('');
      charger(); // Recharge l'historique et le stock
      setTimeout(() => setMessage(null), 4000);
    } catch (err) {
      setMessage({ type: 'erreur', texte: `❌ ${err.message}` });
      setTimeout(() => setMessage(null), 4000);
    }
  }

  return (
    <div>
      {message && (
        <div className={`message ${message.type === 'erreur' ? 'message-erreur' : 'message-succes'}`}>
          {message.texte}
        </div>
      )}

      {/* --- Formulaire d'enregistrement d'un mouvement --- */}
      <section className="bloc">
        <h2>📝 Enregistrer un mouvement</h2>
        <form className="formulaire" onSubmit={soumettre}>
          <div className="champ">
            <label>Produit *</label>
            <select value={produitId} onChange={(e) => setProduitId(e.target.value)} required>
              <option value="">— Choisir un produit —</option>
              {produits.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nom} (stock : {p.quantite})
                </option>
              ))}
            </select>
          </div>

          <div className="champ">
            <label>Type de mouvement *</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="entree">⬇️ Entrée (réapprovisionnement)</option>
              <option value="sortie">⬆️ Sortie (vente)</option>
            </select>
          </div>

          <div className="champ">
            <label>Quantité *</label>
            <input
              type="number" min="1" value={quantite}
              onChange={(e) => setQuantite(e.target.value)} required
            />
          </div>

          <div className="champ">
            <label>Motif</label>
            <input
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              placeholder={type === 'entree' ? 'Ex : Livraison fournisseur' : 'Ex : Vente comptoir'}
            />
          </div>

          <div className="actions-formulaire">
            <button type="submit" className="btn-principal">
              ✅ Enregistrer
            </button>
          </div>
        </form>
      </section>

      {/* --- Historique des mouvements --- */}
      <section className="bloc">
        <h2>🕘 Historique récent</h2>
        {historique.length === 0 ? (
          <p className="vide">Aucun mouvement enregistré.</p>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Date</th>
                <th>Heure</th>
                <th>Produit</th>
                <th>Type</th>
                <th>Quantité</th>
                <th>Motif</th>
                {/* Le nom de l'auteur n'est montré qu'à l'admin et au gérant */}
                {peutGerer && <th>Effectué par</th>}
              </tr>
            </thead>
            <tbody>
              {historique.map((m) => {
                const [date, heure] = String(m.date_mouvement || '').split(' ');
                return (
                  <tr key={m.id}>
                    <td className="date-historique">{date || '—'}</td>
                    <td className="date-historique">{heure || '—'}</td>
                    <td>{m.nom_produit}</td>
                    <td>
                      <span className={m.type === 'entree' ? 'badge-entree' : 'badge-sortie'}>
                        {m.type === 'entree' ? '⬇️ Entrée' : '⬆️ Sortie'}
                      </span>
                    </td>
                    <td>{m.quantite}</td>
                    <td className="cellule-motif">{m.motif || '—'}</td>
                    {peutGerer && (
                      <td>
                        {m.utilisateur_nom || '—'}
                        {m.utilisateur_role && (
                          <span className={m.utilisateur_role === 'admin' ? 'badge-role-sombre' : 'badge-role-clair'}>
                            {m.utilisateur_role === 'admin' ? 'ADMIN' : m.utilisateur_role === 'gerant' ? 'GÉRANT' : 'EMPLOYÉ'}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export default Mouvements;
