const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];
const MAX_RECONNECT_ATTEMPTS = 10;

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
    this.reconnectTimeout = null;
    this.isConnecting = false;
    this.isDisconnected = false; // prevent reconnect after explicit disconnect
  }

  connect() {
    if (this.isConnecting) {
      console.debug("[collab] Already connecting, skipping duplicate connect()");
      return;
    }
    if (this.isDisconnected) {
      console.debug("[collab] Client was disconnected, not reconnecting");
      return;
    }
    if (!this.url || !this.shareId) {
      console.debug("[collab] Missing url or shareId, not connecting");
      return;
    }
    if (this.socket) {
      const state = this.socket.readyState;
      if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) {
        console.debug("[collab] Socket already open/connecting, skipping");
        return;
      }
    }

    this.isConnecting = true;
    this._updateStatus("connecting");

    try {
      this.socket = new WebSocket(this.url);
    } catch (e) {
      console.error("[collab] Failed to create WebSocket", e);
      this.isConnecting = false;
      this._scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.isConnecting = false;
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
        console.error("[collab] Failed to parse message", e);
      }
    };

    this.socket.onerror = (e) => {
      console.warn("[collab] Socket error", e);
      this.isConnecting = false;
      this._updateStatus("error");
    };

    this.socket.onclose = () => {
      this.isConnecting = false;
      this._updateStatus("closed");
      this._stopHeartbeat();

      if (!this.isDisconnected) {
        this._scheduleReconnect();
      }
    };
  }

  disconnect() {
    this.isDisconnected = true;
    this.isConnecting = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this._stopHeartbeat();
    this.reconnectAttempts = 0;

    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;

      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close(1000, "Client disconnect");
      }
      this.socket = null;
    }

    this._updateStatus("closed");
  }

  send(type, payload) {
    const message = { type, shareId: this.shareId, clientId: this.clientId, ...payload };
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      if (this.pending.length < 100) {
        this.pending.push(message);
      }
      return;
    }
    this._send(message);
  }

  _send(message) {
    try {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify(message));
      }
    } catch (e) {
      console.warn("[collab] Failed to send message", e);
    }
  }

  _flushPending() {
    if (!this.pending.length) return;
    const queued = [...this.pending];
    this.pending = [];
    queued.forEach((msg) => this._send(msg));
  }

  _scheduleReconnect() {
    if (this.isDisconnected) {
      return;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn("[collab] Max reconnect attempts reached, giving up");
      this._updateStatus("failed");
      return;
    }

    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempts += 1;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
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
  }
}
