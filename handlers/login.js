const { authenticate, setSessionCookie, publicUser } = require('../lib/auth');
const { addSafetyLog } = require('../lib/db');
const { json, method } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['POST'])) return;
  try {
    const user = await authenticate(request.body?.email, request.body?.password);
    if (!user) return json(response, 401, { error: 'E-mail ou senha inválidos' });
    setSessionCookie(request, response, user);
    await addSafetyLog('__auth__', 'info', 'user-login', 'Acesso autenticado', { userId: user.id, role: user.role });
    return json(response, 200, { user: publicUser(user), redirect: user.role === 'sompo' ? '/sompo.html' : '/frota.html' });
  } catch (error) {
    return json(response, 500, { error: error.message });
  }
};
