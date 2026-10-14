export const formatCurrency = (value) => `${Number(value || 0).toLocaleString('fr-FR')} FCFA`;

export const FAMILIES = [
  { id: '', label: 'Tout le stock' },
  { id: 'ecrans', label: 'Écrans' },
  { id: 'chargeurs-iphone', label: 'Chargeurs iPhone' },
  { id: 'chargeurs-samsung', label: 'Chargeurs Samsung' },
  { id: 'chargeurs-autres', label: 'Autres chargeurs' },
  { id: 'pieces', label: 'Pièces détachées' },
  { id: 'connecteurs', label: 'Connecteurs' },
  { id: 'autres', label: 'Autres produits' },
];

export const FAMILY_LABELS = Object.fromEntries(FAMILIES.filter((item) => item.id).map((item) => [item.id, item.label]));
