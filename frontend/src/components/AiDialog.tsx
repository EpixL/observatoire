import { useState } from 'react';
import type { AiState } from '../types';
import { Dialog } from './Dialog';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  ai: AiState;
}

/** Confirmation de coût avant toute analyse IA. En maquette : AUCUN appel, même après confirmation. */
export function AiDialog({ open, onClose, onConfirm, ai }: Props) {
  const [scope, setScope] = useState<'current' | 'extended'>('current');
  const cost = scope === 'current' ? ai.estimate.max_cost_usd : ai.estimate.max_cost_usd * 2.5;
  return (
    <Dialog id="ai" open={open} onClose={onClose} title="Approfondir avec l’IA">
      <p>
        Une analyse contradictoire du dossier actuel sera demandée à un modèle, <b>séparément</b> de l’interprétation par règles. Le modèle ne modifie ni le score ni le statut officiel.
      </p>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>Périmètre</legend>
        <label className="radio-row">
          <input type="radio" name="scope" checked={scope === 'current'} onChange={() => setScope('current')} />
          <span>
            <b>Dossier actuel seulement</b>
            <br />
            <span className="muted">{ai.estimate.scope_current}</span>
          </span>
        </label>
        <label className="radio-row">
          <input type="radio" name="scope" checked={scope === 'extended'} onChange={() => setScope('extended')} />
          <span>
            <b>Inclure une recherche supplémentaire</b>
            <br />
            <span className="muted">{ai.estimate.scope_extended}</span>
          </span>
        </label>
      </fieldset>
      <p>
        Coût maximum estimé : <b className="num" data-testid="ai-cost">{cost.toFixed(2)} USD</b> (plafond mensuel {ai.monthly_cap_usd.toFixed(2)} USD, déjà utilisé {ai.monthly_used_usd.toFixed(2)} USD). Le montant est réservé avant l’appel.
      </p>
      <p className="notice">
        <b>Mode maquette :</b> même après confirmation, aucun appel n’est effectué, aucune clé n’est utilisée et rien ne quitte votre navigateur.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn primary" onClick={onConfirm} data-testid="ai-confirm">
          Confirmer (simulation)
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Annuler
        </button>
      </div>
    </Dialog>
  );
}
