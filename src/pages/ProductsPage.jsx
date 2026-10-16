import { useEffect, useMemo, useState } from 'react';
import apiRequest from '../api';
import { FAMILIES, FAMILY_LABELS, formatCurrency } from '../lib/format';

const emptyForm = {
  id: null,
  name: '',
  category: '',
  brand: '',
  model: '',
  reference: '',
  quantity: 0,
  price_buy: 0,
  price_sale: 0,
  threshold: 3,
  location: '',
  description: '',
  compatible_models: '',
};

export default function ProductsPage({ onToast, globalSearch, initialFamily = '', user }) {
  const isAdmin = user?.role === 'admin';
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [sellerFilter, setSellerFilter] = useState('');
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState(initialFamily || '');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    setFamily(initialFamily || '');
  }, [initialFamily]);

  const loadCategories = async () => {
    const data = await apiRequest('/categories');
    setCategories(data);
  };

  const loadSellers = async () => {
    if (isAdmin) {
      try {
        const data = await apiRequest('/admin/users');
        setSellers(data);
      } catch {
        // Ignorer si pas accès
      }
    }
  };

  const loadProducts = async () => {
    const params = new URLSearchParams();
    if (search || globalSearch) params.set('search', search || globalSearch);
    if (family) params.set('family', family);
    if (categoryFilter) params.set('category', categoryFilter);
    if (stockFilter !== 'all') params.set('stockStatus', stockFilter);
    if (priceMin) params.set('minPrice', priceMin);
    if (priceMax) params.set('maxPrice', priceMax);
    if (isAdmin && sellerFilter) params.set('seller_id', sellerFilter);
    const data = await apiRequest(`/products?${params.toString()}`);
    setProducts(data);
  };

  useEffect(() => {
    loadCategories();
    loadSellers();
  }, [isAdmin]);

  useEffect(() => {
    loadProducts();
  }, [search, globalSearch, family, categoryFilter, stockFilter, priceMin, priceMax, sellerFilter]);

  const visibleCategories = useMemo(
    () => (family ? categories.filter((item) => item.family === family) : categories),
    [categories, family],
  );

  const handleSaveProduct = async (event) => {
    event.preventDefault();
    try {
      if (form.id) {
        await apiRequest(`/products/${form.id}`, { method: 'PUT', body: JSON.stringify(form) });
      } else {
        await apiRequest('/products', { method: 'POST', body: JSON.stringify(form) });
      }
      setShowForm(false);
      setForm(emptyForm);
      loadProducts();
      onToast({ type: 'success', message: form.id ? 'Produit mis à jour.' : 'Produit ajouté.' });
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer cette référence du stock ?')) return;
    try {
      await apiRequest(`/products/${id}`, { method: 'DELETE' });
      loadProducts();
      onToast({ type: 'success', message: 'Produit supprimé.' });
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  const handleAddStock = async (id) => {
    const quantity = Number(window.prompt('Quantité reçue ?', '5'));
    if (!quantity || Number.isNaN(quantity)) return;
    try {
      await apiRequest(`/products/${id}/add-stock`, { method: 'POST', body: JSON.stringify({ quantity }) });
      loadProducts();
      onToast({ type: 'success', message: 'Stock mis à jour.' });
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  const profitPerUnit = Number(form.price_sale || 0) - Number(form.price_buy || 0);
  const statusClass = (product) => {
    if (product.quantity <= 0) return 'status-chip danger';
    if (product.quantity <= product.threshold) return 'status-chip warn';
    return 'status-chip success';
  };

  return (
    <div className="products-page">
      <div className="page-topbar">
        <div>
          <p className="page-kicker">Inventaire interne</p>
          <h2>Stock {family ? `· ${FAMILY_LABELS[family] || ''}` : ''}</h2>
        </div>
        <button type="button" className="primary-button" onClick={() => { setForm(emptyForm); setShowForm(true); }}>
          Ajouter une référence
        </button>
      </div>

      <div className="family-rail">
        {FAMILIES.map((item) => (
          <button
            key={item.id || 'all'}
            type="button"
            className={family === item.id ? 'family-chip active' : 'family-chip'}
            onClick={() => { setFamily(item.id); setCategoryFilter(''); }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="panel filters-panel">
        <div className="form-grid compact-grid">
          {isAdmin && (
            <select value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)} className="seller-select-filter">
              <option value="">🏬 Toutes les boutiques</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shop_name || s.name} (@{s.username})
                </option>
              ))}
            </select>
          )}
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, référence, modèle compatible..." />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Toutes les catégories</option>
            {visibleCategories.map((category) => (
              <option key={category.id} value={category.name}>{category.name}</option>
            ))}
          </select>
          <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}>
            <option value="all">Tous les stocks</option>
            <option value="available">Disponible</option>
            <option value="low">Stock faible</option>
            <option value="out">Rupture</option>
          </select>
          <input type="number" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder="Prix min" />
          <input type="number" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="Prix max" />
        </div>
        <button type="button" className="ghost-button" onClick={() => { setSearch(''); setFamily(''); setCategoryFilter(''); setStockFilter('all'); setPriceMin(''); setPriceMax(''); setSellerFilter(''); }}>
          Réinitialiser
        </button>
      </div>

      <div className="panel table-panel">
        {products.length === 0 ? (
          <div className="empty-state">
            <p>Aucune référence dans ce rayon.</p>
            <button type="button" className="primary-button" onClick={() => setShowForm(true)}>Ajouter une référence</button>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  {isAdmin && <th>Boutique</th>}
                  <th>Référence</th>
                  <th>Catégorie</th>
                  <th>Marque / modèle</th>
                  <th>Compatible</th>
                  <th>Qté</th>
                  <th>Achat</th>
                  <th>Vente</th>
                  <th>Marge</th>
                  <th>Statut</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    {isAdmin && (
                      <td>
                        <span className="shop-badge small">
                          🏪 {product.seller_shop || product.seller_name || 'AfriStock'}
                        </span>
                      </td>
                    )}
                    <td>
                      <strong>{product.name}</strong>
                      <small>{product.reference || '—'}</small>
                    </td>
                    <td>{product.category}</td>
                    <td>{product.brand} · {product.model}</td>
                    <td>{product.compatible_models || product.model}</td>
                    <td>{product.quantity}</td>
                    <td>{formatCurrency(product.price_buy)}</td>
                    <td>{formatCurrency(product.price_sale)}</td>
                    <td>{formatCurrency(product.profit_unit)}</td>
                    <td><span className={statusClass(product)}>{product.status}</span></td>
                    <td className="actions-cell">
                      <button type="button" className="link-button" onClick={() => { setForm({ ...emptyForm, ...product }); setShowForm(true); }}>Modifier</button>
                      <button type="button" className="link-button" onClick={() => handleAddStock(product.id)}>Réception</button>
                      <button type="button" className="link-button danger" onClick={() => handleDelete(product.id)}>Supprimer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{form.id ? 'Modifier la référence' : 'Nouvelle référence'}</h3>
              <button type="button" className="close-button" onClick={() => setShowForm(false)}>×</button>
            </div>
            <form onSubmit={handleSaveProduct} className="modal-form">
              <div className="form-grid two-columns-grid">
                <label>Nom<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
                <label>Catégorie
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
                    <option value="">Choisir</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.name}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <label>Marque<input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} required /></label>
                <label>Modèle<input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required /></label>
                <label>Référence interne<input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></label>
                <label>Compatible avec<input value={form.compatible_models} onChange={(e) => setForm({ ...form, compatible_models: e.target.value })} placeholder="iPhone 13, Galaxy A14..." /></label>
                <label>Quantité<input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></label>
                <label>Prix d'achat<input type="number" value={form.price_buy} onChange={(e) => setForm({ ...form, price_buy: Number(e.target.value) })} /></label>
                <label>Prix de vente<input type="number" value={form.price_sale} onChange={(e) => setForm({ ...form, price_sale: Number(e.target.value) })} /></label>
                <label>Seuil d'alerte<input type="number" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })} /></label>
                <label>Emplacement<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
                <label className="full-width">Note interne<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              </div>
              <div className="profit-box">
                <span>Marge unitaire</span>
                <strong>{formatCurrency(profitPerUnit)}</strong>
              </div>
              <div className="modal-actions">
                <button type="button" className="ghost-button" onClick={() => setShowForm(false)}>Annuler</button>
                <button type="submit" className="primary-button">{form.id ? 'Enregistrer' : 'Ajouter au stock'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
