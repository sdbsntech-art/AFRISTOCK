import { useEffect, useMemo, useState } from 'react';
import apiRequest from '../api';
import { formatCurrency } from '../lib/format';

export default function StatsPage() {
  const [range, setRange] = useState('today');
  const [stats, setStats] = useState({ stats: {}, topProduct: null, topCategory: null, trend: [] });

  useEffect(() => {
    const load = async () => {
      const data = await apiRequest(`/stats?range=${range}`);
      setStats(data);
    };
    load();
  }, [range]);

  const chartData = useMemo(() => {
    const data = stats.trend || [];
    const maxValue = Math.max(...data.map((item) => Number(item.total_amount || 0)), 1);
    return data.map((item) => ({ ...item, height: (Number(item.total_amount || 0) / maxValue) * 100 }));
  }, [stats]);

  return (
    <div className="stats-page">
      <div className="page-topbar">
        <div>
          <p className="page-kicker">Pilotage</p>
          <h2>Statistiques vendeur</h2>
        </div>
        <div className="segment-control">
          {['today', 'week', 'month', 'year'].map((value) => (
            <button key={value} type="button" className={range === value ? 'segment active' : 'segment'} onClick={() => setRange(value)}>
              {value === 'today' ? "Aujourd'hui" : value === 'week' ? 'Semaine' : value === 'month' ? 'Mois' : 'Année'}
            </button>
          ))}
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card primary"><span>Chiffre d'affaires</span><strong>{formatCurrency(stats.stats?.revenue || 0)}</strong></div>
        <div className="stat-card green"><span>Marge</span><strong>{formatCurrency(stats.stats?.profit || 0)}</strong></div>
        <div className="stat-card blue"><span>Tickets</span><strong>{stats.stats?.sales_count || 0}</strong></div>
        <div className="stat-card orange"><span>Pièces vendues</span><strong>{stats.stats?.items_sold || 0}</strong></div>
      </div>

      <div className="two-columns">
        <section className="panel">
          <h3>Meilleure référence</h3>
          <div className="highlight-box">
            <strong>{stats.topProduct?.name || 'Pas encore de vente'}</strong>
            <span>{stats.topProduct?.total_quantity || 0} sortie(s)</span>
          </div>
        </section>
        <section className="panel">
          <h3>Meilleure catégorie</h3>
          <div className="highlight-box">
            <strong>{stats.topCategory?.name || 'Pas encore de vente'}</strong>
            <span>{stats.topCategory?.total_quantity || 0} sortie(s)</span>
          </div>
        </section>
      </div>

      <section className="panel">
        <h3>Évolution</h3>
        <div className="chart-box">
          {chartData.length ? chartData.map((item, idx) => (
            <div key={`${item.label}-${idx}`} className="bar-group">
              <div className="bar" style={{ height: `${item.height}%` }} title={formatCurrency(item.total_amount)} />
              <span>{item.label}</span>
            </div>
          )) : <p>Pas de données.</p>}
        </div>
      </section>
    </div>
  );
}
