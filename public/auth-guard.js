(() => {
  document.documentElement.classList.add('auth-pending');
  const style = document.createElement('style');
  style.textContent = '.auth-pending body{visibility:hidden}.auth-account{position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;align-items:center;gap:10px;background:#071d35;color:#fff;border:1px solid #ffffff1f;border-radius:9px;padding:9px 10px 9px 13px;box-shadow:0 10px 30px #071d3540;font-family:Open Sans,Arial,sans-serif}.auth-account span{font-size:9px}.auth-account strong{display:block;font-size:10px}.auth-account button{border:1px solid #ffffff2b;background:#ffffff10;color:#fff;border-radius:5px;padding:7px 9px;font-size:8px;font-weight:800;cursor:pointer}';
  document.head.appendChild(style);
  const requiredRole = document.querySelector('meta[name="required-role"]')?.content;

  fetch('/api/session', { cache: 'no-store' }).then(async (response) => {
    if (!response.ok) throw new Error('unauthenticated');
    const { user } = await response.json();
    if (requiredRole && user.role !== requiredRole) return location.replace(user.role === 'sompo' ? '/sompo.html' : '/frota.html');
    document.documentElement.classList.remove('auth-pending');
    window.agroRiskUser = user;
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('[data-user-name]').forEach((element) => { element.textContent = user.name; });
      document.querySelectorAll('[data-user-role]').forEach((element) => { element.textContent = user.role === 'sompo' ? 'Equipe Sompo' : 'Produtor'; });
      if (!document.querySelector('.auth-account') && requiredRole === 'farmer') {
        const account = document.createElement('div');
        account.className = 'auth-account';
        account.innerHTML = `<span><strong>${String(user.name).replace(/[&<>"']/g, '')}</strong>Portal do produtor</span><button type="button">SAIR</button>`;
        account.querySelector('button').addEventListener('click', logout);
        document.body.appendChild(account);
      }
    });
  }).catch(() => location.replace(`/login.html?next=${encodeURIComponent(location.pathname + location.search)}`));

  async function logout() {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.replace('/login.html');
  }
  window.agroRiskLogout = logout;
})();
