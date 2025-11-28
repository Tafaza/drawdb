/* eslint-env node */
import { WebSocketServer } from "ws";

const PORT = process.env.COLLAB_PORT || 4000;
const PERSIST_BASE_URL = process.env.PERSIST_BASE_URL || null; // e.g., http://localhost:3001
const PERSIST_FILENAME = process.env.PERSIST_FILENAME || "share.json";
const PERSIST_FLUSH_MS = Number(process.env.PERSIST_FLUSH_MS || 30000);
const PERSIST_OPS_THRESHOLD = Number(process.env.PERSIST_OPS_THRESHOLD || 50);
const PERSIST_ENABLED = Boolean(PERSIST_BASE_URL);

const rooms = new Map();

const server = new WebSocketServer({ port: PORT }, () => {
  console.log(`[collab] WebSocket server listening on ws://localhost:${PORT}`);
});

const now = () => Date.now();

const getRoom = (shareId) => {
  if (!rooms.has(shareId)) {
    rooms.set(shareId, {
      clients: new Set(),
      diagram: null,
      presence: new Map(),
      lastFlushed: 0,
      opCount: 0,
      dirty: false,
    });
  }
  return rooms.get(shareId);
};

const broadcast = (room, payload) => {
  const data = JSON.stringify(payload);
  for (const client of room.clients) {
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  }
};

const sendPresence = (shareId) => {
  const room = rooms.get(shareId);
  if (!room) return;
  const participants = {};
  for (const [clientId, info] of room.presence.entries()) {
    participants[clientId] = { lastSeen: info.lastSeen, mode: info.mode };
  }
  broadcast(room, { type: "presence", participants });
};

const persistRoom = async (shareId) => {
  if (!PERSIST_ENABLED) return;
  const room = rooms.get(shareId);
  if (!room || !room.diagram || !room.dirty) return;

  try {
    const res = await fetch(`${PERSIST_BASE_URL}/gists/${shareId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: PERSIST_FILENAME,
        content: JSON.stringify(room.diagram),
      }),
    });
    if (!res.ok) {
      console.warn(`[collab] persist failed for ${shareId}: ${res.status} ${res.statusText}`);
      return;
    }
    room.dirty = false;
    room.opCount = 0;
    room.lastFlushed = now();
  } catch (e) {
    console.warn(`[collab] persist error for ${shareId}`, e);
  }
};

server.on("connection", (socket) => {
  socket.meta = { shareId: null, clientId: null };

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (e) {
      console.warn("[collab] invalid json", e);
      return;
    }

    if (!message.type) return;

    if (message.type === "hello") {
      const { shareId, clientId, mode } = message;
      if (!shareId || !clientId) {
        socket.send(JSON.stringify({ type: "error", error: "Missing shareId or clientId" }));
        return;
      }
      socket.meta = { shareId, clientId, mode: mode || "edit" };
      const room = getRoom(shareId);
      room.clients.add(socket);
      room.presence.set(clientId, { lastSeen: now(), mode: mode || "edit" });

      if (room.diagram) {
        socket.send(
          JSON.stringify({
            type: "op",
            clientId: "server",
            op: { kind: "doc:replace", diagram: room.diagram },
          }),
        );
      }

      sendPresence(shareId);
      return;
    }

    const { shareId, clientId } = socket.meta;
    if (!shareId || !clientId) return;
    const room = getRoom(shareId);

    switch (message.type) {
      case "heartbeat": {
        room.presence.set(clientId, {
          lastSeen: now(),
          mode: room.presence.get(clientId)?.mode || "edit",
        });
        sendPresence(shareId);
        break;
      }
      case "op": {
        if (message.op?.kind === "doc:replace") {
          room.diagram = message.op.diagram;
          room.dirty = true;
          room.opCount += 1;
        }
        broadcast(room, { type: "op", clientId, op: message.op });
        if (
          PERSIST_ENABLED &&
          room.dirty &&
          (room.opCount >= PERSIST_OPS_THRESHOLD ||
            now() - room.lastFlushed > PERSIST_FLUSH_MS)
        ) {
          persistRoom(shareId);
        }
        break;
      }
      default:
        break;
    }
  });

  socket.on("close", () => {
    const { shareId, clientId } = socket.meta;
    if (!shareId || !rooms.has(shareId)) return;
    const room = rooms.get(shareId);
    room.clients.delete(socket);
    room.presence.delete(clientId);

    if (room.clients.size === 0) {
      if (room.dirty) {
        persistRoom(shareId);
      }
      rooms.delete(shareId);
      return;
    }
    sendPresence(shareId);
  });
});

// periodic cleanup/presence refresh
setInterval(() => {
  const cutoff = now() - 30000;
  for (const [shareId, room] of rooms.entries()) {
    for (const [clientId, info] of room.presence.entries()) {
      if (info.lastSeen < cutoff) {
        room.presence.delete(clientId);
      }
    }
    if (
      PERSIST_ENABLED &&
      room.dirty &&
      now() - room.lastFlushed > PERSIST_FLUSH_MS
    ) {
      persistRoom(shareId);
    }
    sendPresence(shareId);
  }
}, 10000);
