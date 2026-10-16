import { useEffect, useState } from 'react';
import apiRequest from '../api';
import { formatCurrency } from '../lib/format';

export default function SalesHistoryPage({ onToast, globalSearch }) {
  const [sales, setSales] = useState([]);
  const [range, setRange] = useState('all');
  const [productFilter, setProductFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  useEffect(() => {
    const loadSales = async () => {
      try {
        const params = new URLSearchParams();
        if (range !== 'all') params.set('range', range);
        if (productFilter || globalSearch) params.set('product', productFilter || globalSearch);
        if (dateFilter) params.set('date', dateFilter);
        const data = await apiRequest(`/sales?${params.toString()}`);
        setSales(data);
      } catch (error) {
        onToast({ type: 'error', message: error.message });
      }
    };
    loadSales();
  }, [range, productFilter, dateFilter, globalSearch, onToast]);

  const totalVendu = sales.reduce((sum, sale) => sum + Number(sale.total_amount || 0), 0);
  const totalArticles = sales.reduce((sum, sale) => sum + Number(sale.items_count || 0), 0);
  const totalProfit = sales.reduce((sum, sale) => sum + Number(sale.total_profit || 0), 0);

  return (
    <div className="history-page">
      <div className="page-header">
        <div>
          <p className="page-kicker">Historique</p>
          <h2>Ventes</h2>
        </div>
      </div>

      <div className="stats-grid three">
        <div className="stat-card primary"><span>Encaissé</span><strong>{formatCurrency(totalVendu)}</strong></div>
        <div className="stat-card"><span>Articles</span><strong>{totalArticles}</strong></div>
        <div className="stat-card"><span>Marge</span><strong>{formatCurrency(totalProfit)}</strong></div>
      </div>

      <div className="panel filters-panel">
        <div className="form-grid compact-grid">
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="all">Tous les tickets</option>
            <option value="today">Aujourd'hui</option>
            <option value="yesterday">Hier</option>
            <option value="week">Cette semaine</option>
            <option value="month">Ce mois</option>
          </select>
          <input type="search" value={productFilter} onChange={(e) => setProductFilter(e.target.value)} placeholder="Produit vendu" />
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
        </div>
      </div>

      <div className="ticket-list">
        {sales.length === 0 ? (
          <div className="empty-note panel">Aucun ticket.</div>
        ) : sales.map((sale) => (
          <article key={sale.id} className="panel ticket-card">
            <div className="ticket-head">
              <div>
                <strong>Ticket #{sale.id}</strong>
                <small>{new Date(sale.sale_date).toLocaleString('fr-FR')}</small>
              </div>
              <strong>{formatCurrency(sale.total_amount)}</strong>
            </div>
            <ul className="ticket-lines">
              {(sale.items || []).map((item) => (
                <li key={`${sale.id}-${item.product_id}`}>
                  <span>{item.product_name} × {item.quantity}</span>
                  <span>{formatCurrency(item.subtotal)}</span>
                </li>
              ))}
            </ul>
            <div className="ticket-meta">
              {sale.customer_name ? <span>Client : {sale.customer_name}</span> : null}
              <span>Marge {formatCurrency(sale.total_profit)}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
