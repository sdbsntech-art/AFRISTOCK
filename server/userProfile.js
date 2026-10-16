export const DEFAULT_SHOP_NAME = 'AfriStock';

export const publicUser = (user) => {
  if (!user) return null;
  const first_name = String(user.first_name || '').trim();
  const last_name = String(user.last_name || '').trim();
  const shop_name = String(user.shop_name || '').trim() || DEFAULT_SHOP_NAME;
  const display_name = [first_name, last_name].filter(Boolean).join(' ') || user.name || 'Utilisateur';
  return {
    id: Number(user.id),
    name: display_name,
    first_name,
    last_name,
    username: user.username,
    email: user.email,
    phone: user.phone || '',
    shop_name,
    logo: user.logo || '',
    role: user.role || 'seller',
    status: user.status || 'active',
    must_change_password: Boolean(user.must_change_password),
    google_id: user.google_id || '',
    created_at: user.created_at || '',
  };
};

export const fullName = (first, last, fallback = '') => {
  const value = [String(first || '').trim(), String(last || '').trim()].filter(Boolean).join(' ');
  return value || fallback || 'Utilisateur';
};
