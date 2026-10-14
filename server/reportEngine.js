const money = (value) => `${Number(value || 0).toLocaleString('fr-FR')} FCFA`;
const pct = (value) => `${value > 0 ? '+' : ''}${value.toFixed(1)} %`;

const variation = (current, previous) => {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
};

export const buildMonthlyAnalysis = ({ seller, monthLabel, current, previous }) => {
  const revenue = Number(current?.revenue || 0);
  const profit = Number(current?.profit || 0);
  const tickets = Number(current?.sales_count || 0);
  const items = Number(current?.items_sold || 0);
  const prevRevenue = Number(previous?.revenue || 0);
  const prevProfit = Number(previous?.profit || 0);
  const revenueVar = variation(revenue, prevRevenue);
  const profitVar = variation(profit, prevProfit);
  const avgTicket = tickets ? revenue / tickets : 0;
  const marginRate = revenue ? (profit / revenue) * 100 : 0;
  const daily = current?.daily || [];
  const bestDay = [...daily].sort((a, b) => Number(b.total_amount) - Number(a.total_amount))[0];
  const topProducts = current?.topProducts || (current?.topProduct ? [current.topProduct] : []);
  const topCategories = current?.topCategories || (current?.topCategory ? [current.topCategory] : []);
  const lowStock = current?.lowStock || [];
  const shop = seller?.shop_name || 'AfriStock';
  const person = seller?.name || `${seller?.first_name || ''} ${seller?.last_name || ''}`.trim() || 'Vendeur';
  const comments = [];
  const recommendations = [];

  comments.push(`Document établi pour ${person} (${seller?.username || 'compte vendeur'}), ${seller?.email || 'email non renseigné'}${seller?.phone ? `, tél. ${seller.phone}` : ''}. Boutique : ${shop}.`);

  if (seller?.created_at) {
    comments.push(`Compte ouvert le ${new Date(seller.created_at).toLocaleDateString('fr-FR')}. Ce rapport reprend les identifiants d’inscription et l’activité de ${monthLabel}.`);
  }

  if (!tickets) {
    comments.push(`Aucune vente n’a été enregistrée en ${monthLabel} pour ${shop}. Le stock et l’identité du vendeur restent toutefois disponibles pour le suivi.`);
    recommendations.push('Enregistrez chaque ticket en caisse : le prochain rapport se remplira automatiquement.');
  } else if (revenueVar >= 12) {
    comments.push(`Performance en hausse : le chiffre d’affaires de ${shop} atteint ${money(revenue)}, soit ${pct(revenueVar)} par rapport au mois précédent.`);
  } else if (revenueVar <= -12) {
    comments.push(`Mois plus calme : ${money(revenue)} encaissés (${pct(revenueVar)} vs mois précédent). Marge réalisée : ${money(profit)}.`);
  } else {
    comments.push(`Activité régulière pour ${person} : ${money(revenue)} de ventes, ${tickets} ticket(s), marge ${money(profit)} (${marginRate.toFixed(1)} %).`);
  }

  if (tickets) {
    comments.push(`Panier moyen ${money(avgTicket)} pour ${items} pièce(s) sortie(s).${bestDay ? ` Meilleur jour : le ${bestDay.label} (${money(bestDay.total_amount)}).` : ''}`);
  }

  if (topProducts[0]?.total_quantity) {
    comments.push(`Référence phare : ${topProducts[0].name} (${topProducts[0].total_quantity} sortie(s)). Anticipez le réassort de cette pièce.`);
  }

  if (topCategories[0]?.total_quantity) {
    comments.push(`Rayon dominant : ${topCategories[0].name}. Placez ces articles près de la caisse.`);
  }

  if (marginRate < 18 && tickets) {
    comments.push(`Marge tendue (${marginRate.toFixed(1)} %). Surveillez les prix d’achat des pièces à forte rotation.`);
    recommendations.push('Recalculez le prix de vente des 5 références les plus vendues pour viser au moins 25 % de marge.');
  } else if (marginRate >= 30 && tickets) {
    comments.push(`Marge confortable (${marginRate.toFixed(1)} %). La politique tarifaire de ${shop} tient.`);
  }

  if (lowStock.length) {
    comments.push(`${lowStock.length} référence(s) sous le seuil : risque de rupture le mois suivant.`);
    recommendations.push(`Réception prioritaire : ${lowStock.slice(0, 3).map((item) => item.name).join(', ')}.`);
  } else {
    comments.push('Aucune alerte stock majeure à la clôture du mois.');
  }

  if (profitVar <= -15 && prevProfit) {
    recommendations.push('Comparez les tickets avec d’éventuelles ventes à prix serré.');
  }

  if (!recommendations.length) {
    recommendations.push('Archivez ce rapport et conservez le même rythme de caisse.');
  }

  return {
    headline: tickets ? `Rapport ${monthLabel} — ${shop}` : `Clôture ${monthLabel} — ${shop} (sans vente)`,
    period_label: monthLabel,
    comments,
    recommendations,
    kpis: {
      revenue,
      profit,
      tickets,
      items,
      avgTicket,
      marginRate,
      revenueVar,
      profitVar,
    },
  };
};
