// ============================================================
// CAISSE — Encaissement d'un ticket (tous les rôles connectés)
// Le navigateur n'envoie QUE les identifiants et quantités :
// le serveur recalcule les prix, vérifie le stock et écrit le
// ticket + les mouvements + le journal dans une transaction.
// ============================================================

import { useState, useEffect } from 'react';
import { getProduits, creerVente, getVentes } from '../api';

const MOYENS = [
  { valeur: 'especes', libelle: '💵 Espèces' },
  { valeur: 'carte', libelle: '💳 Carte bancaire' },
  { valeur: 'mobile', libelle: '📱 Paiement mobile' },
];

const FCFA = (montant) =>
  Number(montant || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function Caisse({ utilisateur }) {
  const [produits, setProduits] = useState([]);
  const [recherche, setRecherche] = useState('');
  const [panier, setPanier] = useState([]); // [{ produit, quantite }]
  const [remise, setRemise] = useState('');
  const [moyenPaiement, setMoyenPaiement] = useState('especes');
  const [montantVerse, setMontantVerse] = useState('');
  const [message, setMessage] = useState(null);
  const [ticket, setTicket] = useState(null); // ticket fraîchement encaissé
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    getProduits()
      .then(setProduits)
      .catch((e) => afficher('erreur', e.message));
  }, []);

  function afficher(type, texte) {
    setMessage({ type, texte });
    setTimeout(() => setMessage(null), 5000);
  }

  // --- Recherche côté client (la liste est déjà chargée) ---
  const produitsVisibles = produits.filter((p) => {
    const q = recherche.trim().toLowerCase();
    if (!q) return true;
    return p.nom.toLowerCase().includes(q) || String(p.code_barre || '').includes(q);
  });

  // --- Ajout au panier (jamais plus que le stock disponible) ---
  function ajouter(produit) {
    if (produit.quantite <= 0) {
      return afficher('erreur', `❌ « ${produit.nom} » est en rupture de stock`);
    }
    setPanier((ancien) => {
      const dejaLa = ancien.find((l) => l.produit.id === produit.id);
      if (dejaLa) {
        if (dejaLa.quantite >= produit.quantite) {
          afficher('erreur', `❌ Stock insuffisant pour « ${produit.nom} » (${produit.quantite} max)`);
          return ancien;
        }
        return ancien.map((l) =>
          l.produit.id === produit.id ? { ...l, quantite: l.quantite + 1 } : l
        );
      }
      return [...ancien, { produit, quantite: 1 }];
    });
  }

  function changerQuantite(produitId, valeur) {
    const qte = parseInt(valeur, 10);
    setPanier((ancien) =>
      ancien.map((l) => {
        if (l.produit.id !== produitId) return l;
        const max = l.produit.quantite;
        if (Number.isNaN(qte) || qte < 1) return { ...l, quantite: 1 };
        if (qte > max) {
          afficher('erreur', `❌ Stock insuffisant : ${max} unité(s) maximum`);
          return { ...l, quantite: max };
        }
        return { ...l, quantite: qte };
      })
    );
  }

  const retirer = (produitId) =>
    setPanier((ancien) => ancien.filter((l) => l.produit.id !== produitId));

  const viderPanier = () => {
    setPanier([]);
    setRemise('');
    setMontantVerse('');
  };

  // --- Totaux (affichage seulement ; le serveur recalcule) ---
  const sousTotal = panier.reduce((somme, l) => somme + l.produit.prix_vente * l.quantite, 0);
  const remiseNum = Math.max(0, parseFloat(remise) || 0);
  const total = Math.max(0, sousTotal - remiseNum);
  const monnaie = Math.max(0, (parseFloat(montantVerse) || 0) - total);

  // --- Encaissement ---
  async function encaisser(e) {
    e.preventDefault();
    if (panier.length === 0) {
      return afficher('erreur', '❌ Le panier est vide');
    }
    if (moyenPaiement === 'especes' && (parseFloat(montantVerse) || 0) < total) {
      return afficher('erreur', '❌ Montant versé insuffisant');
    }

    setEnvoi(true);
    try {
      const vente = await creerVente({
        lignes: panier.map((l) => ({ produit_id: l.produit.id, quantite: l.quantite })),
        moyen_paiement: moyenPaiement,
        montant_verse: moyenPaiement === 'especes' ? parseFloat(montantVerse) : undefined,
        remise: remiseNum,
      });

      setTicket(vente);
      viderPanier();
      // On recharge le stock : les quantités ont diminué côté serveur
      const liste = await getProduits();
      setProduits(liste);
      afficher('succes', `✅ Ticket ${vente.numero} encaissé — ${FCFA(vente.total)} FCFA`);
    } catch (err) {
      afficher('erreur', `❌ ${err.message}`);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div>
      {message && (
        <div className={`message ${message.type === 'erreur' ? 'message-erreur' : 'message-succes'}`}>
          {message.texte}
        </div>
      )}

      <div className="caisse-grille">
        {/* ---------- Colonne gauche : catalogue ---------- */}
        <section className="bloc">
          <h2>🛒 Catalogue</h2>
          <div className="barre-recherche">
            <input
              placeholder="🔍 Nom ou code-barres…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
            />
            <span className="compteur">{produitsVisibles.length} article(s)</span>
          </div>

          <div className="grille-produits">
            {produitsVisibles.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`carte-produit ${p.quantite === 0 ? 'epuise' : ''}`}
                onClick={() => ajouter(p)}
                disabled={p.quantite === 0}
                title={p.quantite === 0 ? 'Rupture de stock' : 'Cliquez pour ajouter au panier'}
              >
                <span className="carte-produit-nom">{p.nom}</span>
                <span className="carte-produit-prix">{FCFA(p.prix_vente)} FCFA</span>
                <span className={`carte-produit-stock ${p.quantite <= p.seuil_alerte ? 'stock-bas' : ''}`}>
                  {p.quantite === 0 ? 'Rupture' : `${p.quantite} en stock`}
                </span>
              </button>
            ))}
            {produitsVisibles.length === 0 && <p className="vide">Aucun article trouvé.</p>}
          </div>
        </section>

        {/* ---------- Colonne droite : panier ---------- */}
        <section className="bloc panier">
          <h2>🧾 Panier {panier.length > 0 && <span className="compteur">{panier.length} ligne(s)</span>}</h2>

          {panier.length === 0 ? (
            <p className="vide">Cliquez sur un article pour l'ajouter.</p>
          ) : (
            <table className="tableau tableau-panier">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Qté</th>
                  <th>P.U.</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {panier.map((l) => (
                  <tr key={l.produit.id}>
                    <td>{l.produit.nom}</td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        max={l.produit.quantite}
                        className="saisie-quantite"
                        value={l.quantite}
                        onChange={(e) => changerQuantite(l.produit.id, e.target.value)}
                      />
                    </td>
                    <td>{FCFA(l.produit.prix_vente)}</td>
                    <td>{FCFA(l.produit.prix_vente * l.quantite)}</td>
                    <td>
                      <button type="button" className="btn-supprimer" onClick={() => retirer(l.produit.id)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form className="encaissement" onSubmit={encaisser}>
            <div className="ligne-total">
              <span>Sous-total</span>
              <strong>{FCFA(sousTotal)} FCFA</strong>
            </div>

            <div className="champ">
              <label>Remise (FCFA)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={remise}
                onChange={(e) => setRemise(e.target.value)}
                placeholder="0"
              />
            </div>

            <div className="ligne-total ligne-total-grand">
              <span>À payer</span>
              <strong>{FCFA(total)} FCFA</strong>
            </div>

            <div className="champ">
              <label>Moyen de paiement</label>
              <select value={moyenPaiement} onChange={(e) => setMoyenPaiement(e.target.value)}>
                {MOYENS.map((m) => (
                  <option key={m.valeur} value={m.valeur}>{m.libelle}</option>
                ))}
              </select>
            </div>

            {moyenPaiement === 'especes' && (
              <div className="champ">
                <label>Montant versé (FCFA)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={montantVerse}
                  onChange={(e) => setMontantVerse(e.target.value)}
                  placeholder={String(Math.ceil(total))}
                  required
                />
                <small>Monnaie à rendre : <strong>{FCFA(monnaie)} FCFA</strong></small>
              </div>
            )}

            <div className="actions-formulaire">
              <button type="submit" className="btn-principal" disabled={envoi || panier.length === 0}>
                {envoi ? 'Encaissement…' : `✅ Encaisser ${FCFA(total)} FCFA`}
              </button>
              <button type="button" className="btn-secondaire" onClick={viderPanier} disabled={panier.length === 0}>
                Vider
              </button>
            </div>
          </form>

          {/* ---------- Derniers tickets ---------- */}
          <HistoriqueTickets cleTicket={ticket ? ticket.id : 0} />
        </section>
      </div>

      {/* ---------- MODALE DU TICKET (imprimable) ---------- */}
      {ticket && (
        <div className="modale-fond" onClick={() => setTicket(null)}>
          <div className="modale modale-ticket" onClick={(e) => e.stopPropagation()}>
            <div className="modale-entete">
              <h2>🧾 Ticket {ticket.numero}</h2>
              <button className="modale-fermer" onClick={() => setTicket(null)}>✕</button>
            </div>

            <div className="ticket">
              <p className="ticket-entete">
                <strong>🛒 Gestion de Stock — Supermarché</strong><br />
                Ticket <strong>{ticket.numero}</strong> du{' '}
                {String(ticket.date_vente).replace(' ', ' à ')}<br />
                Caissier : {ticket.utilisateur_nom}
              </p>

              <table className="tableau">
                <thead>
                  <tr>
                    <th>Article</th>
                    <th>Qté</th>
                    <th>P.U.</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(ticket.lignes || []).map((l) => (
                    <tr key={l.id}>
                      <td>{l.produit_nom}</td>
                      <td>{l.quantite}</td>
                      <td>{FCFA(l.prix_unitaire)}</td>
                      <td>{FCFA(l.sous_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="ticket-totaux">
                <div><span>Sous-total</span><span>{FCFA(ticket.sous_total)} FCFA</span></div>
                {ticket.remise > 0 && (
                  <div><span>Remise</span><span>- {FCFA(ticket.remise)} FCFA</span></div>
                )}
                <div className="ticket-total"><span>TOTAL</span><span>{FCFA(ticket.total)} FCFA</span></div>
                <div>
                  <span>Payé ({ticket.moyen_paiement})</span>
                  <span>{FCFA(ticket.montant_verse ?? ticket.total)} FCFA</span>
                </div>
                {ticket.monnaie_rendue > 0 && (
                  <div><span>Monnaie rendue</span><span>{FCFA(ticket.monnaie_rendue)} FCFA</span></div>
                )}
              </div>

              <p className="ticket-merci">Merci de votre visite !</p>
            </div>

            <div className="modale-actions">
              <button className="btn-principal" onClick={() => window.print()}>🖨️ Imprimer</button>
              <button className="btn-secondaire" onClick={() => setTicket(null)}>Fermer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Derniers tickets encaissés (l'admin voit tous les tickets,
// l'employé uniquement les siens — c'est le serveur qui filtre) ---
function HistoriqueTickets({ cleTicket }) {
  const [ventes, setVentes] = useState([]);

  // Rechargé à chaque nouveau ticket encaissé (cleTicket change)
  useEffect(() => {
    getVentes(8)
      .then(setVentes)
      .catch(() => {
        /* l'historique est secondaire : pas d'erreur bloquante */
      });
  }, [cleTicket]);

  if (ventes.length === 0) return null;

  return (
    <div className="historique-tickets">
      <h3>🕘 Derniers tickets</h3>
      <table className="tableau">
        <thead>
          <tr>
            <th>N°</th>
            <th>Heure</th>
            <th>Caissier</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {ventes.map((v) => (
            <tr key={v.id}>
              <td>{v.numero}</td>
              <td className="date-historique">{String(v.date_vente).slice(11, 16)}</td>
              <td>{v.utilisateur_nom}</td>
              <td>{FCFA(v.total)} FCFA</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Caisse;