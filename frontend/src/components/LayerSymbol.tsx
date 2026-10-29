import type { LayerId } from '../types';

export const LAYERS: { id: LayerId; label: string; hint: string; connector: boolean }[] = [
  { id: 'restrictions', label: 'Restrictions aériennes / maritimes', hint: 'Zones officielles et dates de validité. Une restriction n’établit ni attaque ni intention.', connector: true },
  { id: 'aviation', label: 'Aviation civile agrégée', hint: 'Absence de signal ≠ absence d’aéronef ; couverture et activité distinguées.', connector: true },
  { id: 'reseaux', label: 'Réseaux et infrastructures', hint: 'Panne, météo et maintenance restent des explications possibles.', connector: true },
  { id: 'incidents', label: 'Incidents documentés', hint: 'Les reprises d’une même source ne sont pas indépendantes.', connector: true },
  { id: 'mesures', label: 'Mesures officielles', hint: 'La déclaration confirme ce qui est annoncé, pas toute attribution.', connector: true },
  { id: 'satellite', label: 'Images satellite', hint: 'Phase ultérieure : aucun connecteur exploitable pour l’instant.', connector: false },
];

/** Forme géométrique par couche : la couleur ne porte jamais seule l'information. Centrée sur (0,0), rayon ≈ r. */
export function shapePath(layer: LayerId, r: number): string {
  switch (layer) {
    case 'restrictions': // losange
      return `M0 ${-r * 1.2} L${r * 1.2} 0 L0 ${r * 1.2} L${-r * 1.2} 0 Z`;
    case 'aviation': // triangle
      return `M0 ${-r * 1.2} L${r * 1.15} ${r * 0.95} L${-r * 1.15} ${r * 0.95} Z`;
    case 'reseaux': // carré
      return `M${-r} ${-r} H${r} V${r} H${-r} Z`;
    case 'mesures': {
      // hexagone
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        return `${(r * 1.15 * Math.cos(a)).toFixed(2)} ${(r * 1.15 * Math.sin(a)).toFixed(2)}`;
      });
      return `M${pts.join(' L')} Z`;
    }
    case 'satellite': // croix
      return `M${-r * 0.35} ${-r} H${r * 0.35} V${-r * 0.35} H${r} V${r * 0.35} H${r * 0.35} V${r} H${-r * 0.35} V${r * 0.35} H${-r} V${-r * 0.35} H${-r * 0.35} Z`;
    case 'incidents':
    default:
      return `M${-r} 0 A${r} ${r} 0 1 0 ${r} 0 A${r} ${r} 0 1 0 ${-r} 0 Z`;
  }
}

export function LayerSymbol({ layer, className }: { layer: LayerId; className?: string }) {
  return (
    <svg className={className} viewBox="-10 -10 20 20" aria-hidden="true" focusable="false">
      <path d={shapePath(layer, 7)} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
