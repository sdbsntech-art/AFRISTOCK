import { useEffect, useState } from 'react';
import apiRequest from '../api';
import { FAMILIES, FAMILY_LABELS } from '../lib/format';

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
  const [family, setFamily] = useState('autres');
  const [editingId, setEditingId] = useState(null);
  const [googleClientId, setGoogleClientId] = useState('');
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
    if (passwordForm.newPassword.length < 8) {
      onToast({ type: 'error', message: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' });
      return;
    }
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
      onToast({ type: 'success', message: 'Mot de passe modifié et sécurisé avec succès.' });
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    } finally {
      setPasswordLoading(false);
    }
  };

  const loadCategories = async () => {
    const data = await apiRequest('/categories');
    setCategories(data);
  };

  useEffect(() => {
    loadCategories();
    apiRequest('/auth/google-config').then((data) => setGoogleClientId(data.clientId || '')).catch(() => {});
  }, []);

  const saveProfile = async (event) => {
    event.preventDefault();
    try {
      const data = await apiRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({ ...profile, shop_name: profile.shop_name.trim() || 'AfriStock' }),
      });
      onUserUpdate?.(data.user);
      onToast({ type: 'success', message: 'Profil boutique enregistré.' });
    } catch (error) {
      onToast({ type: 'error', message: error.message });
    }
  };

  const saveGoogle = async (event) => {
    event.preventDefault();
    try {
      await apiRequest('/settings/google', { method: 'PUT', body: JSON.stringify({ clientId: googleClientId }) });
      onToast({ type: 'success', message: 'ID Google enregistré.' });
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
      setFamily('autres');
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
      <div>
        <p className="page-kicker">Compte et boutique</p>
        <h2>Paramètres</h2>
      </div>

      <form className="panel" onSubmit={saveProfile}>
        <h3>Identité du vendeur</h3>
        <div className="form-grid two-columns-grid">
          <label>Prénom<input value={profile.first_name} onChange={(e) => setProfile({ ...profile, first_name: e.target.value })} /></label>
          <label>Nom<input value={profile.last_name} onChange={(e) => setProfile({ ...profile, last_name: e.target.value })} /></label>
          <label>Identifiant<input value={profile.username} onChange={(e) => setProfile({ ...profile, username: e.target.value })} /></label>
          <label>Email<input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></label>
          <label>Téléphone<input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></label>
          <label>Nom de la boutique<input value={profile.shop_name} onChange={(e) => setProfile({ ...profile, shop_name: e.target.value })} placeholder="AfriStock par défaut" /></label>
          <label className="full-width">Logo
            <input type="file" accept="image/*" onChange={async (e) => {
              try {
                const logo = await readLogo(e.target.files?.[0]);
                if (logo) setProfile((prev) => ({ ...prev, logo }));
              } catch (error) {
                onToast({ type: 'error', message: error.message });
              }
            }} />
          </label>
        </div>
        {profile.logo && <img className="shop-logo" src={profile.logo} alt="Logo" />}
        <div className="modal-actions"><button type="submit" className="primary-button">Enregistrer le profil</button></div>
      </form>

      <form className="panel" onSubmit={saveGoogle}>
        <h3>Connexion Google</h3>
        <p className="muted-note">Collez l’ID client OAuth (type Application Web) depuis Google Cloud Console. Origines JavaScript autorisées : http://localhost:4173 — URI de redirection : http://localhost:4173</p>
        <input value={googleClientId} onChange={(e) => setGoogleClientId(e.target.value)} placeholder="xxxx.apps.googleusercontent.com" />
        <div className="modal-actions"><button type="submit" className="primary-button">Activer Google</button></div>
      </form>

      <form className="panel" onSubmit={handleChangePassword}>
        <h3>🛡️ Sécurité & Mot de passe</h3>
        <p className="muted-note">Vos mots de passe sont chiffrés et hachés de manière irréversible via l’algorithme cryptographique Scrypt dans MySQL.</p>
        <div className="form-grid two-columns-grid">
          <label>
            Mot de passe actuel
            <input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
              required
              placeholder="Votre mot de passe actuel"
            />
          </label>
          <div></div>
          <label>
            Nouveau mot de passe
            <input
              type="password"
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              required
              placeholder="Minimum 8 caractères"
            />
          </label>
          <label>
            Confirmer le nouveau mot de passe
            <input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
              required
              placeholder="Répétez le mot de passe"
            />
          </label>
        </div>
        <div className="modal-actions">
          <button type="submit" className="primary-button" disabled={passwordLoading}>
            {passwordLoading ? 'Mise à jour...' : 'Mettre à jour mon mot de passe'}
          </button>
        </div>
      </form>

      <div className="panel settings-layout">
        <form onSubmit={saveCategory} className="category-form">
          <h3>{editingId ? 'Modifier' : 'Nouvelle catégorie'}</h3>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Écrans Google Pixel" />
          <select value={family} onChange={(e) => setFamily(e.target.value)}>
            {FAMILIES.filter((item) => item.id).map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <button type="submit" className="primary-button">{editingId ? 'Mettre à jour' : 'Ajouter'}</button>
        </form>
        <div className="tag-list">
          {categories.map((category) => (
            <div key={category.id} className="tag-item">
              <span>{category.name}</span>
              <em>{FAMILY_LABELS[category.family] || category.family}</em>
              <div className="tag-actions">
                <button type="button" className="link-button" onClick={() => { setName(category.name); setFamily(category.family || 'autres'); setEditingId(category.id); }}>Modifier</button>
                <button type="button" className="link-button danger" onClick={() => deleteCategory(category.id)}>Supprimer</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
