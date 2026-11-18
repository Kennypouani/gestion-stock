// ============================================================
// POLITIQUE DE CONFIDENTIALITÉ — page publique
// Accessible avant connexion : elle décrit les données réellement
// traitées par l'application (comptes, sessions, activité de stock).
// Aucun texte ne doit promettre plus que ce que le code fait.
// ============================================================

function PolitiqueConfidentialite({ onRetour, onOuvrirConditions }) {
  return (
    <div className="page-document">
      <div className="boite-document">
        <h1>🔒 Politique de confidentialité</h1>
        <p className="date-document">Dernière mise à jour : 18 novembre 2026</p>

        <p>
          Cette application de gestion de stock est un outil professionnel utilisé par un magasin
          ou un réseau de magasins. Elle traite les données nécessaires à la gestion des stocks,
          à la caisse et à la traçabilité des opérations. Cette page explique quelles données sont
          collectées, pourquoi, combien de temps elles sont conservées et comment exercer vos droits.
        </p>

        <h2>1. Responsable du traitement</h2>
        <p>
          Le responsable du traitement est l'exploitant du magasin (ou du réseau de magasins) qui
          utilise l'application. Les demandes relatives aux données personnelles se font auprès de
          l'administrateur de l'application au sein de votre magasin, qui est l'interlocuteur
          désigné pour ce sujet.
        </p>

        <h2>2. Données collectées</h2>
        <ul>
          <li>
            <strong>Compte utilisateur :</strong> nom, adresse e-mail, rôle (administrateur,
            gérant ou employé), magasin de rattachement, statut du compte et date de création.
          </li>
          <li>
            <strong>Mot de passe :</strong> jamais conservé en clair. Il est enregistré sous forme
            de hachage bcrypt ; le serveur ne peut pas le relire.
          </li>
          <li>
            <strong>Session :</strong> un identifiant de session aléatoire, stocké uniquement sous
            forme d'empreinte SHA-256, avec sa date de création et sa date d'expiration. Il est
            transmis par un cookie nommé <code>session</code>, inaccessible au JavaScript de la
            page, valable 24 heures, et marqué « Secure » lorsque l'application est servie en HTTPS.
          </li>
          <li>
            <strong>Activité professionnelle :</strong> tickets de caisse, mouvements de stock,
            commandes fournisseurs et journal des modifications (auteur, action, ancienne et
            nouvelle valeur, motif, date). Ce journal est indispensable pour savoir qui a modifié
            quoi.
          </li>
          <li>
            <strong>Données techniques de sécurité :</strong> adresse IP utilisée temporairement
            pour limiter les tentatives de connexion échouées (protection contre les attaques par
            force brute).
          </li>
        </ul>
        <p>
          Aucune donnée bancaire n'est enregistrée : le moyen de paiement d'un ticket (espèces,
          carte ou mobile) est conservé, mais jamais le numéro de carte ni le détail d'une
          transaction bancaire.
        </p>

        <h2>3. Finalités et bases légales</h2>
        <ul>
          <li>Authentifier les utilisateurs et protéger l'accès aux données du magasin.</li>
          <li>Gérer le stock, encaisser les ventes et suivre les commandes fournisseurs.</li>
          <li>
            Assurer la traçabilité des opérations et la sécurité du système (journal, limitation
            des tentatives de connexion, sauvegardes).
          </li>
          <li>Respecter les obligations comptables et légales applicables aux tickets de caisse.</li>
        </ul>
        <p>
          Ces traitements reposent sur l'exécution de la relation de travail ou du contrat
          commercial, sur l'intérêt légitime à sécuriser et tracer les opérations, et sur les
          obligations légales de conservation. Aucune donnée n'est utilisée à des fins de publicité,
          de profilage ou de décision automatisée.
        </p>

        <h2>4. Destinataires</h2>
        <p>
          Les données sont accessibles aux utilisateurs de l'application selon leur rôle et leur
          magasin : un employé voit la caisse et le stock de son magasin, un gérant ceux de son
          magasin, un administrateur l'ensemble du réseau. Elles peuvent être hébergées chez un
          prestataire technique agissant sur instruction du responsable du traitement, et sont
          communiquées aux autorités lorsque la loi l'exige. Elles ne sont ni vendues ni cédées à
          des tiers, et aucun service publicitaire ou d'analyse d'audience n'est intégré à
          l'application.
        </p>

        <h2>5. Durées de conservation</h2>
        <ul>
          <li>
            <strong>Sessions :</strong> 24 heures au maximum ; les sessions expirées sont purgées
            automatiquement, notamment toutes les heures.
          </li>
          <li>
            <strong>Comptes :</strong> pendant la durée de la relation de travail, puis supprimés
            ou désactivés par l'administrateur.
          </li>
          <li>
            <strong>Activité de gestion :</strong> pendant la durée nécessaire au suivi du stock et
            aux obligations comptables et légales applicables aux ventes et aux commandes.
          </li>
          <li>
            <strong>Sauvegardes :</strong> seules les 7 copies les plus récentes de la base sont
            conservées ; les plus anciennes sont supprimées automatiquement.
          </li>
        </ul>

        <h2>6. Sécurité</h2>
        <p>
          Les mots de passe sont hachés avec bcrypt et les jetons de session sont stockés sous
          forme d'empreinte, de sorte qu'une copie de la base ne permet pas de rejouer une session.
          L'accès aux données est contrôlé côté serveur à chaque requête, selon le rôle et le
          magasin de l'utilisateur. Les tentatives de connexion échouées sont limitées, les
          sessions sont fermées lors d'un changement de mot de passe, et les changements de mot de
          passe de démonstration sont refusés lorsque la sécurité stricte est active. En
          production, l'application doit être servie en HTTPS et les sauvegardes de la base doivent
          être protégées.
        </p>

        <h2>7. Vos droits</h2>
        <p>
          Vous pouvez demander l'accès à vos données, leur rectification, leur effacement, la
          limitation de leur traitement ou vous opposer à ce traitement. Adressez votre demande à
          l'administrateur de l'application, qui la traitera dans les délais prévus par la
          législation applicable. Certaines données (tickets, journal des modifications) peuvent
          être conservées malgré une demande d'effacement lorsqu'une obligation légale ou la
          traçabilité des opérations l'impose. Vous pouvez également introduire une réclamation
          auprès de l'autorité nationale chargée de la protection des données personnelles.
        </p>

        <h2>8. Mineurs</h2>
        <p>
          L'application est un outil professionnel destiné aux personnes habilitées par le magasin.
          Elle n'est pas destinée aux mineurs et ne collecte pas sciemment leurs données.
        </p>

        <h2>9. Modifications</h2>
        <p>
          Cette politique peut être mise à jour pour suivre l'évolution de l'application ou de la
          réglementation. La date affichée en haut de page indique la version en vigueur.
        </p>

        <div className="actions-document">
          <button type="button" className="btn-principal" onClick={onRetour}>
            ⬅️ Revenir à l'application
          </button>
          <div className="liens-document liens-document-gauche">
            <button type="button" className="lien-politique" onClick={onOuvrirConditions}>
              📄 Voir les conditions générales d'utilisation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PolitiqueConfidentialite;
