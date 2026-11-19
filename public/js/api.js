import { Session } from './session.js';

function storedBase() {
  try {
    return localStorage.getItem('adybe.backend') || '';
  } catch (error) {
    return '';
  }
}

function queryBase() {
  try {
    return new URLSearchParams(location.search).get('backend') || '';
  } catch (error) {
    return '';
  }
}

const DEFAULT_BASE = 'http://127.0.0.1:3300';

function endpoint(path) {
  const suffix = String(path || '').startsWith('/') ? path : `/${path || ''}`;
  return `${Api.base.replace(/\/+$/, '')}${suffix}`;
}

export const Api = {
  base: storedBase() || queryBase() || DEFAULT_BASE,

  async request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { Accept: 'application/json' };
    if (options.body !== undefined && options.body !== null) headers['Content-Type'] = 'application/json';
    if (options.auth !== false) {
      const token = Session.token();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 12000) : null;
    try {
      const response = await fetch(endpoint(path), {
        method,
        headers,
        body: options.body === undefined || options.body === null ? undefined : JSON.stringify(options.body),
        signal: controller ? controller.signal : undefined,
      });
      let data = {};
      try {
        data = await response.json();
      } catch (error) {
        data = {};
      }
      return { ok: response.ok, status: response.status, data: data || {} };
    } catch (error) {
      return { ok: false, status: 0, data: { error: 'Serveur injoignable.' } };
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  health() {
    return this.request('/api/health', { auth: false });
  },

  config() {
    return this.request('/api/config', { auth: false });
  },

  login(username, password) {
    return this.request('/api/auth/login', { method: 'POST', body: { username, password }, auth: false });
  },

  register(payload) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: {
        username: payload.username,
        password: payload.password,
        displayName: payload.displayName || payload.username,
        email: payload.email || '',
      },
      auth: false,
    });
  },

  logout() {
    return this.request('/api/auth/logout', { method: 'POST' });
  },

  me() {
    return this.request('/api/auth/me');
  },

  profile() {
    return this.request('/api/profile');
  },

  shop() {
    return this.request('/api/shop');
  },

  purchase(itemId) {
    return this.request('/api/shop/purchase', { method: 'POST', body: { itemId } });
  },

  equip(itemId) {
    return this.request('/api/profile/equip', { method: 'POST', body: { itemId } });
  },

  leaderboard() {
    return this.request('/api/leaderboard', { auth: false });
  },

  recordMatch(payload) {
    return this.request('/api/matches', { method: 'POST', body: payload });
  },

  rooms() {
    return this.request('/api/rooms');
  },

  room(id) {
    return this.request(`/api/rooms/${encodeURIComponent(id)}`);
  },

  joinRoom(id) {
    return this.request(`/api/rooms/${encodeURIComponent(id)}/join`, { method: 'POST' });
  },

  createRoom(options = {}) {
    return this.request('/api/rooms/private', {
      method: 'POST',
      body: {
        price: Number(options.price) || 0,
        duration: Number(options.duration) || 300,
        maxPlayers: Number(options.maxPlayers) || 5,
        map: options.map === 'city' ? 'city' : 'forest',
        mode: options.mode || 'solo',
      },
    });
  },

  joinByKey(key) {
    return this.request('/api/rooms/join-key', { method: 'POST', body: { key } });
  },

  replayStart(roomId) {
    return this.request(`/api/rooms/${encodeURIComponent(roomId)}/replay/start`, { method: 'POST' });
  },

  replayVote(roomId, accept) {
    return this.request(`/api/rooms/${encodeURIComponent(roomId)}/replay/vote`, {
      method: 'POST',
      body: { accept: !!accept },
    });
  },

  replayStatus(roomId) {
    return this.request(`/api/rooms/${encodeURIComponent(roomId)}/replay/status`);
  },

  adminStats() {
    return this.request('/api/admin/stats');
  },

  adminPayments() {
    return this.request('/api/admin/payments');
  },

  reviewPayment(id, action, note) {
    return this.request(`/api/admin/payments/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body: { action, note: note || '' },
    });
  },
};

export default Api;
