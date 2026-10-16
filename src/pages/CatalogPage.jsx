import { useEffect, useState } from 'react';
import apiRequest from '../api';

export default function CatalogPage({ onOpenFamily, onManageCategories }) {
  const [families, setFamilies] = useState([]);

  useEffect(() => {
    const load = async () => {
      const data = await apiRequest('/catalog/families');
      setFamilies(data);
    };
    load();
  }, []);

  return (
    <div className="catalog-page">
      <div className="page-topbar">
        <div>
          <p className="page-kicker">Organisation du magasin</p>
          <h2>Rayons pièces & accessoires</h2>
        </div>
      </div>

      {families.length ? <div className="family-grid">
        {families.map((family) => (
          <button key={family.id} type="button" className="family-card" onClick={() => onOpenFamily(family.id)}>
            <small>{family.hint}</small>
            <strong>{family.label}</strong>
            <span>{family.product_count} références · {family.stock_count} en stock</span>
          </button>
        ))}
      </div> : (
        <div className="empty-state panel">
          <p>Aucun rayon ni produit n’a encore été créé.</p>
          <p>Ajoutez vos catégories dans les paramètres, puis saisissez vos propres articles.</p>
          <button type="button" className="primary-button" onClick={onManageCategories}>Créer mes catégories</button>
        </div>
      )}
    </div>
  );
}
