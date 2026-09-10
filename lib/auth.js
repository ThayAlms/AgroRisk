const crypto = require('node:crypto');
const { getUserByEmail } = require('./db');
const { verifyPassword } = require('./security');

const COOKIE_NAME = 'agrorisk_session';
const SESSION_SECONDS = 8 * 60 * 60;

function sessionSecret() {
  const configured = process.env.APP_SESSION_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') throw new Error('APP_SESSION_SECRET não configurado');
  return 'agrorisk-local-development-secret-change-me';
}

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

function encodeSession(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    customerId: user.customerId || null,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readSession(request) {
  try {
    const cookies = Object.fromEntries(String(request.headers?.cookie || '').split(';').map((item) => {
      const separator = item.indexOf('=');
      return separator < 0 ? ['', ''] : [item.slice(0, separator).trim(), item.slice(separator + 1).trim()];
    }).filter(([key]) => key));
    const [payload, signature] = String(cookies[COOKIE_NAME] || '').split('.');
    if (!payload || !signature) return null;
    const expected = Buffer.from(sign(payload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.exp || session.exp <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

function cookieOptions(request, maxAge = SESSION_SECONDS) {
  const secure = process.env.NODE_ENV === 'production' || request.headers?.['x-forwarded-proto'] === 'https';
  return `${COOKIE_NAME}=__VALUE__; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function setSessionCookie(request, response, user) {
  response.setHeader('Set-Cookie', cookieOptions(request).replace('__VALUE__', encodeSession(user)));
}

function clearSessionCookie(request, response) {
  response.setHeader('Set-Cookie', cookieOptions(request, 0).replace('__VALUE__', ''));
}

async function authenticate(email, password) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !password) return null;
  const user = await getUserByEmail(normalizedEmail);
  if (!user || user.active === false || !verifyPassword(password, user.passwordHash)) return null;
  return user;
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id || user.sub, email: user.email, name: user.name, role: user.role, customerId: user.customerId || null };
}

module.exports = { COOKIE_NAME, authenticate, readSession, setSessionCookie, clearSessionCookie, publicUser };
