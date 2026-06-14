const SESSION_COOKIE = 'worth_between_admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8;

const base64UrlEncode = (value) => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlDecode = (value) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const getSigningKey = (secret) => crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(secret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign', 'verify']
);

const sign = async (value, secret) => {
  const key = await getSigningKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return base64UrlEncode(signature);
};

const parseCookies = (request) => Object.fromEntries(
  (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf('=');
      return separatorIndex === -1
        ? [part, '']
        : [part.slice(0, separatorIndex), decodeURIComponent(part.slice(separatorIndex + 1))];
    })
);

const safeEqual = async (left, right, secret) => {
  const key = await getSigningKey(secret);
  const [leftSignature, rightSignature] = await Promise.all([
    crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(left))),
    crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(right)))
  ]);
  const leftBytes = new Uint8Array(leftSignature);
  const rightBytes = new Uint8Array(rightSignature);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < Math.max(leftBytes.length, rightBytes.length); index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
};

export const isAdminAuthConfigured = (env) => Boolean(
  env.ADMIN_EMAIL &&
  env.ADMIN_PASSWORD &&
  env.ADMIN_SESSION_SECRET
);

export const verifyAdminCredentials = async (env, email, password) => {
  if (!isAdminAuthConfigured(env)) return false;
  const [emailMatches, passwordMatches] = await Promise.all([
    safeEqual(String(email || '').trim().toLowerCase(), String(env.ADMIN_EMAIL).trim().toLowerCase(), env.ADMIN_SESSION_SECRET),
    safeEqual(password || '', env.ADMIN_PASSWORD, env.ADMIN_SESSION_SECRET)
  ]);
  return emailMatches && passwordMatches;
};

export const createAdminSessionCookie = async (env) => {
  const payload = base64UrlEncode(JSON.stringify({
    sub: String(env.ADMIN_EMAIL).trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    nonce: crypto.randomUUID()
  }));
  const signature = await sign(payload, env.ADMIN_SESSION_SECRET);
  return `${SESSION_COOKIE}=${encodeURIComponent(`${payload}.${signature}`)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
};

export const clearAdminSessionCookie = () => (
  `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
);

export const getAdminSession = async (request, env) => {
  if (!isAdminAuthConfigured(env)) return null;
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  try {
    const key = await getSigningKey(env.ADMIN_SESSION_SECRET);
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(signature),
      new TextEncoder().encode(payload)
    );
    if (!isValid) return null;

    const session = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    if (!session.exp || session.exp <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
};

export const requireAdminSession = async (request, env) => {
  const session = await getAdminSession(request, env);
  return session || null;
};
