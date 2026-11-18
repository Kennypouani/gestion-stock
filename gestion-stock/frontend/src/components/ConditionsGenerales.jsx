// ============================================================
// CONDITIONS GÉNÉRALES D'UTILISATION — page publique
// Décrit les règles d'usage de l'application par les employés,
// gérants et administrateurs du magasin. Document informatif :
// il ne remplace pas le contrat de travail ni le contrat commercial.
// ============================================================

function ConditionsGenerales({ onRetour, onOuvrirConfidentialite }) {
  return (
    <div className="page-document">
      <div className="boite-document">
        <h1>📄 Conditions générales d'utilisation</h1>
        <p className="date-document">Dernière mise à jour : 18 novembre 2026</p>

        <p>
          Les présentes conditions générales encadrent l'utilisation de l'application de gestion
          de stock, de caisse et d'achats mise à disposition d'un magasin ou d'un réseau de
          magasins. Elles s'appliquent à toute personne disposant d'un compte : administrateur,
          gérant ou employé.
        </p>

        <h2>1. Objet</h2>
        <p>
          L'application permet de suivre les produits et les stocks, d'encaisser les ventes,
          de gérer les fournisseurs et les bons de commande, de consulter des statistiques et,
          pour les administrateurs, de gérer les comptes et les sauvegardes de la base. Elle est
          fournie dans le cadre convenu avec l'exploitant du magasin ; toute prestation payante
          fait l'objet d'un contrat distinct.
        </p>

        <h2>2. Acceptation</h2>
        <p>
          Utiliser l'application vaut acceptation des présentes conditions. Si vous ne les
          acceptez pas, vous ne devez pas utiliser l'application et devez en informer
          l'administrateur de votre magasin.
        </p>

        <h2>3. Accès et comptes</h2>
        <ul>
          <li>
            Les comptes sont créés par l'administrateur, qui attribue un rôle et un magasin de
            rattachement. Chaque personne dispose d'un compte nominatif : les comptes ne se
            partagent pas.
          </li>
          <li>
            Vos identifiants sont personnels et confidentiels. Vous êtes responsable de l'usage
            fait avec votre compte jusqu'à sa désactivation ou jusqu'à ce que vous ayez signalé
            sa compromission.
          </li>
          <li>
            Lorsqu'un mot de passe provisoire vous est remis, il doit être remplacé à la première
            connexion. Choisissez un mot de passe robuste, différent de ceux utilisés ailleurs.
          </li>
          <li>
            Signalez sans délai à l'administrateur toute perte, divulgation ou utilisation
            suspecte de vos identifiants.
          </li>
        </ul>

        <h2>4. Usage autorisé</h2>
        <p>L'application doit être utilisée uniquement pour l'activité du magasin. Il est interdit :</p>
        <ul>
          <li>de contourner les contrôles d'accès ou de tenter d'accéder à un autre magasin ;</li>
          <li>d'extraire ou de copier massivement les données sans autorisation de l'exploitant ;</li>
          <li>de perturber le fonctionnement du service, d'introduire du code malveillant ou
            d'effectuer des tests d'intrusion sans accord écrit ;</li>
          <li>de saisir des données inexactes, diffamatoires ou sans lien avec la gestion du
            magasin.</li>
        </ul>

        <h2>5. Données saisies</h2>
        <p>
          Les données de stock, de vente, de commande et de comptabilité saisies dans
          l'application appartiennent à l'exploitant du magasin. Vous vous engagez à saisir des
          informations exactes et à ne pas divulguer les données commerciales auxquelles votre
          compte donne accès. Les modifications sont tracées dans un journal indiquant leur
          auteur ; l'administrateur peut le consulter.
        </p>

        <h2>6. Disponibilité et maintenance</h2>
        <p>
          L'application est fournie « en l'état ». Elle peut être interrompue, notamment pour une
          maintenance, une mise à jour ou une opération de sauvegarde. Des sauvegardes
          automatiques de la base sont réalisées, mais l'exploitant reste responsable de la
          vérification et de la conservation de ses propres copies. Aucune disponibilité
          permanente ni absence totale d'erreur ne peut être garantie.
        </p>

        <h2>7. Responsabilité</h2>
        <p>
          L'exploitant du magasin est responsable de l'exactitude des données qu'il saisit et de
          l'usage qu'il fait de l'application, notamment des décisions commerciales prises à
          partir de ses indicateurs. Dans les limites permises par la loi applicable, aucune
          partie ne peut être tenue responsable des pertes indirectes résultant d'une coupure,
          d'une mauvaise utilisation, d'un partage d'identifiants ou de la perte d'un appareil.
          Rien dans ces conditions n'exclut une responsabilité qui ne peut légalement l'être.
        </p>

        <h2>8. Sécurité</h2>
        <p>
          Vous devez utiliser un mot de passe robuste, ne pas le réutiliser sur d'autres services,
          verrouiller votre appareil et vous déconnecter lorsque vous quittez un poste partagé.
          En production, l'application doit être servie en HTTPS. Les accès sont contrôlés côté
          serveur selon votre rôle et votre magasin, et les tentatives de connexion échouées sont
          limitées. Toute anomalie de sécurité doit être signalée à l'administrateur.
        </p>

        <h2>9. Données personnelles</h2>
        <p>
          Le traitement des données personnelles (compte, session, activité) est décrit dans la
          politique de confidentialité, accessible depuis cette page et depuis l'écran de
          connexion.
        </p>

        <h2>10. Propriété intellectuelle</h2>
        <p>
          Le logiciel, ses textes et ses éléments graphiques ne peuvent être reproduits, modifiés
          ou diffusés hors du cadre de l'usage interne du magasin sans autorisation écrite.
        </p>

        <h2>11. Suspension et fin d'utilisation</h2>
        <p>
          L'administrateur peut suspendre ou désactiver un compte en cas de manquement aux
          présentes conditions, de départ de la personne ou de risque de sécurité. À la fin de
          l'utilisation, l'accès est retiré et les sessions ouvertes sont fermées. Les données
          nécessaires à la comptabilité et à la traçabilité sont conservées selon les durées
          indiquées dans la politique de confidentialité.
        </p>

        <h2>12. Évolution des conditions</h2>
        <p>
          Ces conditions peuvent être adaptées pour suivre l'évolution de l'application ou de la
          réglementation. La date affichée en haut de page indique la version en vigueur ;
          continuer à utiliser l'application après une mise à jour vaut acceptation de celle-ci.
        </p>

        <h2>13. Droit applicable et litiges</h2>
        <p>
          Les présentes conditions sont soumises au droit applicable au lieu d'établissement de
          l'exploitant. En cas de difficulté, les parties recherchent d'abord une solution
          amiable ; à défaut, le litige est porté devant la juridiction compétente.
        </p>

        <div className="actions-document">
          <button type="button" className="btn-principal" onClick={onRetour}>
            ⬅️ Revenir à l'application
          </button>
          <div className="liens-document liens-document-gauche">
            <button type="button" className="lien-politique" onClick={onOuvrirConfidentialite}>
              🔒 Voir la politique de confidentialité
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConditionsGenerales;
