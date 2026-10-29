import type { GaugeState } from '../types';
import { Dialog } from './Dialog';
import { PALIERS } from '../lib/scale';

interface Props {
  open: boolean;
  onClose: () => void;
  gauge: GaugeState;
  thresholdsModified?: number;
}

export function ScaleDialog({ open, onClose, gauge, thresholdsModified = 0 }: Props) {
  return (
    <Dialog id="scale" open={open} onClose={onClose} title="Comprendre l’échelle">
      <p>
        <b>Indice de confrontation armée — {gauge.territory.label}.</b> Échelle ordinale à huit paliers, fondée sur des critères explicites. Un passage de 25 à 40 ne
        signifie pas un risque multiplié : les écarts sont conventionnels, <b>non probabilistes</b>. Aucun compte à rebours.
      </p>
      <ul className="scale-table">
        {PALIERS.map((p) => (
          <li key={p.value} aria-current={gauge.palier === p.value ? 'true' : undefined}>
            <span className="v">{p.value}</span>
            <div>
              <b>
                {p.label}
                {gauge.palier === p.value ? ' — palier actuel' : ''}
              </b>
              <p>{p.criteria}</p>
              {p.value === 0 && <p>L’interface dit « Aucun signal qualifiant observé », jamais « risque zéro » ni « sécurité garantie ».</p>}
              {p.value === 100 && <p>100 sature : durée, étendue et effets du conflit restent suivis séparément. Ce n’est ni la destruction totale ni, par définition, une attaque nucléaire.</p>}
            </div>
          </li>
        ))}
        <li aria-current={gauge.status === 'non_calculable' ? 'true' : undefined}>
          <span className="v">—</span>
          <div>
            <b>Non calculable{gauge.status === 'non_calculable' ? ' — état actuel' : ''}</b>
            <p>
              Le profil de couverture n’est pas satisfait : jauge grisée, tiret à la place du score. La dernière valeur connue est affichée avec sa date, sans retour à 0. Zéro et
              inconnu sont deux choses distinctes.
            </p>
          </div>
        </li>
      </ul>
      {thresholdsModified > 0 && (
        <p className="notice" data-testid="scale-thr-note">
          ⚠ {thresholdsModified} seuil{thresholdsModified > 1 ? 's' : ''} de décision diff{thresholdsModified > 1 ? 'èrent' : 'ère'} du plan : les critères ci-dessus sont ceux du plan, le calcul actuel n’y est pas strictement conforme. Voir Réglages › Seuils de la jauge.
        </p>
      )}
      <p className="notice">
        Le palier retenu est le plus élevé dont <b>toutes</b> les conditions sont remplies : pas de somme de signaux faibles. Un fait grave établi malgré une couverture
        partielle reste affiché avec le badge « couverture partielle ». La jauge ne résume pas tous les dangers : alertes civiles et statut nucléaire / radiologique sont
        indépendants. Règles : <span className="mono">{gauge.policy.version}</span>, propositions de produit à tester, pas une norme géopolitique.
      </p>
    </Dialog>
  );
}
