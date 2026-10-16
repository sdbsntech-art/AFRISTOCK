import { useEffect, useState, useMemo } from 'react';
import apiRequest from '../api';
import { formatCurrency } from '../lib/format';

export default function AdminUsersPage({ onToast, onOpenSellerProducts }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('users'); // 'users' | 'activity'
  const [activityLogs, setActivityLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Modal création/édition utilisateur
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({
    first_name: '',
    last_name: '',
    username: '',
    email: '',
    phone: '',
    shop_name: '',
    role: 'seller',
    password: '',
    autoPassword: true,
  });

  // Modal mot de passe réinitialisé
  const [resetModalData, setResetModalData] = useState(null);

  // Modal visualisation des produits d'un vendeur
  const [sellerProductsModal, setSellerProductsModal] = useState(null);
  const [sellerProducts, setSellerProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await apiRequest('/admin/users');
      setUsers(data);
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  };

  const loadActivityLogs = async () => {
    try {
      setLoadingLogs(true);
      const data = await apiRequest('/admin/activity-logs');
      setActivityLogs(data);
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    loadUsers();
    loadActivityLogs();
    const interval = setInterval(loadActivityLogs, 10000); // Rafraîchissement direct toutes les 10s
    return () => clearInterval(interval);
  }, []);

  // Statistiques globales de la plateforme
  const platformStats = useMemo(() => {
    return users.reduce(
      (acc, u) => {
        acc.totalUsers += 1;
        if (u.role === 'seller') acc.totalSellers += 1;
        acc.totalProducts += Number(u.product_count || 0);
        acc.totalStockUnits += Number(u.total_stock_units || 0);
        acc.totalInventoryCost += Number(u.total_inventory_cost || 0);
        acc.totalInventoryValue += Number(u.total_inventory_value || 0);
        acc.totalRevenue += Number(u.total_sales_revenue || 0);
        acc.totalProfit += Number(u.total_sales_profit || 0);
        return acc;
      },
      {
        totalUsers: 0,
        totalSellers: 0,
        totalProducts: 0,
        totalStockUnits: 0,
        totalInventoryCost: 0,
        totalInventoryValue: 0,
        totalRevenue: 0,
        totalProfit: 0,
      },
    );
  }, [users]);

  // Utilisateurs filtrés
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const q = search.toLowerCase().trim();
      const matchSearch =
        !q ||
        (u.name && u.name.toLowerCase().includes(q)) ||
        (u.username && u.username.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.shop_name && u.shop_name.toLowerCase().includes(q)) ||
        (u.phone && u.phone.includes(q));

      const matchRole = roleFilter === 'all' || u.role === roleFilter;
      const matchStatus = statusFilter === 'all' || u.status === statusFilter;

      return matchSearch && matchRole && matchStatus;
    });
  }, [users, search, roleFilter, statusFilter]);

  // Ouvrir modal de création
  const handleOpenCreate = () => {
    setEditingUser(null);
    setUserForm({
      first_name: '',
      last_name: '',
      username: '',
      email: '',
      phone: '',
      shop_name: '',
      role: 'seller',
      password: '',
      autoPassword: true,
    });
    setShowUserModal(true);
  };

  // Ouvrir modal d'édition
  const handleOpenEdit = (user) => {
    setEditingUser(user);
    setUserForm({
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      username: user.username || '',
      email: user.email || '',
      phone: user.phone || '',
      shop_name: user.shop_name || '',
      role: user.role || 'seller',
      status: user.status || 'active',
      password: '',
      autoPassword: false,
    });
    setShowUserModal(true);
  };

  // Sauvegarder utilisateur (création ou mise à jour)
  const handleSaveUser = async (e) => {
    e.preventDefault();
    try {
      if (editingUser) {
        await apiRequest(`/admin/users/${editingUser.id}`, {
          method: 'PUT',
          body: JSON.stringify(userForm),
        });
        onToast({ type: 'success', message: 'Utilisateur mis à jour avec succès.' });
      } else {
        const payload = { ...userForm };
        if (userForm.autoPassword) {
          delete payload.password;
        }
        const res = await apiRequest('/admin/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast({ type: 'success', message: 'Compte créé avec succès.' });
        if (res.temporaryPassword) {
          setResetModalData({
            username: res.user.username,
            name: res.user.name,
            temporaryPassword: res.temporaryPassword,
            isNewAccount: true,
          });
        }
      }
      setShowUserModal(false);
      loadUsers();
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  // Réinitialisation automatique du mot de passe
  const handleAutoResetPassword = async (user) => {
    if (!window.confirm(`Réinitialiser automatiquement le mot de passe de ${user.name} (@${user.username}) ?`)) {
      return;
    }

    try {
      const res = await apiRequest(`/admin/users/${user.id}/reset-password`, {
        method: 'POST',
      });
      setResetModalData({
        username: user.username,
        name: user.name,
        temporaryPassword: res.temporaryPassword,
        isNewAccount: false,
      });
      loadUsers();
      onToast({ type: 'success', message: 'Mot de passe réinitialisé automatiquement.' });
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  // Activer / désactiver un compte
  const handleToggleStatus = async (user) => {
    const nextStatus = user.status === 'active' ? 'inactive' : 'active';
    try {
      await apiRequest(`/admin/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus }),
      });
      onToast({
        type: 'success',
        message: nextStatus === 'active' ? 'Compte activé.' : 'Compte désactivé.',
      });
      loadUsers();
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  // Supprimer un utilisateur
  const handleDeleteUser = async (user) => {
    if (!window.confirm(`ATTENTION : Supprimer définitivement le compte de ${user.name} ainsi que tous ses produits et ventes associés ?`)) {
      return;
    }
    try {
      await apiRequest(`/admin/users/${user.id}`, { method: 'DELETE' });
      onToast({ type: 'success', message: 'Compte utilisateur supprimé.' });
      loadUsers();
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  // Voir les produits d'un vendeur spécifique
  const handleViewProducts = async (user) => {
    setSellerProductsModal(user);
    setLoadingProducts(true);
    setProductSearch('');
    try {
      const products = await apiRequest(`/admin/users/${user.id}/products`);
      setSellerProducts(products);
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    } finally {
      setLoadingProducts(false);
    }
  };

  // Filtrer les produits du modal vendeur
  const filteredSellerProducts = useMemo(() => {
    if (!productSearch) return sellerProducts;
    const q = productSearch.toLowerCase();
    return sellerProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.model.toLowerCase().includes(q) ||
        (p.reference && p.reference.toLowerCase().includes(q)),
    );
  }, [sellerProducts, productSearch]);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    onToast({ type: 'success', message: 'Mot de passe copié dans le presse-papiers !' });
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <p className="page-kicker">Administration</p>
          <h2>Gestion des Utilisateurs & Boutiques</h2>
          <p className="page-subtitle">
            Supervisez tous les vendeurs, consultez le stock spécifique de chaque boutique et gérez les accès de façon sécurisée (Scrypt).
          </p>
        </div>
        <button type="button" className="primary-button" onClick={handleOpenCreate}>
          ➕ Ajouter un utilisateur
        </button>
      </div>

      {/* Cartes KPI Globales */}
      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-label">Comptes Vendeurs</span>
          <strong className="metric-value">{platformStats.totalSellers} boutiques</strong>
          <small className="metric-hint">Sur {platformStats.totalUsers} comptes au total</small>
        </div>
        <div className="metric-card">
          <span className="metric-label">Références en Stock</span>
          <strong className="metric-value">{platformStats.totalProducts} articles</strong>
          <small className="metric-hint">{platformStats.totalStockUnits.toLocaleString()} pièces disponibles</small>
        </div>
        <div className="metric-card">
          <span className="metric-label">Valeur Vente du Stock</span>
          <strong className="metric-value">{formatCurrency(platformStats.totalInventoryValue)}</strong>
          <small className="metric-hint">Coût d’achat : {formatCurrency(platformStats.totalInventoryCost)}</small>
        </div>
        <div className="metric-card">
          <span className="metric-label">Ventes Cumulées</span>
          <strong className="metric-value highlight">{formatCurrency(platformStats.totalRevenue)}</strong>
          <small className="metric-hint">Marge brute : {formatCurrency(platformStats.totalProfit)}</small>
        </div>
      </div>

      {/* Sélecteur d'onglets Admin & Statut enregistrement direct */}
      <div className="admin-subtabs-bar">
        <div className="subtabs-buttons">
          <button
            type="button"
            className={`subtab-btn ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            👥 Boutiques & Vendeurs ({users.length})
          </button>
          <button
            type="button"
            className={`subtab-btn ${activeTab === 'activity' ? 'active' : ''}`}
            onClick={() => { setActiveTab('activity'); loadActivityLogs(); }}
          >
            Journal d’activité ({activityLogs.length})
          </button>
        </div>
        <div className="live-persistence-indicator">
          <span className="live-dot">●</span> Enregistrement local instantané
        </div>
      </div>

      {activeTab === 'users' ? (
        <>
          {/* Barre de filtres */}
          <div className="panel filter-bar-panel">
            <div className="filter-group">
              <div className="search-input-wrapper">
                <span>🔎</span>
                <input
                  type="text"
                  placeholder="Rechercher par nom, boutique, identifiant, téléphone..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                <option value="all">Tous les rôles</option>
                <option value="seller">Vendeurs uniquement</option>
                <option value="admin">Administrateurs uniquement</option>
              </select>

              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">Tous les statuts</option>
                <option value="active">Actifs uniquement</option>
                <option value="inactive">Inactifs / Suspendus</option>
              </select>
            </div>
          </div>

          {/* Table des utilisateurs */}
          <div className="panel table-panel">
            {loading ? (
              <div className="table-loading">Chargement des utilisateurs…</div>
            ) : filteredUsers.length === 0 ? (
              <div className="empty-state">Aucun utilisateur ne correspond à vos filtres.</div>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Vendeur / Utilisateur</th>
                      <th>Boutique</th>
                      <th>Rôle</th>
                      <th>Statut</th>
                      <th>Stock Actuel</th>
                      <th>Valeur Stock</th>
                      <th>Ventes Réalisées</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <div className="user-cell">
                            <strong>{u.name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Utilisateur'}</strong>
                            <div className="user-meta">
                              <span>@{u.username}</span> • <span>{u.email}</span>
                              {u.phone ? <span> • {u.phone}</span> : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="shop-badge">🏪 {u.shop_name || 'AfriStock'}</span>
                        </td>
                        <td>
                          <span className={`role-tag ${u.role}`}>
                            {u.role === 'admin' ? '👑 Admin' : '🛍️ Vendeur'}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className={`status-pill ${u.status === 'active' ? 'active' : 'inactive'}`}
                            onClick={() => handleToggleStatus(u)}
                            title="Cliquez pour changer le statut"
                          >
                            {u.status === 'active' ? '● Actif' : '○ Inactif'}
                          </button>
                        </td>
                        <td>
                          <div className="stock-cell">
                            <strong>{u.product_count || 0} réf.</strong>
                            <small>({u.total_stock_units || 0} pièces)</small>
                          </div>
                        </td>
                        <td>
                          <strong>{formatCurrency(u.total_inventory_value || 0)}</strong>
                        </td>
                        <td>
                          <div className="sales-cell">
                            <strong>{formatCurrency(u.total_sales_revenue || 0)}</strong>
                            <small>Marge : {formatCurrency(u.total_sales_profit || 0)}</small>
                          </div>
                        </td>
                        <td>
                          <div className="action-buttons-group">
                            <button
                              type="button"
                              className="action-btn view-btn"
                              onClick={() => handleViewProducts(u)}
                              title="Voir tous les produits que vend cet utilisateur"
                            >
                              📦 Produits ({u.product_count || 0})
                            </button>

                            <button
                              type="button"
                              className="action-btn key-btn"
                              onClick={() => handleAutoResetPassword(u)}
                              title="Réinitialiser automatiquement le mot de passe (générateur sécurisé)"
                            >
                              🔑 Auto-MDP
                            </button>

                            <button
                              type="button"
                              className="action-btn edit-btn"
                              onClick={() => handleOpenEdit(u)}
                              title="Modifier les coordonnées"
                            >
                              ✏️
                            </button>

                            <button
                              type="button"
                              className="action-btn delete-btn"
                              onClick={() => handleDeleteUser(u)}
                              title="Supprimer définitivement"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        /* ONGLET : JOURNAL DES MODIFICATIONS EN DIRECT (TEMPS RÉEL DANS MYSQL) */
        <div className="panel table-panel">
          <div className="activity-panel-top">
            <div>
              <h3>Journal des modifications enregistrées en direct</h3>
              <p className="modal-subtitle">
                Chaque ajout, vente, modification de prix, stock ou mot de passe est enregistré tout de suite dans la base locale.
              </p>
            </div>
            <button
              type="button"
              className="action-btn key-btn"
              onClick={loadActivityLogs}
              disabled={loadingLogs}
            >
              {loadingLogs ? 'Actualisation...' : '🔄 Actualiser le journal'}
            </button>
          </div>

          {activityLogs.length === 0 ? (
            <div className="empty-state">Aucune modification enregistrée pour l'instant.</div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date & Heure</th>
                    <th>Auteur</th>
                    <th>Boutique</th>
                    <th>Action</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {activityLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="time-cell">
                        {new Date(log.created_at).toLocaleString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td>
                        <strong>{log.user_name || 'Système'}</strong>
                      </td>
                      <td>
                        <span className="shop-badge small">
                          {log.shop_name || 'AfriStock'}
                        </span>
                      </td>
                      <td>
                        <span className="action-pill">
                          {log.action}
                        </span>
                      </td>
                      <td className="log-description-cell">
                        {log.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODAL : VISUALISATION DES PRODUITS DU VENDEUR */}
      {sellerProductsModal && (
        <div className="modal-backdrop">
          <div className="modal-card large-modal">
            <div className="modal-header">
              <div>
                <h3>
                  Produits vendus par : {sellerProductsModal.shop_name || sellerProductsModal.name}
                </h3>
                <p className="modal-subtitle">
                  Vendeur : <strong>{sellerProductsModal.name}</strong> (@{sellerProductsModal.username}) • {sellerProducts.length} référence(s) en catalogue
                </p>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setSellerProductsModal(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-toolbar">
              <input
                type="text"
                placeholder="Filtrer dans les produits de ce vendeur (iPhone, écran, chargeur...)..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="modal-search"
              />
            </div>

            <div className="modal-body-scrollable">
              {loadingProducts ? (
                <div className="table-loading">Chargement des produits du vendeur...</div>
              ) : filteredSellerProducts.length === 0 ? (
                <div className="empty-state">Ce vendeur n'a aucun produit correspondant en stock.</div>
              ) : (
                <table className="data-table small-table">
                  <thead>
                    <tr>
                      <th>Produit</th>
                      <th>Catégorie</th>
                      <th>Marque / Modèle</th>
                      <th>Réf.</th>
                      <th>Stock</th>
                      <th>Prix Achat</th>
                      <th>Prix Vente</th>
                      <th>Marge Unitaire</th>
                      <th>État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSellerProducts.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong>
                          {p.location ? <small className="d-block">Emplacement : {p.location}</small> : null}
                        </td>
                        <td>{p.category}</td>
                        <td>{p.brand} {p.model}</td>
                        <td><code>{p.reference || '—'}</code></td>
                        <td>
                          <span className={`qty-badge ${p.quantity <= p.threshold ? 'low' : 'ok'}`}>
                            {p.quantity} pcs
                          </span>
                        </td>
                        <td>{formatCurrency(p.price_buy)}</td>
                        <td><strong>{formatCurrency(p.price_sale)}</strong></td>
                        <td className="profit-cell">+{formatCurrency(p.profit_unit)}</td>
                        <td>
                          <span className={`badge-status ${p.quantity <= 0 ? 'out' : p.quantity <= p.threshold ? 'low' : 'available'}`}>
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setSellerProductsModal(null)}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL : MOT DE PASSE GÉNÉRÉ AUTOMATIQUEMENT */}
      {resetModalData && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <h3>🔑 Mot de passe généré automatiquement</h3>
              <button
                type="button"
                className="close-button"
                onClick={() => setResetModalData(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <p>
                {resetModalData.isNewAccount
                  ? `Le compte de ${resetModalData.name} (@${resetModalData.username}) a été créé.`
                  : `Le mot de passe de ${resetModalData.name} (@${resetModalData.username}) a été réinitialisé.`}
              </p>
              <div className="generated-password-box">
                <span className="password-display">{resetModalData.temporaryPassword}</span>
                <button
                  type="button"
                  className="copy-btn"
                  onClick={() => copyToClipboard(resetModalData.temporaryPassword)}
                >
                  📋 Copier
                </button>
              </div>

              <div className="security-notice">
                <span className="notice-icon">🛡️</span>
                <div>
                  <strong>Sécurité maximale Scrypt :</strong>
                  <p>
                    Ce mot de passe temporaire est haché tout de suite. À la première connexion, l’utilisateur devra choisir son mot de passe personnel.
                  </p>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  copyToClipboard(resetModalData.temporaryPassword);
                  setResetModalData(null);
                }}
              >
                Copier et Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL : CRÉER / MODIFIER UTILISATEUR */}
      {showUserModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <h3>{editingUser ? 'Modifier l’utilisateur' : 'Créer un nouvel utilisateur'}</h3>
              <button
                type="button"
                className="close-button"
                onClick={() => setShowUserModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveUser}>
              <div className="modal-body">
                <div className="form-grid two-columns-grid">
                  <label>
                    Prénom
                    <input
                      required
                      type="text"
                      value={userForm.first_name}
                      onChange={(e) => setUserForm({ ...userForm, first_name: e.target.value })}
                      placeholder="Ex. Amadou"
                    />
                  </label>
                  <label>
                    Nom
                    <input
                      required
                      type="text"
                      value={userForm.last_name}
                      onChange={(e) => setUserForm({ ...userForm, last_name: e.target.value })}
                      placeholder="Ex. Koné"
                    />
                  </label>
                </div>

                <div className="form-grid two-columns-grid">
                  <label>
                    Identifiant de connexion
                    <input
                      required
                      type="text"
                      value={userForm.username}
                      onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                      placeholder="Ex. amadou_k"
                    />
                  </label>
                  <label>
                    Adresse Email
                    <input
                      required
                      type="email"
                      value={userForm.email}
                      onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                      placeholder="amadou@gmail.com"
                    />
                  </label>
                </div>

                <div className="form-grid two-columns-grid">
                  <label>
                    Téléphone
                    <input
                      type="text"
                      value={userForm.phone}
                      onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
                      placeholder="+225 07 00 00 00"
                    />
                  </label>
                  <label>
                    Nom de la boutique
                    <input
                      type="text"
                      value={userForm.shop_name}
                      onChange={(e) => setUserForm({ ...userForm, shop_name: e.target.value })}
                      placeholder="Ex. Boutique Koné Tech"
                    />
                  </label>
                </div>

                <div className="form-grid two-columns-grid">
                  <label>
                    Rôle du compte
                    <select
                      value={userForm.role}
                      onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                    >
                      <option value="seller">🛍️ Vendeur (Gestion de sa boutique)</option>
                      <option value="admin">👑 Administrateur (Accès total)</option>
                    </select>
                  </label>

                  {editingUser ? (
                    <label>
                      Statut
                      <select
                        value={userForm.status}
                        onChange={(e) => setUserForm({ ...userForm, status: e.target.value })}
                      >
                        <option value="active">Actif</option>
                        <option value="inactive">Inactif / Suspendu</option>
                      </select>
                    </label>
                  ) : null}
                </div>

                {!editingUser && (
                  <div className="password-mode-selection">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={userForm.autoPassword}
                        onChange={(e) => setUserForm({ ...userForm, autoPassword: e.target.checked })}
                      />
                      <span>⚡ Générer automatiquement un mot de passe fort et sécurisé</span>
                    </label>

                    {!userForm.autoPassword && (
                      <label className="manual-password-field">
                        Mot de passe manuel (min 8 caractères)
                        <input
                          type="password"
                          value={userForm.password}
                          onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                          placeholder="Saisissez un mot de passe fort..."
                          required={!userForm.autoPassword}
                        />
                      </label>
                    )}
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowUserModal(false)}
                >
                  Annuler
                </button>
                <button type="submit" className="primary-button">
                  {editingUser ? 'Enregistrer les modifications' : 'Créer l’utilisateur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
