// ============================================================
// VENTES PAR PÉRIODE + ÉVOLUTION DANS LE TEMPS
// Bloc ajouté au tableau de bord, après le Top 5 des ventes.
//   • le gérant voit les totaux de SA boutique
//   • l'admin voit le total du réseau + le détail par boutique
// Le graphique est un SVG dessiné à la main : aucune bibliothèque
// supplémentaire, aucun poids ajouté au chargement de la page.
// ============================================================

import { useState, useEffect } from 'react';
import { getStatsVentes } from '../api';

const PERIODES = [
  { cle: 'jour', icone: '📅', libelle: "Aujourd'hui" },
  { cle: 'semaine', icone: '🗓️', libelle: 'Cette semaine' },
  { cle: 'mois', icone: '📆', libelle: 'Ce mois' },
  { cle: 'annee', icone: '📈', libelle: 'Cette année' },
];

const GRANULARITES = [
  { cle: 'jour', libelle: 'Jour', precision: '30 derniers jours' },
  { cle: 'semaine', libelle: 'Semaine', precision: '12 dernières semaines' },
  { cle: 'mois', libelle: 'Mois', precision: '12 derniers mois' },
  { cle: 'annee', libelle: 'Année', precision: '5 dernières années' },
];

const fcfa = (valeur) => `${Math.round(Number(valeur) || 0).toLocaleString('fr-FR')} FCFA`;

// Valeur courte pour l'axe vertical : 250 000 → « 250 k »
function abrege(valeur) {
  if (valeur >= 1000000) return `${Math.round(valeur / 100000) / 10} M`;
  if (valeur >= 1000) return `${Math.round(valeur / 100) / 10} k`;
  if (valeur >= 10) return String(Math.round(valeur));
  return String(Math.round(valeur * 10) / 10);
}

// Plafond « rond » de l'axe : 1, 2, 2,5 ou 5 × une puissance de dix
function plafondArrondi(maximum) {
  if (!(maximum > 0)) return 1;
  const puissance = Math.pow(10, Math.floor(Math.log10(maximum)));
  for (const facteur of [1, 2, 2.5, 5, 10]) {
    if (facteur * puissance >= maximum) return facteur * puissance;
  }
  return 10 * puissance;
}

// --- Courbe d'évolution (SVG) ---
function Graphique({ points }) {
  const LARGEUR = 780;
  const HAUTEUR = 250;
  const MARGE_GAUCHE = 68;
  const MARGE_DROITE = 16;
  const MARGE_HAUT = 16;
  const MARGE_BAS = 42;

  const largeurUtile = LARGEUR - MARGE_GAUCHE - MARGE_DROITE;
  const hauteurUtile = HAUTEUR - MARGE_HAUT - MARGE_BAS;
  const maximum = plafondArrondi(Math.max(...points.map((p) => p.total), 0));
  // Cinq intervalles : les graduations tombent sur des valeurs entières
  const GRADUATIONS = [0, 0.2, 0.4, 0.6, 0.8, 1];

  const x = (i) =>
    points.length === 1
      ? MARGE_GAUCHE + largeurUtile / 2
      : MARGE_GAUCHE + (i * largeurUtile) / (points.length - 1);
  const y = (valeur) => MARGE_HAUT + hauteurUtile - (valeur / maximum) * hauteurUtile;
  const base = MARGE_HAUT + hauteurUtile;

  const trace = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.total).toFixed(1)}`).join(' ');
  const aire = `${trace} L ${x(points.length - 1).toFixed(1)} ${base} L ${x(0).toFixed(1)} ${base} Z`;

  // Une graduation tous les ~7 points, plus la dernière pour situer la fin
  const pasEtiquette = Math.max(1, Math.ceil(points.length / 7));

  return (
    <svg
      className="graphique-ventes"
      viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
      role="img"
      aria-label="Courbe d'évolution des ventes dans le temps"
    >
      <defs>
        <linearGradient id="degrade-ventes" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Grille et graduations verticales */}
      {GRADUATIONS.map((fraction) => {
        const valeur = maximum * fraction;
        const ordonnee = y(valeur);
        return (
          <g key={fraction}>
            <line
              x1={MARGE_GAUCHE}
              y1={ordonnee}
              x2={LARGEUR - MARGE_DROITE}
              y2={ordonnee}
              stroke="#e5e7eb"
              strokeWidth="1"
            />
            <text x={MARGE_GAUCHE - 8} y={ordonnee + 4} textAnchor="end" className="graphique-axe">
              {abrege(valeur)}
            </text>
          </g>
        );
      })}

      {/* Aire puis courbe */}
      <path d={aire} fill="url(#degrade-ventes)" />
      <path d={trace} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

      {/* Points + info-bulle native au survol */}
      {points.map((p, i) => (
        <circle key={p.cle} cx={x(i)} cy={y(p.total)} r="3.5" fill="#1e40af">
          <title>{`${p.libelleLong} : ${fcfa(p.total)} (${p.nb_tickets} ticket(s))`}</title>
        </circle>
      ))}

      {/* Étiquettes de l'axe horizontal */}
      {points.map((p, i) =>
        i % pasEtiquette === 0 || i === points.length - 1 ? (
          <text
            key={p.cle}
            x={x(i)}
            y={HAUTEUR - 14}
            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
            className="graphique-axe"
          >
            {p.libelle}
          </text>
        ) : null
      )}
    </svg>
  );
}

function VentesEtEvolution() {
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [granularite, setGranularite] = useState('jour');

  useEffect(() => {
    let annule = false;
    getStatsVentes()
      .then((d) => {
        if (!annule) setDonnees(d);
      })
      .catch((e) => {
        if (!annule) setErreur(e.message);
      });
    return () => {
      annule = true;
    };
  }, []);

  if (erreur) return <div className="message-erreur">❌ Ventes : {erreur}</div>;
  if (!donnees) return <div className="message-chargement">Chargement des ventes…</div>;

  const { periodes, evolution, par_boutique: parBoutique, portee } = donnees;
  const serie = evolution[granularite];
  const granulariteActive = GRANULARITES.find((g) => g.cle === granularite);
  const libellePortee = portee.toutes
    ? '🏬 Ensemble du réseau'
    : portee.boutique
      ? `🏬 ${portee.boutique.nom}`
      : null;

  return (
    <>
      {/* --- Totaux du jour, de la semaine, du mois et de l'année --- */}
      <section className="bloc">
        <div className="entete-section">
          <h2>💰 Ventes par période</h2>
          {libellePortee && <span className="etiquette-portee">{libellePortee}</span>}
        </div>

        <div className="cartes cartes-periodes">
          {PERIODES.map((p) => (
            <div className="carte carte-ventes" key={p.cle}>
              <span className="carte-label">
                {p.icone} {p.libelle}
              </span>
              <span className="carte-valeur carte-valeur-ventes">{fcfa(periodes[p.cle].total)}</span>
              <span className="carte-label">
                {periodes[p.cle].nb_tickets} ticket{periodes[p.cle].nb_tickets > 1 ? 's' : ''}
              </span>
            </div>
          ))}
        </div>

        {/* Détail par boutique — administrateur uniquement */}
        {parBoutique && parBoutique.length > 0 && (
          <table className="tableau tableau-boutiques">
            <thead>
              <tr>
                <th>Boutique</th>
                <th>Jour</th>
                <th>Semaine</th>
                <th>Mois</th>
                <th>Année</th>
              </tr>
            </thead>
            <tbody>
              {parBoutique.map((b) => (
                <tr key={b.id}>
                  <td>
                    {b.nom} <span className="code-boutique">{b.code}</span>
                  </td>
                  <td>{fcfa(b.jour)}</td>
                  <td>{fcfa(b.semaine)}</td>
                  <td>{fcfa(b.mois)}</td>
                  <td>{fcfa(b.annee)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Réseau</td>
                <td>{fcfa(periodes.jour.total)}</td>
                <td>{fcfa(periodes.semaine.total)}</td>
                <td>{fcfa(periodes.mois.total)}</td>
                <td>{fcfa(periodes.annee.total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      {/* --- Courbe d'évolution de la productivité --- */}
      <section className="bloc">
        <div className="entete-section">
          <h2>📈 Évolution des ventes</h2>
          <div className="filtres">
            {GRANULARITES.map((g) => (
              <button
                key={g.cle}
                type="button"
                className={`filtre ${granularite === g.cle ? 'filtre-actif' : ''}`}
                onClick={() => setGranularite(g.cle)}
              >
                {g.libelle}
              </button>
            ))}
          </div>
        </div>

        <p className="note-securite">
          Montant encaissé par {granulariteActive.cle} sur les {granulariteActive.precision} —
          total {fcfa(serie.total)} ({serie.nb_tickets} ticket{serie.nb_tickets > 1 ? 's' : ''}).
        </p>

        {serie.total === 0 ? (
          <p className="succes">Aucune vente enregistrée sur cette période.</p>
        ) : (
          <Graphique points={serie.points} />
        )}
      </section>
    </>
  );
}

export default VentesEtEvolution;
