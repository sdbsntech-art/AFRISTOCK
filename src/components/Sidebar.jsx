export default function Sidebar({ currentPage, onNavigate, user, onLogout }) {
  const isAdmin = user?.role === 'admin';

  const menuItems = [
    { key: 'dashboard', label: 'Accueil' },
    { key: 'products', label: 'Stock' },
    { key: 'sale', label: 'Caisse' },
    { key: 'history', label: 'Ventes' },
    { key: 'report', label: 'Rapport' },
    ...(isAdmin ? [{ key: 'admin-users', label: 'Équipe' }] : []),
    { key: 'settings', label: 'Réglages' },
  ];

  const shop = user?.shop_name || 'AfriStock';
  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.name || 'Utilisateur';

  return (
    <aside className="sidebar">
      <div className="brand-block">
        {user?.logo ? (
          <img className="brand-logo small" src={user.logo} alt="" />
        ) : (
          <div className="brand-mark">A</div>
        )}
        <div>
          <strong>{shop}</strong>
          <small>Stock local</small>
        </div>
      </div>

      <nav className="side-nav">
        {menuItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`nav-item ${currentPage === item.key ? 'active' : ''}`}
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
            {isAdmin ? 'Admin' : 'Vendeur'}
          </span>
        </div>
        <div className="user-name">{displayName}</div>
        <small className="user-email">{user?.email}</small>
        <button type="button" className="logout-button" onClick={onLogout}>
          Déconnexion
        </button>
      </div>
    </aside>
  );
}
