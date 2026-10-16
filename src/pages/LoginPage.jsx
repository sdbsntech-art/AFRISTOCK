import { useEffect, useRef, useState } from 'react';
import apiRequest from '../api';

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
  const googleBox = useRef(null);

  useEffect(() => {
    let active = true;
    apiRequest('/auth/status')
      .then((data) => {
        if (!active) return;
        const req = Boolean(data?.setupRequired);
        setSetupRequired(req);
        if (req) {
          setMode('signup');
        }
      })
      .catch(() => {
        // En cas d'erreur réseau ou API, on ne bloque jamais le formulaire.
      });

    apiRequest('/auth/google-config')
      .then((data) => {
        if (active) setGoogleClientId(data?.clientId || '');
      })
      .catch(() => {
        if (active) setGoogleClientId('');
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!googleClientId || !googleBox.current || mode === 'signup') return undefined;

    const renderButton = () => {
      if (!window.google?.accounts?.id || !googleBox.current) return;
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
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'continue_with',
        shape: 'rectangular',
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
      let message = err.message || 'Échec de l’authentification';
      if (message.includes('NOT_FOUND') || message.includes('404')) {
        message = 'Serveur API indisponible (404). Vérifiez que le serveur AfriStock est démarré.';
      } else if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
        message = 'Connexion au serveur impossible. Vérifiez votre connexion ou que le serveur local est actif.';
      }
      setError(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          {form.logo && mode === 'signup' ? (
            <img className="brand-logo" src={form.logo} alt="" />
          ) : (
            <div className="brand-mark large">A</div>
          )}
          <div className="brand-name">AfriStock</div>
          <p>Stock, caisse et ventes — gestion intelligente et sécurisée.</p>
        </div>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
          >
            Se connecter
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => { setMode('signup'); setError(''); }}
          >
            Créer un compte
          </button>
        </div>

        {mode === 'signup' && setupRequired && (
          <div className="setup-notice" role="status">
            Première utilisation : créez votre compte administrateur pour initialiser la boutique.
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <>
              <div className="form-grid two-columns-grid">
                <label>Prénom<input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required /></label>
                <label>Nom<input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required /></label>
              </div>
              <label>Identifiant<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoComplete="username" /></label>
              <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="email" /></label>
              <label>Téléphone<input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              <label>Nom de la boutique<input value={form.shop_name} onChange={(e) => setForm({ ...form, shop_name: e.target.value })} placeholder="AfriStock" /></label>
              <label>Logo (facultatif)
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (e) => {
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
            <label>Email ou identifiant
              <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoComplete="username" autoFocus />
            </label>
          )}

          <label>Mot de passe
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={mode === 'signup' ? form.password : password}
              onChange={(e) => (mode === 'signup' ? setForm({ ...form, password: e.target.value }) : setPassword(e.target.value))}
              required
              minLength={mode === 'signup' ? 8 : undefined}
              maxLength={256}
            />
          </label>

          {error && <div className="error-box" role="alert">{error}</div>}

          <button type="submit" className="primary-button" disabled={pending}>
            {pending ? 'Patientez…' : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
          </button>
        </form>

        <div className="auth-switch">
          {mode === 'login' ? (
            <p>
              Nouveau sur AfriStock ?{' '}
              <button type="button" className="link-button" onClick={() => { setMode('signup'); setError(''); }}>
                Créer un compte
              </button>
            </p>
          ) : (
            <p>
              Vous possédez déjà un compte ?{' '}
              <button type="button" className="link-button" onClick={() => { setMode('login'); setError(''); }}>
                Se connecter
              </button>
            </p>
          )}
        </div>

        {mode === 'login' && googleClientId ? <div ref={googleBox} className="google-box" /> : null}
      </div>
    </div>
  );
}
