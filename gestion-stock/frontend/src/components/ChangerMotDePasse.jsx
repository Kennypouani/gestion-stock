// ============================================================
// CHANGEMENT DE MOT DE PASSE — Modale accessible à TOUS les rôles
// Le serveur exige l'ancien mot de passe et ferme les autres
// sessions après le changement.
//
// Mode « obligatoire » : plus de fermeture possible, l'application
// reste bloquée tant que le mot de passe n'a pas été remplacé
// (compte qui utilise encore un mot de passe de démonstration ou
// un mot de passe provisoire fixé par l'administrateur).
// ============================================================

import { useState } from 'react';
import { changerMotDePasse } from '../api';

function ChangerMotDePasse({ onFerme, obligatoire = false, onTermine }) {
  const [ancien, setAncien] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [termine, setTermine] = useState(false);

  async function soumettre(e) {
    e.preventDefault();
    setMessage(null);

    // Contrôles avant d'envoyer (le serveur refait les siens)
    if (nouveau.length < 8) {
      return setMessage({ type: 'erreur', texte: '❌ Le nouveau mot de passe doit faire au moins 8 caractères' });
    }
    if (nouveau !== confirmation) {
      return setMessage({ type: 'erreur', texte: '❌ La confirmation ne correspond pas' });
    }

    setEnvoi(true);
    try {
      const reponse = await changerMotDePasse({
        ancien_mot_de_passe: ancien,
        nouveau_mot_de_passe: nouveau,
        confirmation,
      });
      setMessage({
        type: 'succes',
        texte: `✅ ${reponse.message}${
          reponse.autres_sessions_fermees > 0
            ? ` — ${reponse.autres_sessions_fermees} autre(s) session(s) fermée(s)`
            : ''
        }`,
      });
      setAncien('');
      setNouveau('');
      setConfirmation('');
      if (obligatoire) setTermine(true);
    } catch (err) {
      setMessage({ type: 'erreur', texte: `❌ ${err.message}` });
    } finally {
      setEnvoi(false);
    }
  }

  // --- Écran final du mode obligatoire : on laisse entrer dans l'application ---
  if (termine) {
    return (
      <div className="modale-fond">
        <div className="modale modale-petite">
          <div className="modale-entete">
            <h2>✅ Mot de passe enregistré</h2>
          </div>
          {message && <div className="message message-succes">{message.texte}</div>}
          <div className="actions-formulaire">
            <button type="button" className="btn-principal" onClick={onTermine}>
              Continuer
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modale-fond" onClick={obligatoire ? undefined : onFerme}>
      <div className="modale modale-petite" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h2>{obligatoire ? '🔒 Nouveau mot de passe obligatoire' : '🔑 Changer mon mot de passe'}</h2>
          {!obligatoire && (
            <button className="modale-fermer" onClick={onFerme}>✕</button>
          )}
        </div>

        {obligatoire && (
          <div className="message message-erreur">
            Votre compte utilise encore un mot de passe public. Choisissez un mot de
            passe personnel pour accéder à l'application.
          </div>
        )}

        {message && (
          <div className={`message ${message.type === 'erreur' ? 'message-erreur' : 'message-succes'}`}>
            {message.texte}
          </div>
        )}

        <form className="formulaire" onSubmit={soumettre}>
          <div className="champ">
            <label>Mot de passe actuel *</label>
            <input
              type="password"
              value={ancien}
              onChange={(e) => setAncien(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="champ">
            <label>Nouveau mot de passe * <small>(8 caractères minimum)</small></label>
            <input
              type="password"
              value={nouveau}
              onChange={(e) => setNouveau(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="champ">
            <label>Confirmation *</label>
            <input
              type="password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="actions-formulaire">
            <button type="submit" className="btn-principal" disabled={envoi}>
              {envoi ? 'Enregistrement…' : '💾 Enregistrer'}
            </button>
            {!obligatoire && (
              <button type="button" className="btn-secondaire" onClick={onFerme}>
                Annuler
              </button>
            )}
          </div>
        </form>

        <p className="note-securite">
          🔒 Après le changement, vos autres sessions sont fermées automatiquement.
        </p>
      </div>
    </div>
  );
}

export default ChangerMotDePasse;
