/**
 * Zones du gazetier backend (config/zones.yaml, codes ISO 3166-1 alpha-2) : nom français, code alpha-3 des géométries
 * Natural Earth, centre indicatif (lon, lat). Le backend n'envoie que le code ; le nom affiché vient d'ici.
 * Les centres reprennent ceux de zones.yaml (à l'échelle du pays seulement).
 */
export interface ZoneInfo {
  name: string;
  a3: string;
  center: [number, number];
}

export const ZONES: Record<string, ZoneInfo> = {
  FR: { name: 'France', a3: 'FRA', center: [2.3, 46.6] },
  GP: { name: 'Guadeloupe', a3: 'GLP', center: [-61.55, 16.25] },
  MQ: { name: 'Martinique', a3: 'MTQ', center: [-61.0, 14.65] },
  GF: { name: 'Guyane', a3: 'GUF', center: [-53.0, 4.0] },
  RE: { name: 'La Réunion', a3: 'REU', center: [55.5, -21.1] },
  YT: { name: 'Mayotte', a3: 'MYT', center: [45.15, -12.8] },
  PM: { name: 'Saint-Pierre-et-Miquelon', a3: 'SPM', center: [-56.3, 46.9] },
  BL: { name: 'Saint-Barthélemy', a3: 'BLM', center: [-62.85, 17.9] },
  MF: { name: 'Saint-Martin', a3: 'MAF', center: [-63.05, 18.07] },
  NC: { name: 'Nouvelle-Calédonie', a3: 'NCL', center: [165.6, -21.3] },
  PF: { name: 'Polynésie française', a3: 'PYF', center: [-149.4, -17.7] },
  WF: { name: 'Wallis-et-Futuna', a3: 'WLF', center: [-176.2, -13.8] },
  UA: { name: 'Ukraine', a3: 'UKR', center: [31.2, 48.4] },
  RU: { name: 'Russie', a3: 'RUS', center: [95, 61] },
  BY: { name: 'Biélorussie', a3: 'BLR', center: [28, 53.7] },
  PL: { name: 'Pologne', a3: 'POL', center: [19.4, 52.1] },
  LT: { name: 'Lituanie', a3: 'LTU', center: [23.9, 55.3] },
  LV: { name: 'Lettonie', a3: 'LVA', center: [24.9, 56.9] },
  EE: { name: 'Estonie', a3: 'EST', center: [25.5, 58.7] },
  FI: { name: 'Finlande', a3: 'FIN', center: [26, 64.5] },
  SE: { name: 'Suède', a3: 'SWE', center: [15.5, 62.5] },
  NO: { name: 'Norvège', a3: 'NOR', center: [9.5, 61] },
  DK: { name: 'Danemark', a3: 'DNK', center: [10, 56] },
  DE: { name: 'Allemagne', a3: 'DEU', center: [10.4, 51.1] },
  BE: { name: 'Belgique', a3: 'BEL', center: [4.6, 50.6] },
  NL: { name: 'Pays-Bas', a3: 'NLD', center: [5.3, 52.2] },
  GB: { name: 'Royaume-Uni', a3: 'GBR', center: [-2.5, 54] },
  IE: { name: 'Irlande', a3: 'IRL', center: [-8, 53.2] },
  ES: { name: 'Espagne', a3: 'ESP', center: [-3.7, 40.2] },
  PT: { name: 'Portugal', a3: 'PRT', center: [-8, 39.6] },
  IT: { name: 'Italie', a3: 'ITA', center: [12.6, 42.8] },
  CH: { name: 'Suisse', a3: 'CHE', center: [8.2, 46.8] },
  AT: { name: 'Autriche', a3: 'AUT', center: [14.5, 47.6] },
  CZ: { name: 'Tchéquie', a3: 'CZE', center: [15.5, 49.8] },
  SK: { name: 'Slovaquie', a3: 'SVK', center: [19.5, 48.7] },
  HU: { name: 'Hongrie', a3: 'HUN', center: [19.4, 47.2] },
  RO: { name: 'Roumanie', a3: 'ROU', center: [25, 45.9] },
  MD: { name: 'Moldavie', a3: 'MDA', center: [28.5, 47.2] },
  BG: { name: 'Bulgarie', a3: 'BGR', center: [25.2, 42.7] },
  GR: { name: 'Grèce', a3: 'GRC', center: [22, 39] },
  RS: { name: 'Serbie', a3: 'SRB', center: [20.8, 44] },
  XK: { name: 'Kosovo', a3: 'KOS', center: [20.9, 42.6] },
  TR: { name: 'Turquie', a3: 'TUR', center: [35, 39] },
  GE: { name: 'Géorgie', a3: 'GEO', center: [43.4, 42.2] },
  AM: { name: 'Arménie', a3: 'ARM', center: [44.9, 40.3] },
  AZ: { name: 'Azerbaïdjan', a3: 'AZE', center: [47.7, 40.3] },
  IL: { name: 'Israël', a3: 'ISR', center: [35, 31.4] },
  PS: { name: 'Palestine', a3: 'PSX', center: [35.2, 31.9] },
  LB: { name: 'Liban', a3: 'LBN', center: [35.9, 33.9] },
};

/** Code ISO-2 (backend) → code alpha-3 des polygones. Un code déjà en alpha-3 est conservé. */
export const a3Of = (code: string | undefined): string | undefined => (code ? (ZONES[code]?.a3 ?? code) : undefined);
export const zoneName = (code: string | null | undefined): string => (code ? (ZONES[code]?.name ?? code) : 'lieu inconnu');

/**
 * Décision de David (30/10) : le marqueur de la Russie est posé sur l'OUEST du pays, à l'échelle région.
 * Le backend (zones.yaml) donne [95, 61], en Sibérie : demande à A dans docs/api-contract.md. En attendant, ce décalage
 * d'AFFICHAGE est appliqué ici, il est nommé et n'est pas présenté comme une position précise.
 */
export const DISPLAY_OVERRIDES: Record<string, { center: [number, number]; precision: 'region'; name: string }> = {
  RU: { center: [38, 56], precision: 'region', name: 'Ouest de la Russie' },
};
