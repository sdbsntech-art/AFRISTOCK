import { useEffect, useState } from 'react';
import apiRequest from '../api';
import { formatCurrency } from '../lib/format';

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const reportHtml = (report) => {
  const seller = report.seller || {};
  const analysis = report.analysis || {};
  const comments = (analysis.comments || []).map((item) => `<p>${item}</p>`).join('');
  const recos = (analysis.recommendations || []).map((item) => `<li>${item}</li>`).join('');
  const tops = (report.current?.topProducts || []).map((item) => `<tr><td>${item.name}</td><td>${item.category || ''}</td><td>${item.total_quantity}</td></tr>`).join('');
  const created = seller.created_at ? new Date(seller.created_at).toLocaleDateString('fr-FR') : '—';
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8" />
<title>Rapport ${report.monthLabel} — ${seller.shop_name || 'AfriStock'}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #122033; margin: 0; background: #e8eef7; }
  .sheet { max-width: 860px; margin: 24px auto; background: #fff; padding: 42px 48px; box-shadow: 0 18px 50px rgba(18,32,51,.12); }
  header { display:flex; justify-content:space-between; gap:20px; border-bottom:1px solid #d7deea; padding-bottom:18px; }
  img.logo { max-height: 72px; max-width: 140px; object-fit: contain; }
  h1 { font-size: 28px; margin: 0 0 6px; }
  .meta { color:#5b6b80; font-size: 14px; line-height:1.65; }
  .kpis { display:grid; grid-template-columns: repeat(4,1fr); gap:12px; margin: 28px 0; }
  .kpi { background:#f4f7fb; border:1px solid #e3eaf3; padding:14px; border-radius:14px; }
  .kpi span { display:block; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:#6a7b90; }
  .kpi strong { display:block; margin-top:8px; font-size:18px; }
  h2 { font-size:18px; margin: 28px 0 10px; }
  p, li { line-height:1.55; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:8px 6px; border-bottom:1px solid #e3eaf3; font-size:14px; }
  footer { margin-top:36px; border-top:1px solid #d7deea; padding-top:14px; font-size:12px; color:#6a7b90; }
  @media print { body { background:#fff; } .sheet { box-shadow:none; margin:0; } .no-print { display:none; } }
</style></head>
<body>
  <div class="sheet">
    <header>
      <div>
        <h1>Rapport mensuel vendeur</h1>
        <div class="meta">
          ${seller.shop_name || 'AfriStock'} · ${report.monthLabel}<br/>
          ${seller.first_name || ''} ${seller.last_name || ''}<br/>
          Identifiant : ${seller.username || '—'} · Email : ${seller.email || '—'}<br/>
          Téléphone : ${seller.phone || '—'} · Inscription : ${created}
        </div>
      </div>
      ${seller.logo ? `<img class="logo" src="${seller.logo}" alt="Logo" />` : ''}
    </header>
    <p><em>${analysis.headline || ''}</em></p>
    <div class="kpis">
      <div class="kpi"><span>Chiffre d'affaires</span><strong>${formatCurrency(analysis.kpis?.revenue)}</strong></div>
      <div class="kpi"><span>Marge</span><strong>${formatCurrency(analysis.kpis?.profit)}</strong></div>
      <div class="kpi"><span>Tickets</span><strong>${analysis.kpis?.tickets || 0}</strong></div>
      <div class="kpi"><span>Panier moyen</span><strong>${formatCurrency(analysis.kpis?.avgTicket)}</strong></div>
    </div>
    <h2>Commentaire automatique</h2>
    ${comments}
    <h2>Recommandations</h2>
    <ul>${recos}</ul>
    ${tops ? `<h2>Meilleures références</h2><table><thead><tr><th>Produit</th><th>Catégorie</th><th>Qté</th></tr></thead><tbody>${tops}</tbody></table>` : ''}
    <footer>Émis par ${seller.shop_name || 'AfriStock'} pour ${seller.first_name || ''} ${seller.last_name || ''} · ${new Date().toLocaleString('fr-FR')}</footer>
  </div>
</body></html>`;
};

const downloadReport = (report) => {
  const html = reportHtml(report);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Rapport-${(report.seller?.shop_name || 'AfriStock').replace(/\s+/g, '_')}-${report.month}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  const popup = window.open('', '_blank');
  if (!popup) return;
  popup.document.write(`${html}<script>window.onload = () => window.print();<\/script>`);
  popup.document.close();
};

export default function ReportPage({ onToast }) {
  const [month, setMonth] = useState(currentMonth());
  const [report, setReport] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiRequest(`/reports/monthly?month=${month}`);
        setReport(data);
      } catch (error) {
        onToast({ type: 'error', message: error.message });
      }
    };
    load();
  }, [month, onToast]);

  if (!report) return <div className="panel">Préparation du rapport...</div>;

  const seller = report.seller || {};
  const kpis = report.analysis?.kpis || {};
  const created = seller.created_at ? new Date(seller.created_at).toLocaleDateString('fr-FR') : '—';

  return (
    <div className="report-page">
      <div className="page-topbar">
        <div>
          <p className="page-kicker">Pilotage boutique</p>
          <h2>Rapport mensuel</h2>
        </div>
        <div className="segment-control">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button type="button" className="primary-button" onClick={() => downloadReport(report)}>Télécharger / imprimer</button>
        </div>
      </div>

      <section className="panel report-identity">
        {seller.logo ? <img className="shop-logo" src={seller.logo} alt={seller.shop_name} /> : <div className="brand-mark">A</div>}
        <div>
          <strong>{seller.shop_name || 'AfriStock'}</strong>
          <p>{seller.first_name} {seller.last_name}</p>
          <small>{seller.username} · {seller.email} · {seller.phone || 'Tél. non renseigné'} · inscrit le {created}</small>
        </div>
      </section>

      <div className="stats-grid">
        <div className="stat-card primary"><span>CA du mois</span><strong>{formatCurrency(kpis.revenue)}</strong></div>
        <div className="stat-card green"><span>Marge</span><strong>{formatCurrency(kpis.profit)}</strong></div>
        <div className="stat-card blue"><span>Tickets</span><strong>{kpis.tickets || 0}</strong></div>
        <div className="stat-card orange"><span>Panier moyen</span><strong>{formatCurrency(kpis.avgTicket)}</strong></div>
      </div>

      <section className="panel">
        <h3>Analyse automatique</h3>
        <p className="analysis-headline">{report.analysis?.headline}</p>
        <div className="analysis-list">
          {(report.analysis?.comments || []).map((item) => <p key={item}>{item}</p>)}
        </div>
      </section>

      <section className="panel">
        <h3>Recommandations</h3>
        <div className="simple-list">
          {(report.analysis?.recommendations || []).map((item) => (
            <div key={item} className="list-row"><span>{item}</span></div>
          ))}
        </div>
      </section>

      {(report.current?.topProducts || []).length > 0 && (
        <section className="panel">
          <h3>Meilleures références du mois</h3>
          <div className="simple-list">
            {report.current.topProducts.map((item) => (
              <div key={item.name} className="list-row">
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.category}</small>
                </div>
                <span>{item.total_quantity} vendu(s)</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
