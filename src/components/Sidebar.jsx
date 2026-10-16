export default function Sidebar({ currentPage, onNavigate, user, onLogout }) {
  const isAdmin = user?.role === 'admin';

  const menuItems = [
    { key: 'dashboard', label: '📊 Tableau de bord' },
    ...(isAdmin ? [{ key: 'admin-users', label: '👑 Utilisateurs & Boutiques', highlight: true }] : []),
    { key: 'catalog', label: '🗂️ Rayons' },
    { key: 'products', label: '📦 Stock Produits' },
    { key: 'sale', label: '💳 Caisse' },
    { key: 'history', label: '🧾 Historique Ventes' },
    { key: 'report', label: '📈 Rapport mensuel' },
    { key: 'stats', label: '📉 Statistiques' },
    { key: 'settings', label: '⚙️ Paramètres' },
  ];

  const shop = user?.shop_name || 'AfriStock';
  const roleLabel = isAdmin ? 'Super Administrateur' : 'Compte Vendeur';

  return (
    <aside className="sidebar">
      <div className="brand-block">
        {user?.logo ? (
          <img className="brand-logo small" src={user.logo} alt={shop} />
        ) : (
          <div className="brand-mark">{isAdmin ? '👑' : 'A'}</div>
        )}
        <div>
          <strong>{shop}</strong>
          <small>{isAdmin ? 'Console AfriStock' : 'Logiciel Vendeur'}</small>
        </div>
      </div>

      <nav className="side-nav">
        {menuItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`nav-item ${currentPage === item.key ? 'active' : ''} ${item.highlight ? 'admin-highlight' : ''}`}
            onClick={() => onNavigate(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="user-card">
        <div className="user-card-header">
          <div className="user-card-title">Connecté</div>
          <span className={`role-badge ${isAdmin ? 'admin' : 'seller'}`}>
            {isAdmin ? 'ADMIN' : 'VENDEUR'}
          </span>
        </div>
        <div className="user-name">
          {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.name || 'Utilisateur'}
        </div>
        <small className="user-email">{user?.email}</small>
        <button type="button" className="logout-button" onClick={onLogout}>
          Quitter la session
        </button>
      </div>
    </aside>
  );
}
