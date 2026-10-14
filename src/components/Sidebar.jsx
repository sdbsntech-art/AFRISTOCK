export default function Sidebar({ currentPage, onNavigate, user, onLogout }) {
  const menuItems = [
    { key: 'dashboard', label: 'Tableau de bord' },
    { key: 'catalog', label: 'Rayons' },
    { key: 'products', label: 'Stock' },
    { key: 'sale', label: 'Caisse' },
    { key: 'history', label: 'Ventes' },
    { key: 'report', label: 'Rapport mensuel' },
    { key: 'stats', label: 'Statistiques' },
    { key: 'settings', label: 'Paramètres' },
  ];
  const shop = user?.shop_name || 'AfriStock';

  return (
    <aside className="sidebar">
      <div className="brand-block">
        {user?.logo ? <img className="brand-logo small" src={user.logo} alt={shop} /> : <div className="brand-mark">A</div>}
        <div>
          <strong>{shop}</strong>
          <small>Logiciel vendeur</small>
        </div>
      </div>

      <nav className="side-nav">
        {menuItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={currentPage === item.key ? 'nav-item active' : 'nav-item'}
            onClick={() => onNavigate(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="user-card">
        <div className="user-card-title">Compte interne</div>
        <div className="user-name">{[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.name || 'Vendeur'}</div>
        <small>{user?.email}</small>
        <button type="button" className="logout-button" onClick={onLogout}>Quitter la session</button>
      </div>
    </aside>
  );
}
