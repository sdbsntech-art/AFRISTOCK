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
      <div>
        <p className="page-kicker">Comptabilité caisse</p>
        <h2>Historique des tickets</h2>
      </div>

      <div className="stats-grid">
        <div className="stat-card primary"><span>Encaissé</span><strong>{formatCurrency(totalVendu)}</strong></div>
        <div className="stat-card blue"><span>Articles</span><strong>{totalArticles}</strong></div>
        <div className="stat-card green"><span>Marge</span><strong>{formatCurrency(totalProfit)}</strong></div>
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
          <input type="text" value={productFilter} onChange={(e) => setProductFilter(e.target.value)} placeholder="Produit vendu" />
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
        </div>
      </div>

      <div className="panel table-panel">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Lignes</th>
                <th>Qté</th>
                <th>Prix</th>
                <th>Total</th>
                <th>Marge</th>
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 ? (
                <tr><td colSpan="6">Aucun ticket.</td></tr>
              ) : sales.map((sale) => (
                <tr key={sale.id}>
                  <td>
                    #{sale.id}
                    <small>{new Date(sale.sale_date).toLocaleString('fr-FR')}</small>
                  </td>
                  <td>{sale.items?.map((item) => <div key={`${sale.id}-${item.product_id}`}>{item.product_name}</div>)}</td>
                  <td>{sale.items?.map((item) => <div key={`${sale.id}-${item.product_id}-q`}>{item.quantity}</div>)}</td>
                  <td>{sale.items?.map((item) => <div key={`${sale.id}-${item.product_id}-p`}>{formatCurrency(item.unit_price)}</div>)}</td>
                  <td>{formatCurrency(sale.total_amount)}</td>
                  <td>{formatCurrency(sale.total_profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
