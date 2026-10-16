import { useEffect, useState } from 'react';
import apiRequest from './api';
import Notification from './components/Notification';
import Sidebar from './components/Sidebar';
import MustChangePasswordModal from './components/MustChangePasswordModal';
import InstallAppButton from './components/InstallAppButton';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import CatalogPage from './pages/CatalogPage';
import ProductsPage from './pages/ProductsPage';
import NewSalePage from './pages/NewSalePage';
import SalesHistoryPage from './pages/SalesHistoryPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import ReportPage from './pages/ReportPage';
import AdminUsersPage from './pages/AdminUsersPage';

function App() {
  const [page, setPage] = useState('dashboard');
  const [user, setUser] = useState(null);
  const [toast, setToast] = useState(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [catalogFamily, setCatalogFamily] = useState('');

  useEffect(() => {
    const verifySession = async () => {
      try {
        const data = await apiRequest('/session');
        setUser(data.user);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    verifySession();
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleLogin = async (identifier, password) => {
    const data = await apiRequest('/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
    setUser(data.user);
    setPage(data.user?.role === 'admin' ? 'admin-users' : 'dashboard');
    setToast({
      type: 'success',
      message: data.user?.role === 'admin' ? 'Session Administrateur ouverte.' : 'Connexion réussie.',
    });
  };

  const handleSignup = async (payload) => {
    const data = await apiRequest('/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setUser(data.user);
    setPage(data.user?.role === 'admin' ? 'admin-users' : 'dashboard');
    setToast({ type: 'success', message: data.user?.role === 'admin' ? 'Compte propriétaire créé.' : 'Compte vendeur créé.' });
  };

  const handleGoogle = async (credential) => {
    const data = await apiRequest('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    });
    setUser(data.user);
    setPage('dashboard');
    setToast({ type: 'success', message: 'Connexion Google réussie.' });
  };

  const handleLogout = async () => {
    await apiRequest('/logout', { method: 'POST' });
    setUser(null);
    setPage('dashboard');
  };

  const openStock = (family = '') => {
    setCatalogFamily(family);
    setPage('products');
  };

  const renderPage = () => {
    switch (page) {
      case 'admin-users':
        return <AdminUsersPage onToast={setToast} onOpenSellerProducts={openStock} />;
      case 'catalog':
        return <CatalogPage onOpenFamily={openStock} onManageCategories={() => setPage('settings')} />;
      case 'products':
        return <ProductsPage onToast={setToast} globalSearch={globalSearch} initialFamily={catalogFamily} user={user} />;
      case 'sale':
        return <NewSalePage onToast={setToast} globalSearch={globalSearch} />;
      case 'history':
        return <SalesHistoryPage onToast={setToast} globalSearch={globalSearch} />;
      case 'report':
        return <ReportPage onToast={setToast} />;
      case 'stats':
        return <StatsPage />;
      case 'settings':
        return <SettingsPage onToast={setToast} user={user} onUserUpdate={setUser} />;
      default:
        return <DashboardPage onToast={setToast} onOpenStock={openStock} />;
    }
  };

  if (loading) {
    return <div className="loading-screen">Connexion au système AfriStock...</div>;
  }

  if (!user) {
    return (
      <>
        <Notification toast={toast} />
        <LoginPage onLogin={handleLogin} onSignup={handleSignup} onGoogle={handleGoogle} />
      </>
    );
  }

  const sellerLabel = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.name || 'Utilisateur';
  const shopLabel = user.shop_name || 'AfriStock';
  const isAdmin = user.role === 'admin';

  return (
    <div className="app-shell">
      <Sidebar currentPage={page} onNavigate={setPage} user={user} onLogout={handleLogout} />
      <main className="main-panel">
        <header className="topbar">
          <div className="search-box">
            <span>🔎</span>
            <input
              type="text"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Référence, modèle, iPhone 13, connecteur USB-C..."
            />
          </div>
          <div className="topbar-user">
            {user.logo ? (
              <img className="avatar-image" src={user.logo} alt={shopLabel} />
            ) : (
              <div className={`avatar ${isAdmin ? 'admin-avatar' : ''}`}>
                {isAdmin ? '👑' : sellerLabel.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <strong>
                {sellerLabel} {isAdmin && <span className="topbar-role-tag">ADMIN</span>}
              </strong>
              <small>{shopLabel}</small>
            </div>
          </div>
          <InstallAppButton />
        </header>

        <div className="page-content">{renderPage()}</div>

        <footer className="app-footer">
          <span>{sellerLabel} ({isAdmin ? 'Console Admin' : 'Vendeur'})</span>
          <span>{shopLabel}</span>
          {user.phone ? <span>{user.phone}</span> : null}
          <span className="mysql-badge">Base MySQL Laragon (afristock)</span>
        </footer>
      </main>

      <Notification toast={toast} />

      {/* Forcer le changement de mot de passe si réinitialisé par admin */}
      {user.must_change_password && (
        <MustChangePasswordModal
          user={user}
          onPasswordChanged={(updatedUser) => setUser(updatedUser)}
          onToast={setToast}
        />
      )}
    </div>
  );
}

export default App;
