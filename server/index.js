/* eslint-env node */
import process from "process";
import { WebSocketServer } from "ws";

const PORT = process.env.COLLAB_PORT || 4000;
const PERSIST_BASE_URL = process.env.PERSIST_BASE_URL || null; // e.g., http://localhost:3001
const PERSIST_FILENAME = process.env.PERSIST_FILENAME || "share.json";
const PERSIST_FLUSH_MS = Number(process.env.PERSIST_FLUSH_MS || 30000);
const PERSIST_OPS_THRESHOLD = Number(process.env.PERSIST_OPS_THRESHOLD || 50);
const PERSIST_ENABLED = Boolean(PERSIST_BASE_URL);

if (!PERSIST_ENABLED) {
  console.warn("[collab] PERSIST_BASE_URL not set; collaboration will not persist changes");
}

const rooms = new Map();

const server = new WebSocketServer({ port: PORT }, () => {
  console.log(`[collab] WebSocket server listening on ws://localhost:${PORT}`);
});

const now = () => Date.now();
const sanitizeDiagram = (diagram) => {
  if (!diagram) return diagram;
  const clean = JSON.parse(JSON.stringify(diagram));
  delete clean.transform; // keep viewport local
  return clean;
};

const diagramsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

  const snapshot = room.diagram;
  // Strip viewport before persisting to gist to avoid noisy updates
  const payloadDiagram = { ...snapshot };
  delete payloadDiagram.transform;

  try {
    const res = await fetch(`${PERSIST_BASE_URL}/gists/${shareId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: PERSIST_FILENAME,
        content: JSON.stringify(payloadDiagram),
      }),
    });
    if (!res.ok) {
      console.warn(`[collab] persist failed for ${shareId}: ${res.status} ${res.statusText}`);
      return;
    }
    if (room.diagram === snapshot) {
      room.dirty = false;
      room.opCount = 0;
      room.lastFlushed = now();
    }
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
          const sanitized = sanitizeDiagram(message.op.diagram);
          // Drop no-op updates (e.g., viewport/transform-only changes)
          if (!room.diagram || !diagramsEqual(sanitized, room.diagram)) {
            room.diagram = sanitized;
            room.dirty = true;
            room.opCount += 1;
            message.op = { ...message.op, diagram: sanitized };
          } else {
            break;
          }
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

const flushAllRooms = async () => {
  const entries = Array.from(rooms.keys());
  if (!entries.length) return;
  console.log("[collab] Flushing rooms before shutdown:", entries.length);
  await Promise.all(entries.map((shareId) => persistRoom(shareId)));
};

const shutdown = async (signal) => {
  console.log(`[collab] Received ${signal}, shutting down`);
  try {
    await flushAllRooms();
  } catch (e) {
    console.warn("[collab] Error during shutdown flush", e);
  } finally {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
