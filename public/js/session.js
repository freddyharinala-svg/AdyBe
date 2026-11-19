const KEY = 'adybe.session';
const DEFAULT_EQUIPPED = { skin: 'skin_recruit', character: null, weaponSkin: null };

function empty() {
  return { token: '', user: null };
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return empty();
    return {
      token: typeof parsed.token === 'string' ? parsed.token : '',
      user: parsed.user && typeof parsed.user === 'object' ? parsed.user : null,
    };
  } catch (error) {
    return empty();
  }
}

function notify() {
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('adybe:session', { detail: Session.get() }));
  }
}

export const Session = {
  get() {
    const value = read();
    return { token: value.token, user: value.user };
  },

  token() {
    return read().token;
  },

  user() {
    return read().user;
  },

  set(session) {
    const next = {
      token: session && typeof session.token === 'string' ? session.token : '',
      user: session && session.user && typeof session.user === 'object' ? session.user : null,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (error) {
    }
    notify();
    return this.get();
  },

  setUser(user) {
    const current = read();
    return this.set({ token: current.token, user: user && typeof user === 'object' ? user : null });
  },

  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch (error) {
    }
    notify();
    return this.get();
  },

  isAdmin() {
    const user = read().user;
    return !!(user && user.role === 'admin');
  },

  equipped() {
    const user = read().user;
    return { ...DEFAULT_EQUIPPED, ...((user && user.equipped) || {}) };
  },

  displayName() {
    const user = read().user;
    if (!user) return 'Invité';
    return String(user.displayName || user.username || 'Joueur');
  },
};

export default Session;
