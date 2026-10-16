import { useEffect, useMemo, useState } from 'react';
import apiRequest from '../api';
import { formatCurrency } from '../lib/format';

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

export default function ProductsPage({ onToast, globalSearch, initialFamily = '', user, onOpenSettings }) {
  const isAdmin = user?.role === 'admin';
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [sellerFilter, setSellerFilter] = useState('');
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState(initialFamily || '');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [stockModal, setStockModal] = useState(null);
  const [stockQty, setStockQty] = useState(1);

  useEffect(() => {
    setFamily(initialFamily || '');
  }, [initialFamily]);

  const loadCategories = async () => {
    try {
      const data = await apiRequest('/categories');
      setCategories(data);
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  const loadSellers = async () => {
    if (!isAdmin) return;
    try {
      const data = await apiRequest('/admin/users');
      setSellers(data);
    } catch {
      // ignore
    }
  };

  const loadProducts = async () => {
    try {
      const params = new URLSearchParams();
      if (search || globalSearch) params.set('search', search || globalSearch);
      if (family) params.set('family', family);
      if (categoryFilter) params.set('category', categoryFilter);
      if (stockFilter !== 'all') params.set('stockStatus', stockFilter);
      if (isAdmin && sellerFilter) params.set('seller_id', sellerFilter);
      const data = await apiRequest(`/products?${params.toString()}`);
      setProducts(data);
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  useEffect(() => {
    loadCategories();
    loadSellers();
  }, [isAdmin]);

  useEffect(() => {
    loadProducts();
  }, [search, globalSearch, family, categoryFilter, stockFilter, sellerFilter]);

  const visibleCategories = useMemo(
    () => (family ? categories.filter((item) => item.family === family) : categories),
    [categories, family],
  );
  const families = useMemo(
    () => [...new Set(categories.map((category) => category.family).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [categories],
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
      onToast({ type: 'success', message: form.id ? 'Article enregistré.' : 'Article ajouté.' });
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer cet article du stock ?')) return;
    try {
      await apiRequest(`/products/${id}`, { method: 'DELETE' });
      loadProducts();
      onToast({ type: 'success', message: 'Article supprimé.' });
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  const handleAddStock = async (event) => {
    event.preventDefault();
    const quantity = Number(stockQty);
    if (!stockModal || !Number.isSafeInteger(quantity) || quantity <= 0) return;
    try {
      await apiRequest(`/products/${stockModal.id}/add-stock`, { method: 'POST', body: JSON.stringify({ quantity }) });
      setStockModal(null);
      setStockQty(1);
      loadProducts();
      onToast({ type: 'success', message: 'Réception enregistrée.' });
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
      <div className="page-header">
        <div>
          <p className="page-kicker">Inventaire</p>
          <h2>Stock {family ? `· ${family}` : ''}</h2>
        </div>
        <button type="button" className="primary-button" onClick={() => { setForm(emptyForm); setShowForm(true); }}>
          Ajouter
        </button>
      </div>

      {!categories.length ? (
        <div className="empty-state panel">
          <p>Créez d’abord une catégorie (ex. Écrans, Coques) pour classer vos articles.</p>
          <button type="button" className="primary-button" onClick={() => onOpenSettings?.()}>Ouvrir les réglages</button>
        </div>
      ) : null}

      <div className="family-rail">
        {[{ id: '', label: 'Tout' }, ...families.map((item) => ({ id: item, label: item }))].map((item) => (
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
            <select value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)}>
              <option value="">Toutes les boutiques</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>{s.shop_name || s.name}</option>
              ))}
            </select>
          )}
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, référence, modèle…" />
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
        </div>
      </div>

      {products.length === 0 ? (
        <div className="empty-state panel">
          <p>Aucun article pour ces filtres.</p>
          <button type="button" className="primary-button" onClick={() => setShowForm(true)}>Ajouter un article</button>
        </div>
      ) : (
        <div className="product-grid">
          {products.map((product) => (
            <article key={product.id} className="stock-card">
              <div className="stock-card-top">
                <div>
                  <strong>{product.name}</strong>
                  <small>{product.category}{isAdmin ? ` · ${product.seller_shop || product.seller_name || ''}` : ''}</small>
                </div>
                <span className={statusClass(product)}>{product.status}</span>
              </div>
              <p className="muted-note">{product.brand} {product.model}{product.reference ? ` · ${product.reference}` : ''}</p>
              <div className="stock-card-metrics">
                <div><span>Qté</span><strong>{product.quantity}</strong></div>
                <div><span>Vente</span><strong>{formatCurrency(product.price_sale)}</strong></div>
                <div><span>Marge</span><strong>{formatCurrency(product.profit_unit)}</strong></div>
              </div>
              <div className="actions-cell">
                <button type="button" className="ghost-button" onClick={() => { setForm({ ...emptyForm, ...product }); setShowForm(true); }}>Modifier</button>
                <button type="button" className="ghost-button" onClick={() => { setStockModal(product); setStockQty(1); }}>Réception</button>
                <button type="button" className="link-button danger" onClick={() => handleDelete(product.id)}>Supprimer</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{form.id ? 'Modifier l’article' : 'Nouvel article'}</h3>
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
                <label>Référence<input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></label>
                <label>Compatible<input value={form.compatible_models} onChange={(e) => setForm({ ...form, compatible_models: e.target.value })} /></label>
                <label>Quantité<input type="number" min="0" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></label>
                <label>Prix d’achat<input type="number" min="0" value={form.price_buy} onChange={(e) => setForm({ ...form, price_buy: Number(e.target.value) })} /></label>
                <label>Prix de vente<input type="number" min="0" value={form.price_sale} onChange={(e) => setForm({ ...form, price_sale: Number(e.target.value) })} /></label>
                <label>Seuil d’alerte<input type="number" min="0" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })} /></label>
                <label>Emplacement<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
                <label className="full-width">Note<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              </div>
              <div className="profit-box">
                <span>Marge unitaire</span>
                <strong>{formatCurrency(profitPerUnit)}</strong>
              </div>
              <div className="modal-actions">
                <button type="button" className="ghost-button" onClick={() => setShowForm(false)}>Annuler</button>
                <button type="submit" className="primary-button">{form.id ? 'Enregistrer' : 'Ajouter'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {stockModal && (
        <div className="modal-backdrop" onClick={() => setStockModal(null)}>
          <div className="modal-card compact-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Réception — {stockModal.name}</h3>
              <button type="button" className="close-button" onClick={() => setStockModal(null)}>×</button>
            </div>
            <form onSubmit={handleAddStock} className="modal-form">
              <label>Quantité reçue
                <input type="number" min="1" value={stockQty} onChange={(e) => setStockQty(e.target.value)} required />
              </label>
              <div className="modal-actions">
                <button type="button" className="ghost-button" onClick={() => setStockModal(null)}>Annuler</button>
                <button type="submit" className="primary-button">Ajouter au stock</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
