import { useState } from 'react';
import apiRequest from '../api';

export default function MustChangePasswordModal({ user, onPasswordChanged, onToast }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError('Le nouveau mot de passe doit comporter au moins 8 caractères.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword }),
      });
      onToast({ type: 'success', message: 'Mot de passe personnel enregistré avec succès !' });
      onPasswordChanged(res.user);
    } catch (err) {
      setError(err.message || 'Impossible de mettre à jour le mot de passe.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop force-modal">
      <div className="modal-card">
        <div className="modal-header">
          <div>
            <span className="badge-warning">Action Requise</span>
            <h3>🔒 Définissez votre mot de passe personnel</h3>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="modal-description">
              Bonjour <strong>{user.name}</strong>, votre compte exige un mot de passe personnel. Choisissez-le maintenant avant d'accéder au logiciel.
            </p>

            {error && <div className="error-box">{error}</div>}

            <div className="form-group">
              <label>
                Nouveau mot de passe personnel
                <input
                  type="password"
                  required
                  placeholder="Minimum 8 caractères"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
            </div>

            <div className="form-group">
              <label>
                Confirmer le nouveau mot de passe
                <input
                  type="password"
                  required
                  placeholder="Répétez le mot de passe"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </label>
            </div>

            <div className="security-notice small">
              🛡️ Vos mots de passe sont hachés avec la fonction cryptographique Scrypt dans MySQL.
            </div>
          </div>

          <div className="modal-actions">
            <button type="submit" className="primary-button full-width" disabled={loading}>
              {loading ? 'Sécurisation...' : 'Valider mon mot de passe et continuer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
