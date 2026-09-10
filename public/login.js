(() => {
  const form = document.getElementById('login-form');
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const feedback = document.getElementById('login-feedback');
  const submit = document.getElementById('login-submit');

  fetch('/api/session', { cache: 'no-store' }).then(async (response) => {
    if (!response.ok) return;
    const { user } = await response.json();
    location.replace(user.role === 'sompo' ? '/sompo.html' : '/frota.html');
  }).catch(() => {});

  document.querySelectorAll('[data-demo]').forEach((button) => button.addEventListener('click', () => {
    email.value = button.dataset.demo;
    password.value = '123456789';
    feedback.textContent = '';
    email.focus();
  }));

  document.getElementById('toggle-password').addEventListener('click', (event) => {
    const visible = password.type === 'text';
    password.type = visible ? 'password' : 'text';
    event.currentTarget.textContent = visible ? 'MOSTRAR' : 'OCULTAR';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.textContent = '';
    submit.disabled = true;
    submit.firstChild.textContent = 'AUTENTICANDO ';
    try {
      const response = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.value, password: password.value }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível entrar');
      location.assign(result.redirect);
    } catch (error) {
      feedback.textContent = error.message;
      submit.disabled = false;
      submit.firstChild.textContent = 'ACESSAR PLATAFORMA ';
    }
  });
})();
