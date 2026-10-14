import { useEffect, useState } from 'react';
import apiRequest from '../api';

export default function CatalogPage({ onOpenFamily }) {
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

      <div className="family-grid">
        {families.map((family) => (
          <button key={family.id} type="button" className="family-card" onClick={() => onOpenFamily(family.id)}>
            <small>{family.hint}</small>
            <strong>{family.label}</strong>
            <span>{family.product_count} références · {family.stock_count} en stock</span>
          </button>
        ))}
      </div>
    </div>
  );
}
