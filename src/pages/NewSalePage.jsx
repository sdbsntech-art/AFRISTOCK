import { useEffect, useState } from 'react';
import apiRequest from '../api';
import { formatCurrency } from '../lib/format';

export default function NewSalePage({ onToast, globalSearch }) {
  const [products, setProducts] = useState([]);
  const [families, setFamilies] = useState([]);
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState('');
  const [cart, setCart] = useState([]);

  const loadProducts = async () => {
    const params = new URLSearchParams();
    if (search || globalSearch) params.set('search', search || globalSearch);
    if (family) params.set('family', family);
    const data = await apiRequest(`/products?${params.toString()}`);
    setProducts(data.filter((item) => item.quantity > 0));
  };

  useEffect(() => {
    loadProducts();
  }, [search, globalSearch, family]);

  useEffect(() => {
    apiRequest('/catalog/families').then(setFamilies).catch((error) => {
      onToast({ type: 'error', message: error.message });
    });
  }, [onToast]);

  const addToCart = (product) => {
    const existing = cart.find((item) => item.id === product.id);
    if (existing) {
      setCart((prev) => prev.map((item) => (
        item.id === product.id
          ? { ...item, quantity: Math.min(item.quantity + 1, product.quantity) }
          : item
      )));
      return;
    }
    setCart((prev) => [...prev, { ...product, quantity: 1, stock: product.quantity }]);
  };

  const updateQuantity = (id, quantity) => {
    setCart((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      const max = item.stock || item.quantity;
      return { ...item, quantity: Math.max(1, Math.min(Number(quantity || 1), max)) };
    }));
  };

  const total = cart.reduce((sum, item) => sum + Number(item.price_sale) * Number(item.quantity), 0);
  const totalProfit = cart.reduce((sum, item) => sum + ((Number(item.price_sale) - Number(item.price_buy)) * Number(item.quantity)), 0);

  const validateSale = async () => {
    if (!cart.length) {
      onToast({ type: 'error', message: 'Ajoutez au moins une pièce au ticket.' });
      return;
    }
    try {
      await apiRequest('/sales', {
        method: 'POST',
        body: JSON.stringify({ items: cart.map((item) => ({ id: item.id, quantity: item.quantity })) }),
      });
      setCart([]);
      loadProducts();
      onToast({ type: 'success', message: 'Ticket enregistré. Stock déduit.' });
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  return (
    <div className="sale-page">
      <div>
        <p className="page-kicker">Point de vente</p>
        <h2>Caisse vendeur</h2>
      </div>

      <div className="family-rail">
        {[{ id: '', label: 'Tous les produits' }, ...families.map((item) => ({ id: item.id, label: item.label }))].map((item) => (
          <button key={item.id || 'all'} type="button" className={family === item.id ? 'family-chip active' : 'family-chip'} onClick={() => setFamily(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="panel sales-layout">
        <div className="search-panel">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Scanner mental : iPhone 13, USB-C, écran A54..." />
          <div className="product-list">
            {products.map((product) => (
              <button key={product.id} type="button" className="product-card" onClick={() => addToCart(product)}>
                <strong>{product.name}</strong>
                <span>{product.category} · stock {product.quantity}</span>
                <small>{formatCurrency(product.price_sale)} · {product.compatible_models || product.model}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="summary-panel">
          <h3>Ticket en cours</h3>
          {cart.length === 0 ? <p>Aucune ligne.</p> : (
            <div className="cart-list">
              {cart.map((item) => (
                <div key={item.id} className="cart-item">
                  <div>
                    <strong>{item.name}</strong>
                    <small>{formatCurrency(item.price_sale)}</small>
                  </div>
                  <div className="quantity-box">
                    <input type="number" min="1" max={item.stock || item.quantity} value={item.quantity} onChange={(e) => updateQuantity(item.id, e.target.value)} />
                    <button type="button" className="danger-text" onClick={() => setCart((prev) => prev.filter((row) => row.id !== item.id))}>Retirer</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="totals-box">
            <div><span>Total client</span><strong>{formatCurrency(total)}</strong></div>
            <div><span>Marge</span><strong>{formatCurrency(totalProfit)}</strong></div>
          </div>
          <button type="button" className="primary-button" onClick={validateSale}>Valider le ticket</button>
        </div>
      </div>
    </div>
  );
}
