import type { AiMode } from '../types';
import { Dialog } from './Dialog';

export type Theme = 'auto' | 'dark' | 'light';

interface Props {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  aiMode: AiMode;
  onAiMode: (m: AiMode) => void;
  budgetOut: boolean;
  onBudgetOut: (b: boolean) => void;
}

const MODES: { id: AiMode; label: string; hint: string }[] = [
  { id: 'desactivee', label: 'Désactivée', hint: 'Aucune extraction, inférence ni recherche IA. Consommation zéro.' },
  { id: 'a_la_demande', label: 'À la demande (recommandé)', hint: 'Une analyse n’est lancée qu’après confirmation du coût maximum.' },
  { id: 'automatique', label: 'Automatique sous conditions', hint: 'Seulement sur changement matériel, avec règles d’éligibilité et budget.' },
];

export function Settings(p: Props) {
  return (
    <Dialog id="settings" open={p.open} onClose={p.onClose} title="Réglages">
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>Thème</legend>
        {(
          [
            ['auto', 'Automatique (préférence du système)'],
            ['dark', 'Sombre — bleu nuit'],
            ['light', 'Clair — accessible'],
          ] as [Theme, string][]
        ).map(([id, label]) => (
          <label key={id} className="radio-row">
            <input type="radio" name="theme" checked={p.theme === id} onChange={() => p.onTheme(id)} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>Mode IA</legend>
        {MODES.map((m) => (
          <label key={m.id} className="radio-row">
            <input type="radio" name="ai" checked={p.aiMode === m.id} onChange={() => p.onAiMode(m.id)} />
            <span>
              <b>{m.label}</b>
              <br />
              <span className="muted">{m.hint}</span>
            </span>
          </label>
        ))}
        <label className="radio-row">
          <input type="checkbox" checked={p.budgetOut} onChange={(e) => p.onBudgetOut(e.target.checked)} />
          <span>
            <b>Simuler un budget IA épuisé</b>
            <br />
            <span className="muted">Pour voir l’état « budget épuisé » : le reste du tableau de bord reste utilisable.</span>
          </span>
        </label>
      </fieldset>
      <p className="notice">
        En maquette, ces réglages ne sont conservés que dans cet onglet (le thème est mémorisé localement). Le changement du périmètre d’analyse, des seuils et des sources sera une commande authentifiée distincte côté serveur.
        Affichage en fuseau Europe/Paris ; les données sont stockées en UTC.
      </p>
    </Dialog>
  );
}
