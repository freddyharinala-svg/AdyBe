export class NetClient {
  constructor(handlers) {
    this.handlers = handlers || {};
    this.ws = null;
    this.online = false;
    this.selfId = null;
    this.players = new Map();
    this.zone = null;
    this.room = 'adybe';
    this.name = 'Combattant';
    this.retry = null;
    this.manualClose = false;
  }

  connect(name, room, map) {
    this.close(true);
    this.name = name;
    this.room = room;
    this.manualClose = false;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const query = new URLSearchParams({ name, room, map });
    const url = `${protocol}//${location.host}/ws?${query.toString()}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      this.handlers.onStatus && this.handlers.onStatus(false, 'Hors-ligne');
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.online = true;
      this.handlers.onStatus && this.handlers.onStatus(true, 'En ligne');
    });
    ws.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch (error) { return; }
      this.handle(message);
    });
    ws.addEventListener('error', () => {
      this.handlers.onStatus && this.handlers.onStatus(false, 'Hors-ligne');
    });
    ws.addEventListener('close', () => {
      const wasOnline = this.online;
      this.online = false;
      this.selfId = null;
      this.players.clear();
      this.handlers.onStatus && this.handlers.onStatus(false, wasOnline ? 'Connexion perdue' : 'Hors-ligne');
      if (!this.manualClose) {
        clearTimeout(this.retry);
        this.retry = setTimeout(() => this.connect(this.name, this.room, 'forest'), 4000);
      }
    });
  }

  handle(message) {
    switch (message.type) {
      case 'welcome':
        this.selfId = message.id;
        this.room = message.room || this.room;
        this.players = new Map(message.players.map((player) => [player.id, player]));
        this.zone = message.zone || null;
        this.handlers.onWelcome && this.handlers.onWelcome(message);
        break;
      case 'snapshot':
        this.players = new Map(message.players.map((player) => [player.id, player]));
        this.zone = message.zone || this.zone;
        this.handlers.onSnapshot && this.handlers.onSnapshot(message);
        break;
      case 'event':
        this.handlers.onEvent && this.handlers.onEvent(message.event, message.data);
        break;
      default:
        break;
    }
  }

  send(type, data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const message = Object.assign({ type }, data || {});
    this.ws.send(JSON.stringify(message));
  }

  close(manual) {
    this.manualClose = manual !== false;
    clearTimeout(this.retry);
    if (this.ws) {
      try { this.ws.close(); } catch (error) { this.ws = null; }
      this.ws = null;
    }
    this.online = false;
    this.selfId = null;
  }
}
