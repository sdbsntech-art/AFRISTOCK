import { useEffect, useState } from 'react';
import apiRequest from './api';
import Notification from './components/Notification';
import Sidebar from './components/Sidebar';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import CatalogPage from './pages/CatalogPage';
import ProductsPage from './pages/ProductsPage';
import NewSalePage from './pages/NewSalePage';
import SalesHistoryPage from './pages/SalesHistoryPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import ReportPage from './pages/ReportPage';

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
    setPage('dashboard');
    setToast({ type: 'success', message: 'Connexion vendeur réussie.' });
  };

  const handleSignup = async (payload) => {
    const data = await apiRequest('/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setUser(data.user);
    setPage('dashboard');
    setToast({ type: 'success', message: 'Compte vendeur créé.' });
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
      case 'catalog':
        return <CatalogPage onOpenFamily={openStock} />;
      case 'products':
        return <ProductsPage onToast={setToast} globalSearch={globalSearch} initialFamily={catalogFamily} />;
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
    return <div className="loading-screen">Ouverture du logiciel vendeur...</div>;
  }

  if (!user) {
    return (
      <>
        <Notification toast={toast} />
        <LoginPage onLogin={handleLogin} onSignup={handleSignup} onGoogle={handleGoogle} />
      </>
    );
  }

  const sellerLabel = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.name || 'Vendeur';
  const shopLabel = user.shop_name || 'AfriStock';

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
            {user.logo ? <img className="avatar-image" src={user.logo} alt={shopLabel} /> : <div className="avatar">{sellerLabel.charAt(0).toUpperCase()}</div>}
            <div>
              <strong>{sellerLabel}</strong>
              <small>{shopLabel}</small>
            </div>
          </div>
        </header>
        <div className="page-content">{renderPage()}</div>
        <footer className="app-footer">
          <span>{sellerLabel}</span>
          <span>{shopLabel}</span>
          {user.phone ? <span>{user.phone}</span> : null}
        </footer>
      </main>
      <Notification toast={toast} />
    </div>
  );
}

export default App;
