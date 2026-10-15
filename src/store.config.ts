import type { DeepPartial, SiteConfig } from './config';

/**
 * Réglages de construction de Maison Démo. Seules les valeurs qui diffèrent des
 * défauts de `config.ts` sont listées ; elles sont fusionnées par-dessus.
 *
 * La livraison ci-dessous est le point de départ d'une boutique neuve : une fois
 * enregistrée depuis Admin → Shipping, c'est l'administration qui fait foi.
 */
export const storeOverrides: DeepPartial<SiteConfig> = {
  // Le nom affiché là où le réglage de l'administration n'est pas lu (page de
  // paiement, llms.txt, libellé des factures Lightning).
  storeName: 'Maison Démo',

  // Premier numéro de commande : 1000.
  orderNumber: { offset: 1000, step: 1, randomStep: 0 },

  shipping: {
    enabled: true,
    // Carton et papier de soie, comptés une fois par colis.
    packageWeightGrams: 250,
    zones: [
      {
        countries: ['FR'],
        rates: [
          { label: 'Colissimo suivi, 48 à 72 h', amountCents: 590 },
          { label: 'Livraison express, 24 h', amountCents: 1290 },
        ],
        // Livraison offerte dès 150 € : c'est la promesse affichée dans le thème.
        freeOverCents: 15000,
      },
    ],
  },
};
