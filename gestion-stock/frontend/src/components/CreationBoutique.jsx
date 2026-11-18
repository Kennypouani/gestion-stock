// ============================================================
// BOUTIQUES — Création et liste des boutiques du compte
// Un compte SANS boutique ne voit que ce formulaire (pleinEcran) :
// il doit créer son magasin avant d'accéder au reste.
//
// Champs OBLIGATOIRES : nom, ville, quartier, téléphone.
// FACULTATIF : le numéro de ticket (code). Laissé vide, le serveur en
// attribue un automatiquement — une bulle prévient l'admin au moment
// de valider, avec le choix d'enregistrer ou de saisir son numéro.
// ============================================================

import { useState, useEffect, useRef } from 'react';
import { getBoutiques, creerBoutique } from '../api';

const BOUTIQUE_VIDE = {
  nom: '',
  ville: '',
  quartier: '',
  telephone: '',
  code: '',
};

function CreationBoutique({ pleinEcran = false, onCree, onDeconnexion = null }) {
  const [boutiques, setBoutiques] = useState([]);
  const [form, setForm] = useState(BOUTIQUE_VIDE);
  const [erreur, setErreur] = useState(null);
  const [succes, setSucces] = useState(null);
  const [enCours, setEnCours] = useState(false);
  // Bulle affichée quand aucun numéro de ticket n'a été saisi
  const [bulle, setBulle] = useState(false);
  const champCode = useRef(null);

  useEffect(() => {
    getBoutiques()
      .then(setBoutiques)
      .catch(() => setBoutiques([]));
  }, []);

  function changerChamp(e) {
    const { name, value } = e.target;
    setForm((a) => ({ ...a, [name]: value }));
  }

  // Enregistrement réel (code éventuellement vide → attribué par le serveur)
  async function enregistrer() {
    setEnCours(true);
    setErreur(null);
    setSucces(null);
    try {
      const creee = await creerBoutique(form);
      setSucces(`✅ Boutique « ${creee.nom} » créée (code ticket : ${creee.code})`);
      setBoutiques((liste) => [...liste, creee]);
      setForm(BOUTIQUE_VIDE);
      setBulle(false);
      // Prévient App : le compte a désormais une boutique
      if (onCree) await onCree();
    } catch (err) {
      setErreur(err.message);
      setBulle(false);
    } finally {
      setEnCours(false);
    }
  }

  function soumettre(e) {
    e.preventDefault();
    setErreur(null);
    setSucces(null);
    // Aucun numéro de ticket saisi : on prévient AVANT d'enregistrer
    if (!form.code.trim()) {
      setBulle(true);
      return;
    }
    enregistrer();
  }

  // « Entrer le numéro » : on referme la bulle et on place le curseur
  // dans le seul champ libre (le numéro de ticket)
  function saisirLeNumero() {
    setBulle(false);
    setTimeout(() => champCode.current?.focus(), 30);
  }

  const formulaire = (
    <form className="formulaire-connexion" onSubmit={soumettre}>
      <div className="champ">
        <label>Nom de la boutique *</label>
        <input
          name="nom"
          value={form.nom}
          onChange={changerChamp}
          placeholder="Ex : Magasin central"
          maxLength={80}
          required
          autoFocus
        />
      </div>
      <div className="champ">
        <label>Ville *</label>
        <input
          name="ville"
          value={form.ville}
          onChange={changerChamp}
          placeholder="Ex : Abidjan"
          maxLength={80}
          required
        />
      </div>
      <div className="champ">
        <label>Quartier *</label>
        <input
          name="quartier"
          value={form.quartier}
          onChange={changerChamp}
          placeholder="Ex : Cocody"
          maxLength={80}
          required
        />
      </div>
      <div className="champ">
        <label>Téléphone *</label>
        <input
          name="telephone"
          value={form.telephone}
          onChange={changerChamp}
          placeholder="Ex : +225 07 00 00 00 00"
          maxLength={30}
          required
        />
      </div>
      <div className="champ">
        <label>Numéro de ticket (facultatif)</label>
        <input
          ref={champCode}
          name="code"
          value={form.code}
          onChange={changerChamp}
          placeholder="Ex : MP — laissez vide, un numéro vous sera attribué"
          maxLength={10}
        />
        <small>
          Sert de suffixe aux tickets (TK-MP-2026-0001). 2 à 10 lettres ou chiffres, sans espace.
          Il ne pourra plus être modifié ensuite.
        </small>
      </div>
      <button type="submit" className="btn-principal btn-connexion" disabled={enCours}>
        {enCours ? 'Création…' : '🏪 Créer ma boutique'}
      </button>
    </form>
  );

  const messages = (
    <>
      {erreur && <div className="message message-erreur">❌ {erreur}</div>}
      {succes && <div className="message message-succes">{succes}</div>}
    </>
  );

  // --- Bulle : aucun numéro de ticket saisi ---
  const bulleCode = bulle && (
    <div className="modale-fond" onClick={() => setBulle(false)}>
      <div className="modale bulle-numero" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h2>🎲 Numéro de ticket non renseigné</h2>
          <button className="modale-fermer" onClick={() => setBulle(false)} type="button">
            ✕
          </button>
        </div>
        <p className="texte-bulle">
          Vous n’avez pas saisi de numéro de ticket. Un numéro vous sera{' '}
          <strong>attribué automatiquement</strong> (par exemple <code>TK-A7K2P9-2026-0001</code>).
        </p>
        <p className="texte-bulle">
          Vous pouvez enregistrer tel quel, ou saisir vous-même le numéro de votre boutique.
        </p>
        <div className="modale-actions">
          <button type="button" className="btn-principal" onClick={enregistrer} disabled={enCours}>
            {enCours ? 'Enregistrement…' : '✅ Enregistrer'}
          </button>
          <button type="button" className="btn-secondaire" onClick={saisirLeNumero}>
            ⌨️ Entrer le numéro
          </button>
        </div>
      </div>
    </div>
  );

  // --- Écran plein : compte sans aucune boutique ---
  if (pleinEcran) {
    return (
      <div className="page-connexion">
        <div className="boite-connexion">
          <h1>🏪 Créez votre boutique</h1>
          <p className="sous-titre">
            Votre compte est créé. Il n’est rattaché à aucune boutique : créez la vôtre pour
            commencer à gérer vos produits, votre stock et vos ventes.
          </p>
          {messages}
          {formulaire}
          <p className="note-inscription">
            Vous accéderez ensuite à l’ensemble des fonctions d’administration, limitées à
            votre boutique.
          </p>
          {onDeconnexion && (
            <div className="bascule-mode">
              <button type="button" className="btn-secondaire" onClick={onDeconnexion}>
                🚪 Se déconnecter
              </button>
            </div>
          )}
        </div>
        {bulleCode}
      </div>
    );
  }

  // --- Onglet normal : liste + ajout d'une boutique supplémentaire ---
  return (
    <div>
      {messages}

      <section className="bloc">
        <h2>➕ Créer une boutique</h2>
        {formulaire}
      </section>

      <section className="bloc">
        <h2>🏪 Mes boutiques ({boutiques.length})</h2>
        {boutiques.length === 0 ? (
          <p className="vide">Aucune boutique pour l’instant.</p>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Ville</th>
                <th>Quartier</th>
                <th>Téléphone</th>
                <th>Code ticket</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {boutiques.map((b) => (
                <tr key={b.id}>
                  <td>{b.nom}</td>
                  <td>{b.ville || '—'}</td>
                  <td>{b.quartier || '—'}</td>
                  <td>{b.telephone || '—'}</td>
                  <td>
                    <span className="code-boutique">{b.code}</span>
                  </td>
                  <td>
                    <span className={Number(b.actif) === 1 ? 'badge-actif' : 'badge-inactif'}>
                      {Number(b.actif) === 1 ? '🟢 Active' : '🔴 Archivée'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="note-securite">
          🔒 Vous ne voyez que les boutiques rattachées à votre compte. Chaque compte est lié à
          sa boutique (un administrateur peut en gérer plusieurs).
        </p>
      </section>

      {bulleCode}
    </div>
  );
}

export default CreationBoutique;
