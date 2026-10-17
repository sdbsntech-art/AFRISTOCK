import { useEffect, useState } from 'react';
import apiRequest from '../api';

const readLogo = (file) => new Promise((resolve, reject) => {
  if (!file) return resolve(undefined);
  if (file.size > 1.8 * 1024 * 1024) {
    reject(new Error('Logo trop lourd (max 1,8 Mo).'));
    return;
  }
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Impossible de lire le logo.'));
  reader.readAsDataURL(file);
});

export default function SettingsPage({ onToast, user, onUserUpdate }) {
  const [categories, setCategories] = useState([]);
  const [name, setName] = useState('');
  const [family, setFamily] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [profile, setProfile] = useState({
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    username: user?.username || '',
    email: user?.email || '',
    phone: user?.phone || '',
    shop_name: user?.shop_name || 'AfriStock',
    logo: user?.logo || '',
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordLoading, setPasswordLoading] = useState(false);

  const handleChangePassword = async (event) => {
    event.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      onToast({ type: 'error', message: 'Les nouveaux mots de passe ne correspondent pas.' });
      return;
    }
    try {
      setPasswordLoading(true);
      const res = await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      if (res.user) onUserUpdate?.(res.user);
      onToast({ type: 'success', message: 'Mot de passe modifié.' });
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    } finally {
      setPasswordLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const data = await apiRequest('/categories');
      setCategories(data);
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  const saveProfile = async (event) => {
    event.preventDefault();
    try {
      const data = await apiRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({ ...profile, shop_name: profile.shop_name.trim() || 'AfriStock' }),
      });
      onUserUpdate?.(data.user);
      onToast({ type: 'success', message: 'Profil enregistré.' });
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  const saveCategory = async (event) => {
    event.preventDefault();
    try {
      if (editingId) {
        await apiRequest(`/categories/${editingId}`, { method: 'PUT', body: JSON.stringify({ name, family }) });
      } else {
        await apiRequest('/categories', { method: 'POST', body: JSON.stringify({ name, family }) });
      }
      setName('');
      setFamily('');
      setEditingId(null);
      loadCategories();
      onToast({ type: 'success', message: editingId ? 'Catégorie modifiée.' : 'Catégorie ajoutée.' });
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  const deleteCategory = async (id) => {
    if (!window.confirm('Supprimer cette catégorie ?')) return;
    try {
      await apiRequest(`/categories/${id}`, { method: 'DELETE' });
      loadCategories();
      onToast({ type: 'success', message: 'Catégorie supprimée.' });
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <p className="page-kicker">Boutique</p>
          <h2>Réglages</h2>
        </div>
      </div>

      <form className="panel" onSubmit={saveProfile}>
        <h3>Votre boutique</h3>
        <div className="form-grid two-columns-grid">
          <label>Prénom<input value={profile.first_name} onChange={(e) => setProfile({ ...profile, first_name: e.target.value })} /></label>
          <label>Nom<input value={profile.last_name} onChange={(e) => setProfile({ ...profile, last_name: e.target.value })} /></label>
          <label>Identifiant<input value={profile.username} onChange={(e) => setProfile({ ...profile, username: e.target.value })} /></label>
          <label>Email<input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></label>
          <label>Téléphone<input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></label>
          <label>Nom de la boutique<input value={profile.shop_name} onChange={(e) => setProfile({ ...profile, shop_name: e.target.value })} /></label>
          <label className="full-width">Logo
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (e) => {
              try {
                const logo = await readLogo(e.target.files?.[0]);
                if (logo) setProfile((prev) => ({ ...prev, logo }));
              } catch (error) {
                onToast({ type: 'error', message: error.message });
              }
            }} />
          </label>
        </div>
        {profile.logo && <img className="shop-logo" src={profile.logo} alt="" />}
        <div className="modal-actions"><button type="submit" className="primary-button">Enregistrer</button></div>
      </form>

      <form className="panel" onSubmit={handleChangePassword}>
        <h3>Mot de passe</h3>
        <p className="muted-note">Les mots de passe sont stockés de façon sécurisée dans le fichier SQLite local.</p>
        <div className="form-grid two-columns-grid">
          <label>Mot de passe actuel
            <input type="password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} required />
          </label>
          <div />
          <label>Nouveau mot de passe
            <input type="password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} required minLength={8} />
          </label>
          <label>Confirmation
            <input type="password" value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} required />
          </label>
        </div>
        <div className="modal-actions">
          <button type="submit" className="primary-button" disabled={passwordLoading}>
            {passwordLoading ? 'Mise à jour…' : 'Changer le mot de passe'}
          </button>
        </div>
      </form>

      <div className="panel">
        <h3>Catégories</h3>
        <p className="muted-note">Exemples : « Riz » dans le rayon « Épicerie » ou « Écran OLED » dans « Électronique ».</p>
        <form onSubmit={saveCategory} className="category-form inline-form">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la catégorie" required />
          <input type="text" value={family} onChange={(e) => setFamily(e.target.value)} placeholder="Rayon" required maxLength={191} />
          <button type="submit" className="primary-button">{editingId ? 'Mettre à jour' : 'Ajouter'}</button>
          {editingId ? (
            <button type="button" className="ghost-button" onClick={() => { setEditingId(null); setName(''); setFamily(''); }}>Annuler</button>
          ) : null}
        </form>
        <div className="tag-list">
          {categories.length === 0 ? <p className="muted-note">Aucune catégorie pour le moment.</p> : categories.map((category) => (
            <div key={category.id} className="tag-item">
              <span>{category.name}</span>
              <em>{category.family}</em>
              <button type="button" className="link-button" onClick={() => { setName(category.name); setFamily(category.family || ''); setEditingId(category.id); }}>Modifier</button>
              <button type="button" className="link-button danger" onClick={() => deleteCategory(category.id)}>Supprimer</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
