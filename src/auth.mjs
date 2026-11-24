const authError = 'The account service could not complete that request.';

export function createAuth(url, apiKey, publicOrigin) {
  if (!url || !apiKey) return null;
  const secure = new URL(publicOrigin).protocol === 'https:';
  const cookiePrefix = secure ? '__Host-' : '';
  const accessName = cookiePrefix + 'ob_access';
  const refreshName = cookiePrefix + 'ob_refresh';

  async function call(path, { method = 'GET', token, payload } = {}) {
    const response = await fetch(new URL('/auth/v1/' + path, url), {
      method,
      headers: { apikey: apiKey, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data };
  }

  function cookies(request) {
    return Object.fromEntries((request.headers.cookie || '').split(';').filter((item) => item.includes('=')).map((item) => {
      const pos = item.indexOf('=');
      return [item.slice(0, pos).trim(), item.slice(pos + 1).trim()];
    }));
  }
  function cookie(name, value, age) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  }
  function writeSession(response, session) {
    response.setHeader('Set-Cookie', [
      cookie(accessName, session.access_token, Math.min(session.expires_in || 3600, 86400)),
      cookie(refreshName, session.refresh_token, 60 * 60 * 24 * 30),
    ]);
  }
  function clearSession(response) {
    response.setHeader('Set-Cookie', [cookie(accessName, '', 0), cookie(refreshName, '', 0)]);
  }
  async function verify(token) {
    const result = await call('user', { token });
    return result.ok && result.data.id ? { id: result.data.id } : null;
  }

  return {
    async user(request, response) {
      const saved = cookies(request);
      if (saved[accessName]) {
        const user = await verify(saved[accessName]);
        if (user) return user;
      }
      if (!saved[refreshName]) return null;
      const result = await call('token?grant_type=refresh_token', { method: 'POST', payload: { refresh_token: saved[refreshName] } });
      if (!result.ok || !result.data.user?.id || !result.data.access_token || !result.data.refresh_token) {
        clearSession(response);
        return null;
      }
      writeSession(response, result.data);
      return { id: result.data.user.id };
    },
    async login(response, email, password) {
      const result = await call('token?grant_type=password', { method: 'POST', payload: { email, password } });
      if (!result.ok || !result.data.access_token || !result.data.refresh_token) return 'Check your email and password.';
      writeSession(response, result.data);
      return null;
    },
    async register(response, email, password) {
      const redirect = encodeURIComponent(new URL('/account/confirm', publicOrigin).href);
      const result = await call('signup?redirect_to=' + redirect, { method: 'POST', payload: { email, password } });
      if (!result.ok) return { error: authError };
      if (!result.data.access_token || !result.data.refresh_token) return { confirmation: true };
      writeSession(response, result.data);
      return {};
    },
    async confirm(response, tokenHash) {
      const result = await call('verify', { method: 'POST', payload: { token_hash: tokenHash, type: 'email' } });
      if (!result.ok || !result.data.access_token || !result.data.refresh_token) return false;
      writeSession(response, result.data);
      return true;
    },
    async completeSession(response, accessToken, refreshToken) {
      if (!(await verify(accessToken))) return false;
      const result = await call('token?grant_type=refresh_token', { method: 'POST', payload: { refresh_token: refreshToken } });
      if (!result.ok || !result.data.access_token || !result.data.refresh_token) return false;
      const supplied = await verify(accessToken);
      if (!supplied || result.data.user?.id !== supplied.id) return false;
      writeSession(response, result.data);
      return true;
    },
    async logout(request, response) {
      const token = cookies(request)[accessName];
      if (token) await call('logout?scope=local', { method: 'POST', token }).catch(() => {});
      clearSession(response);
    },
  };
}
