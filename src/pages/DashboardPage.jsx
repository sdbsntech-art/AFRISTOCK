import { useEffect, useMemo, useState } from 'react';
import apiRequest from '../api';
import { FAMILY_LABELS, formatCurrency } from '../lib/format';

export default function DashboardPage({ onToast, onOpenStock }) {
  const [range, setRange] = useState('today');
  const [dashboard, setDashboard] = useState(null);
  const [sales, setSales] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [data, salesData] = await Promise.all([
          apiRequest('/dashboard'),
          apiRequest(`/sales?range=${range}`),
        ]);
        setDashboard(data);
        setSales(salesData);
      } catch (error) {
        onToast({ type: 'error', message: error.message });
      }
    };
    load();
  }, [range, onToast]);

  const salesLineData = useMemo(() => {
    const trend = dashboard?.salesTrend || [];
    const maxValue = Math.max(...trend.map((item) => Number(item.total_amount || 0)), 1);
    return trend.map((item) => ({
      ...item,
      height: (Number(item.total_amount || 0) / maxValue) * 100,
    }));
  }, [dashboard]);

  if (!dashboard) {
    return <div className="panel">Chargement du tableau de bord...</div>;
  }

  return (
    <div className="dashboard-page">
      <div>
        <p className="page-kicker">Activité boutique</p>
        <h2>Tableau de bord vendeur</h2>
      </div>

      <div className="stats-grid">
        <div className="stat-card primary">
          <span>Ventes du jour</span>
          <strong>{formatCurrency(dashboard.todaySales?.total_amount || 0)}</strong>
          <small>Caisse aujourd'hui</small>
        </div>
        <div className="stat-card blue">
          <span>Articles sortis</span>
          <strong>{dashboard.todaySales?.items_count || 0}</strong>
          <small>Pièces et accessoires</small>
        </div>
        <div className="stat-card green">
          <span>Pièces en stock</span>
          <strong>{dashboard.totalStock?.total || 0}</strong>
          <small>{dashboard.totalProducts?.total || 0} références</small>
        </div>
        <div className="stat-card orange">
          <span>Marge stock</span>
          <strong>{formatCurrency(dashboard.estimatedProfit || 0)}</strong>
          <small>Si tout le stock se vend</small>
        </div>
      </div>

      <section className="panel">
        <div className="section-header">
          <h3>Caisse</h3>
          <div className="segment-control">
            {['today', 'yesterday', 'week', 'month'].map((value) => (
              <button key={value} type="button" className={range === value ? 'segment active' : 'segment'} onClick={() => setRange(value)}>
                {value === 'today' ? "Aujourd'hui" : value === 'yesterday' ? 'Hier' : value === 'week' ? 'Semaine' : 'Mois'}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-box">
          {salesLineData.some((item) => Number(item.total_amount || 0) > 0)
            ? salesLineData.map((item, index) => (
              <div key={`${item.day}-${index}`} className="bar-group">
                <div className="bar" style={{ height: `${item.height}%` }} title={formatCurrency(item.total_amount)} />
                <span>{item.day}</span>
              </div>
            ))
            : <div className="empty-note">Pas encore de vente sur cette période.</div>}
        </div>
      </section>

      <div className="two-columns">
        <section className="panel">
          <h3>Rayons</h3>
          <div className="simple-list">
            {(dashboard.familyStock || []).map((row) => (
              <button key={row.family} type="button" className="list-row" onClick={() => onOpenStock?.(row.family)}>
                <strong>{FAMILY_LABELS[row.family] || row.family}</strong>
                <span>{row.stock} pcs</span>
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <h3>Alertes stock</h3>
          <div className="simple-list">
            {(dashboard.lowStockProducts || []).length
              ? dashboard.lowStockProducts.map((product) => (
                <div key={product.id} className="list-row alert-row">
                  <div>
                    <strong>{product.name}</strong>
                    <small>Reste {product.quantity} · seuil {product.threshold}</small>
                  </div>
                </div>
              ))
              : <div className="empty-note">Aucune alerte.</div>}
          </div>
        </section>
      </div>

      <section className="panel">
        <h3>Derniers tickets</h3>
        <div className="simple-list">
          {sales.length
            ? sales.slice(0, 6).map((sale) => (
              <div key={sale.id} className="list-row">
                <div>
                  <strong>Ticket #{sale.id}</strong>
                  <small>{new Date(sale.sale_date).toLocaleString('fr-FR')} · {sale.items_count} article(s)</small>
                </div>
                <span>{formatCurrency(sale.total_amount)}</span>
              </div>
            ))
            : <div className="empty-note">Aucun ticket.</div>}
        </div>
      </section>
    </div>
  );
}
