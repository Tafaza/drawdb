const RECONNECT_DELAYS_MS = [1000, 2000, 5000];

const READY_STATES = {
  0: "connecting",
  1: "open",
  2: "closing",
  3: "closed",
};

export class CollabClient {
  constructor({ url, shareId, mode = "edit", clientId, onMessage, onStatus }) {
    this.url = url;
    this.shareId = shareId;
    this.mode = mode;
    this.clientId = clientId;
    this.onMessage = onMessage;
    this.onStatus = onStatus;

    this.socket = null;
    this.reconnectAttempts = 0;
    this.pending = [];
    this.heartbeatInterval = null;
  }

  connect() {
    if (!this.url || !this.shareId) {
      return;
    }

    this._updateStatus("connecting");
    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      this.reconnectAttempts = 0;
      this._updateStatus("open");
      this._send({
        type: "hello",
        shareId: this.shareId,
        mode: this.mode,
        clientId: this.clientId,
      });
      this._flushPending();
      this._startHeartbeat();
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onMessage?.(data);
      } catch (e) {
        console.error("Failed to parse collab message", e);
      }
    };

    this.socket.onerror = (e) => {
      console.warn("Collab socket error", e);
      this._updateStatus("error");
    };

    this.socket.onclose = () => {
      this._updateStatus("closed");
      this._stopHeartbeat();
      this._scheduleReconnect();
    };
  }

  disconnect() {
    this._stopHeartbeat();
    this.reconnectAttempts = 0;
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
    }
    this._updateStatus("closed");
  }

  send(type, payload) {
    const message = { type, shareId: this.shareId, clientId: this.clientId, ...payload };
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.pending.push(message);
      return;
    }
    this._send(message);
  }

  _send(message) {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch (e) {
      console.warn("Failed to send collab message", e);
    }
  }

  _flushPending() {
    if (!this.pending.length) return;
    const queued = [...this.pending];
    this.pending = [];
    queued.forEach((msg) => this._send(msg));
  }

  _scheduleReconnect() {
    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempts += 1;
    setTimeout(() => this.connect(), delay);
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this._send({ type: "heartbeat", shareId: this.shareId, clientId: this.clientId });
      }
    }, 10000);
  }

  _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  _updateStatus(status) {
    this.onStatus?.(status);
    if (!this.socket) return;
    const readableState = READY_STATES[this.socket.readyState];
    if (readableState && readableState !== status) {
      this.onStatus?.(readableState);
    }
  }
}
