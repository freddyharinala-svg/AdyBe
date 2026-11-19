export class NetClient {
  constructor(handlers) {
    this.handlers = handlers || {};
    this.base = this.handlers.backend || (typeof location !== 'undefined' ? location.origin : '');
    this.ws = null;
    this.online = false;
    this.selfId = null;
    this.players = new Map();
    this.zone = null;
    this.room = 'adybe';
    this.roomId = 'adybe';
    this.roomKey = null;
    this.inviteCode = null;
    this.name = 'Combattant';
    this.mode = 'solo';
    this.map = 'forest';
    this.token = '';
    this.phase = 'waiting';
    this.info = null;
    this.retry = null;
    this.manualClose = true;

    this._onOpen = () => {
      this.online = true;
      this.handlers.onStatus && this.handlers.onStatus(true, 'En ligne');
      this.send('join', {
        name: this.name,
        token: this.token,
        mode: this.mode,
        map: this.map,
        room: this.roomId,
        roomId: this.roomId,
        roomKey: this.roomKey,
      });
    };
    this._onMessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch (error) { return; }
      this.handle(message);
    };
    this._onError = () => {
      this.handlers.onStatus && this.handlers.onStatus(false, 'Hors-ligne');
    };
    this._onClose = () => {
      const wasOnline = this.online;
      this.online = false;
      this.selfId = null;
      this.players.clear();
      this.handlers.onStatus && this.handlers.onStatus(false, wasOnline ? 'Connexion perdue' : 'Hors-ligne');
      if (!this.manualClose && this.info) {
        clearTimeout(this.retry);
        this.retry = setTimeout(() => this.connect(this.info), 2500);
      }
    };
  }

  connect(info, legacyRoom, legacyMap) {
    let details = info;
    if (typeof details === 'string') {
      details = { name: details, roomId: legacyRoom, map: legacyMap };
    }
    details = details || {};
    this.info = { ...(this.info || {}), ...details };

    this.name = details.name || this.name;
    this.token = details.token || '';
    this.mode = details.mode || this.mode || 'solo';
    this.map = details.map || this.map || 'forest';
    this.roomId = details.roomId || details.room || this.roomId || 'adybe';
    this.roomKey = details.roomKey || details.key || null;
    this.room = this.roomId;
    this.manualClose = false;
    this._teardown();

    const query = new URLSearchParams();
    query.set('name', String(this.name).slice(0, 16));
    query.set('mode', this.mode);
    query.set('map', this.map);
    query.set('room', this.roomId);
    query.set('roomId', this.roomId);
    if (this.token) query.set('token', this.token);
    if (this.roomKey) query.set('roomKey', this.roomKey);

    let url;
    try {
      const target = new URL('/ws', details.base || this.base || location.origin);
      target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
      target.search = query.toString();
      url = target.toString();
    } catch (error) {
      this.handlers.onStatus && this.handlers.onStatus(false, 'Hors-ligne');
      return;
    }

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      this.handlers.onStatus && this.handlers.onStatus(false, 'Hors-ligne');
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', this._onOpen);
    ws.addEventListener('message', this._onMessage);
    ws.addEventListener('error', this._onError);
    ws.addEventListener('close', this._onClose);
  }

  handle(message) {
    if (!message || typeof message.type !== 'string') return;
    switch (message.type) {
      case 'welcome': {
        this.selfId = message.id || null;
        this.roomId = message.roomId || message.room || this.roomId;
        this.room = this.roomId;
        this.roomKey = message.roomKey || this.roomKey;
        this.inviteCode = message.inviteCode || message.code || this.inviteCode;
        this.mode = message.mode || this.mode;
        this.map = message.map || this.map;
        this.players = new Map(Array.isArray(message.players) ? message.players.map((p) => [p.id, p]) : []);
        this.zone = message.zone || null;
        this._setPhase(message.phase);
        this.handlers.onWelcome && this.handlers.onWelcome(message);
        break;
      }
      case 'lobbyState': {
        this.roomId = message.roomId || this.roomId;
        this.mode = message.mode || this.mode;
        this.map = message.map || this.map;
        this.roomKey = message.roomKey || this.roomKey;
        this.inviteCode = message.inviteCode || this.inviteCode;
        this.players = new Map(Array.isArray(message.players) ? message.players.map((p) => [p.id, p]) : []);
        this._setPhase(message.phase);
        this.handlers.onLobby && this.handlers.onLobby(message);
        break;
      }
      case 'playerJoined':
        this.handlers.onEvent && this.handlers.onEvent('playerJoined', message);
        break;
      case 'playerLeft':
        this.handlers.onEvent && this.handlers.onEvent('playerLeft', message);
        break;
      case 'playerDisconnected':
        this.handlers.onEvent && this.handlers.onEvent('playerDisconnected', message);
        break;
      case 'matchStart':
        this._setPhase('active');
        this.handlers.onMatchStart && this.handlers.onMatchStart(message);
        break;
      case 'worldState':
        this.players = new Map(Array.isArray(message.players) ? message.players.map((p) => [p.id, p]) : []);
        this.zone = message.zone || this.zone;
        this.handlers.onWorld && this.handlers.onWorld(message);
        this.handlers.onSnapshot && this.handlers.onSnapshot(message);
        break;
      case 'snapshot':
        this.players = new Map(Array.isArray(message.players) ? message.players.map((p) => [p.id, p]) : []);
        this.zone = message.zone || this.zone;
        this.handlers.onSnapshot && this.handlers.onSnapshot(message);
        break;
      case 'event':
        this.handlers.onEvent && this.handlers.onEvent(message.event, message.data);
        break;
      case 'matchEnd':
        this._setPhase('finished');
        this.handlers.onMatchEnd && this.handlers.onMatchEnd(message);
        break;
      case 'ready':
        this.handlers.onEvent && this.handlers.onEvent('replayReady', message);
        break;
      case 'pong':
        this.handlers.onPong && this.handlers.onPong(message);
        break;
      default:
        break;
    }
  }

  _setPhase(phase) {
    if (!phase || phase === this.phase) return;
    this.phase = phase;
    this.handlers.onPhase && this.handlers.onPhase(phase);
  }

  send(type, data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify({ type, ...(data || {}) }));
      return true;
    } catch (error) {
      return false;
    }
  }

  sendState(state) {
    return this.send('state', state);
  }

  sendReady(ready = true) {
    return this.send('ready', { ready: ready !== false });
  }

  sendFire(data) {
    return this.send('fire', data);
  }

  sendHit(data) {
    return this.send('hit', data);
  }

  sendChat(text) {
    return this.send('chat', { text: String(text || '').slice(0, 120) });
  }

  sendPing() {
    return this.send('ping', { t: Date.now() });
  }

  sendLeave() {
    const sent = this.send('leave', {});
    this.manualClose = true;
    clearTimeout(this.leaveTimer);
    this.leaveTimer = setTimeout(() => this.close(true), 120);
    return sent;
  }

  _teardown() {
    clearTimeout(this.retry);
    this.retry = null;
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    ws.removeEventListener('open', this._onOpen);
    ws.removeEventListener('message', this._onMessage);
    ws.removeEventListener('error', this._onError);
    ws.removeEventListener('close', this._onClose);
    try { ws.close(); } catch (error) {}
  }

  close(manual = true) {
    this.manualClose = manual !== false;
    clearTimeout(this.leaveTimer);
    this._teardown();
    this.online = false;
    this.selfId = null;
    this.players.clear();
  }
}

export default NetClient;
