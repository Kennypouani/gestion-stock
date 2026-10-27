// ============================================================
// TABLEAU DE BORD — Chiffres clés et alertes de stock
// Se rafraîchit automatiquement quand on revient sur l'onglet
// ============================================================

import { useState, useEffect } from 'react';
import { getStats, getProduits } from '../api';

function TableauDeBord() {
  // stats = les chiffres clés, setStats = fonction pour les mettre à jour
  const [stats, setStats] = useState(null);
  const [alertes, setAlertes] = useState([]);
  const [erreur, setErreur] = useState(null);

  // useEffect = "exécute ce code au montage du composant" (une fois au chargement)
  useEffect(() => {
    charger();
  }, []);

  async function charger() {
    try {
      // On récupère en parallèle : les stats + les produits en alerte
      const [s, alertesListe] = await Promise.all([
        getStats(),
        getProduits({ alerte: 'true' }),
      ]);
      setStats(s);
      setAlertes(alertesListe);
      setErreur(null);
    } catch (e) {
      setErreur(e.message);
    }
  }

  if (erreur) return <div className="message-erreur">❌ {erreur}</div>;
  if (!stats) return <div className="message-chargement">Chargement…</div>;

  return (
    <div>
      {/* --- Cartes de statistiques (4 chiffres principaux) --- */}
      <div className="cartes">
        <div className="carte">
          <span className="carte-valeur">{stats.total_produits}</span>
          <span className="carte-label">Produits au catalogue</span>
        </div>
        <div className="carte">
          <span className="carte-valeur">{stats.valeur_stock.toLocaleString('fr-FR')} FCFA</span>
          <span className="carte-label">Valeur du stock</span>
        </div>
        <div className={`carte ${stats.produits_en_alerte > 0 ? 'carte-alerte' : ''}`}>
          <span className="carte-valeur">{stats.produits_en_alerte}</span>
          <span className="carte-label">En stock faible</span>
        </div>
        <div className={`carte ${stats.ruptures > 0 ? 'carte-danger' : ''}`}>
          <span className="carte-valeur">{stats.ruptures}</span>
          <span className="carte-label">Ruptures de stock</span>
        </div>
        <div className="carte">
          <span className="carte-valeur">{stats.entrees_jour}</span>
          <span className="carte-label">Entrées aujourd'hui</span>
        </div>
        <div className="carte">
          <span className="carte-valeur">{stats.sorties_jour}</span>
          <span className="carte-label">Sorties aujourd'hui</span>
        </div>
        {/* 🧾 Chiffre d'affaires du jour (tickets de caisse) */}
        <div className="carte">
          <span className="carte-valeur">{stats.ca_jour.total.toLocaleString('fr-FR')} FCFA</span>
          <span className="carte-label">CA du jour ({stats.ca_jour.nb_tickets} ticket(s))</span>
        </div>
        {/* ⏰ Produits périmés ou arrivant à expiration sous 7 jours */}
        <div className={`carte ${stats.expirations.perimes > 0 ? 'carte-danger' : ''}`}>
          <span className="carte-valeur">{stats.expirations.perimes}</span>
          <span className="carte-label">Produits périmés</span>
        </div>
        <div className={`carte ${stats.expirations.bientot > 0 ? 'carte-alerte' : ''}`}>
          <span className="carte-valeur">{stats.expirations.bientot}</span>
          <span className="carte-label">Expirent sous 7 jours</span>
        </div>
      </div>

      {/* --- Alerte : produits à réapprovisionner --- */}
      <section className="bloc">
        <h2>⚠️ Produits à réapprovisionner</h2>
        {alertes.length === 0 ? (
          <p className="succes">✅ Aucun produit en alerte, tout va bien !</p>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Catégorie</th>
                <th>Stock actuel</th>
                <th>Seuil d'alerte</th>
              </tr>
            </thead>
            <tbody>
              {alertes.map((p) => (
                <tr key={p.id} className={p.quantite === 0 ? 'ligne-rupture' : 'ligne-alerte'}>
                  <td>{p.nom}</td>
                  <td>{p.categorie}</td>
                  <td>{p.quantite === 0 ? '🚫 RUPTURE' : `${p.quantite} unité(s)`}</td>
                  <td>{p.seuil_alerte}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* --- ⏰ Alertes d'expiration (produits frais) --- */}
      {stats.expirations.liste.length > 0 && (
        <section className="bloc">
          <h2>⏰ Produits arrivant à expiration</h2>
          <table className="tableau">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Catégorie</th>
                <th>Date d'expiration</th>
                <th>Reste</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {stats.expirations.liste.map((p) => (
                <tr key={p.id} className={p.jours_restants < 0 ? 'ligne-rupture' : 'ligne-alerte'}>
                  <td>{p.nom}</td>
                  <td>{p.categorie}</td>
                  <td className="date-historique">{p.date_expiration}</td>
                  <td>
                    {p.jours_restants < 0
                      ? `❌ Périmé depuis ${Math.abs(p.jours_restants)} j`
                      : p.jours_restants === 0
                        ? '🔴 expire aujourd’hui'
                        : `J-${p.jours_restants}`}
                  </td>
                  <td>{p.quantite} unité(s)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* --- Top 5 des produits les plus vendus --- */}
      <section className="bloc">
        <h2>🏆 Top 5 des ventes</h2>
        {stats.top_ventes.length === 0 ? (
          <p>Aucune vente enregistrée pour l'instant.</p>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>#</th>
                <th>Produit</th>
                <th>Quantité vendue</th>
              </tr>
            </thead>
            <tbody>
              {stats.top_ventes.map((v, i) => (
                <tr key={v.nom}>
                  <td>{i + 1}</td>
                  <td>{v.nom}</td>
                  <td>{v.total_vendu}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export default TableauDeBord;
