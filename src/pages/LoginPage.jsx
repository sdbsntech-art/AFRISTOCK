import { useEffect, useRef, useState } from 'react';
import apiRequest from '../api';
import InstallAppButton from '../components/InstallAppButton';

const emptySignup = {
  first_name: '',
  last_name: '',
  username: '',
  email: '',
  phone: '',
  shop_name: '',
  password: '',
  logo: '',
};

const readLogo = (file) => new Promise((resolve, reject) => {
  if (!file) return resolve('');
  if (file.size > 1.8 * 1024 * 1024) {
    reject(new Error('Logo trop lourd (max 1,8 Mo).'));
    return;
  }
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Impossible de lire le logo.'));
  reader.readAsDataURL(file);
});

export default function LoginPage({ onLogin, onSignup, onGoogle }) {
  const [mode, setMode] = useState('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [form, setForm] = useState(emptySignup);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupBlocked, setSetupBlocked] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);
  const googleBox = useRef(null);

  useEffect(() => {
    apiRequest('/auth/status')
      .then((data) => {
        setSetupRequired(Boolean(data.setupRequired));
        setSetupBlocked(Boolean(data.setupBlocked));
        setMode(data.setupRequired ? 'signup' : 'login');
      })
      .catch((err) => setError(`Impossible de vérifier l’installation : ${err.message}`))
      .finally(() => setCheckingSetup(false));
    apiRequest('/auth/google-config').then((data) => setGoogleClientId(data.clientId || '')).catch(() => setGoogleClientId(''));
  }, []);

  useEffect(() => {
    if (!googleClientId || !googleBox.current) return undefined;

    const renderButton = () => {
      if (!window.google?.accounts?.id) return;
      googleBox.current.innerHTML = '';
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response) => {
          try {
            setPending(true);
            setError('');
            await onGoogle(response.credential);
          } catch (err) {
            setError(err.message || 'Connexion Google impossible.');
          } finally {
            setPending(false);
          }
        },
      });
      window.google.accounts.id.renderButton(googleBox.current, {
        theme: 'filled_black',
        size: 'large',
        width: 340,
        text: 'continue_with',
        shape: 'pill',
      });
    };

    if (window.google?.accounts?.id) {
      renderButton();
      return undefined;
    }

    const existing = document.querySelector('script[data-google-gsi]');
    if (existing) {
      existing.addEventListener('load', renderButton);
      return () => existing.removeEventListener('load', renderButton);
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleGsi = 'true';
    script.onload = renderButton;
    document.head.appendChild(script);
    return undefined;
  }, [googleClientId, onGoogle, mode]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      if (mode === 'signup') {
        await onSignup({ ...form, shop_name: form.shop_name.trim() || 'AfriStock' });
      } else {
        await onLogin(identifier, password);
      }
    } catch (err) {
      setError(err.message || 'Échec de l’authentification');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          {form.logo && mode === 'signup' ? <img className="brand-logo" src={form.logo} alt="Logo boutique" /> : <div className="brand-mark large">A</div>}
          <div className="brand-name">{form.shop_name.trim() || 'AfriStock'}</div>
          <p>Espace vendeur : stock, caisse et rapport mensuel.</p>
        </div>

        {checkingSetup ? (
          <p className="muted-note" role="status">Vérification de l’installation…</p>
        ) : setupRequired ? (
          <div className="setup-notice" role="status">
            Première installation : créez le compte propriétaire. Les inscriptions publiques seront ensuite fermées.
          </div>
        ) : setupBlocked ? (
          <div className="setup-notice" role="status">
            Aucun compte n’est initialisé. Pour éviter qu’un visiteur prenne le contrôle du site, créez le premier compte depuis votre installation locale sécurisée.
          </div>
        ) : null}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'signup' && setupRequired && (
            <>
              <div className="form-grid two-columns-grid">
                <label>Prénom<input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required /></label>
                <label>Nom<input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required /></label>
              </div>
              <label>Identifiant<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
              <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
              <label>Téléphone<input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Ex. 07 00 00 00 00" /></label>
              <label>Nom de la boutique<input value={form.shop_name} onChange={(e) => setForm({ ...form, shop_name: e.target.value })} placeholder="AfriStock par défaut" /></label>
              <label>Logo de la boutique
                <input type="file" accept="image/*" onChange={async (e) => {
                  try {
                    const logo = await readLogo(e.target.files?.[0]);
                    setForm((prev) => ({ ...prev, logo }));
                  } catch (err) {
                    setError(err.message);
                  }
                }} />
              </label>
            </>
          )}

          {mode === 'login' && (
            <label>Email ou identifiant<input value={identifier} onChange={(e) => setIdentifier(e.target.value)} required /></label>
          )}

          <label>Mot de passe<input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={mode === 'signup' ? form.password : password} onChange={(e) => (mode === 'signup' ? setForm({ ...form, password: e.target.value }) : setPassword(e.target.value))} required minLength={mode === 'signup' ? 8 : undefined} maxLength={256} /></label>
          {error && <div className="error-box">{error}</div>}
          <button type="submit" className="primary-button" disabled={pending || checkingSetup || (mode === 'signup' && !setupRequired)}>
            {pending ? 'Traitement...' : mode === 'login' ? 'Entrer dans le logiciel' : 'Créer le compte propriétaire'}
          </button>
        </form>

        {!setupRequired && !setupBlocked && googleClientId && <div ref={googleBox} className="google-box" />}
        <InstallAppButton />
      </div>
    </div>
  );
}
