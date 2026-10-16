import { useEffect, useMemo, useState } from 'react';
import apiRequest from '../api';
import { formatCurrency } from '../lib/format';

const ranges = [
  { value: 'today', label: "Aujourd'hui" },
  { value: 'week', label: '7 jours' },
  { value: 'month', label: '30 jours' },
];

export default function DashboardPage({ onToast, onOpenStock, onNavigate }) {
  const [range, setRange] = useState('today');
  const [dashboard, setDashboard] = useState(null);
  const [stats, setStats] = useState(null);
  const [sales, setSales] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [data, statsData, salesData] = await Promise.all([
          apiRequest('/dashboard'),
          apiRequest(`/stats?range=${range}`),
          apiRequest(`/sales?range=${range}`),
        ]);
        setDashboard(data);
        setStats(statsData);
        setSales(salesData);
      } catch (error) {
        onToast({ type: 'error', message: error.message });
      }
    };
    load();
  }, [range, onToast]);

  const salesLineData = useMemo(() => {
    const trend = stats?.trend?.length ? stats.trend : dashboard?.salesTrend || [];
    const maxValue = Math.max(...trend.map((item) => Number(item.total_amount || 0)), 1);
    return trend.map((item) => ({
      ...item,
      height: (Number(item.total_amount || 0) / maxValue) * 100,
      day: item.label || item.day,
    }));
  }, [dashboard, stats]);

  if (!dashboard) {
    return <div className="panel">Chargement…</div>;
  }

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <p className="page-kicker">Accueil</p>
          <h2>Tableau de bord</h2>
        </div>
        <div className="quick-actions">
          <button type="button" className="primary-button" onClick={() => onNavigate?.('sale')}>Nouvelle vente</button>
          <button type="button" className="ghost-button" onClick={() => onNavigate?.('products')}>Gérer le stock</button>
        </div>
      </div>

      <div className="segment-control">
        {ranges.map((item) => (
          <button key={item.value} type="button" className={range === item.value ? 'segment active' : 'segment'} onClick={() => setRange(item.value)}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="stats-grid">
        <div className="stat-card primary">
          <span>Encaissé</span>
          <strong>{formatCurrency(stats?.stats?.revenue || dashboard.todaySales?.total_amount || 0)}</strong>
          <small>{stats?.stats?.sales_count || 0} ticket(s)</small>
        </div>
        <div className="stat-card">
          <span>Marge</span>
          <strong>{formatCurrency(stats?.stats?.profit || dashboard.todaySales?.total_profit || 0)}</strong>
          <small>{stats?.stats?.items_sold || dashboard.todaySales?.items_count || 0} articles</small>
        </div>
        <div className="stat-card">
          <span>En stock</span>
          <strong>{dashboard.totalStock?.total || 0}</strong>
          <small>{dashboard.totalProducts?.total || 0} références</small>
        </div>
        <div className="stat-card">
          <span>Valeur stock</span>
          <strong>{formatCurrency(dashboard.estimatedProfit || 0)}</strong>
          <small>Marge si tout se vend</small>
        </div>
      </div>

      <div className="two-columns">
        <section className="panel">
          <h3>Évolution</h3>
          <div className="chart-box">
            {salesLineData.some((item) => Number(item.total_amount || 0) > 0)
              ? salesLineData.map((item, index) => (
                <div key={`${item.day}-${index}`} className="bar-group">
                  <div className="bar" style={{ height: `${Math.max(item.height, 6)}%` }} title={formatCurrency(item.total_amount)} />
                  <span>{item.day}</span>
                </div>
              ))
              : <div className="empty-note">Pas encore de vente sur cette période.</div>}
          </div>
        </section>
        <section className="panel">
          <h3>Alertes stock</h3>
          <div className="simple-list">
            {(dashboard.lowStockProducts || []).length
              ? dashboard.lowStockProducts.map((product) => (
                <button key={product.id} type="button" className="list-row alert-row" onClick={() => onOpenStock?.('')}>
                  <div>
                    <strong>{product.name}</strong>
                    <small>Reste {product.quantity} · seuil {product.threshold}</small>
                  </div>
                </button>
              ))
              : <div className="empty-note">Aucune alerte.</div>}
          </div>
        </section>
      </div>

      <div className="two-columns">
        <section className="panel">
          <div className="section-header">
            <h3>Rayons</h3>
            <button type="button" className="link-button" onClick={() => onNavigate?.('settings')}>Catégories</button>
          </div>
          <div className="simple-list">
            {(dashboard.familyStock || []).length
              ? dashboard.familyStock.map((row) => (
                <button key={row.family} type="button" className="list-row" onClick={() => onOpenStock?.(row.family)}>
                  <strong>{row.family}</strong>
                  <span>{row.stock} pcs</span>
                </button>
              ))
              : <div className="empty-note">Créez vos catégories dans Réglages, puis ajoutez des articles.</div>}
          </div>
        </section>
        <section className="panel">
          <div className="section-header">
            <h3>Derniers tickets</h3>
            <button type="button" className="link-button" onClick={() => onNavigate?.('history')}>Tout voir</button>
          </div>
          <div className="simple-list">
            {sales.length
              ? sales.slice(0, 6).map((sale) => (
                <div key={sale.id} className="list-row">
                  <div>
                    <strong>Ticket #{sale.id}</strong>
                    <small>{new Date(sale.sale_date).toLocaleString('fr-FR')}</small>
                  </div>
                  <span>{formatCurrency(sale.total_amount)}</span>
                </div>
              ))
              : <div className="empty-note">Aucun ticket.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
