/* eslint-env node */
import process from "process";
import { WebSocketServer } from "ws";

const PORT = process.env.COLLAB_PORT || 4000;
const PERSIST_BASE_URL = process.env.PERSIST_BASE_URL || null; // e.g., http://localhost:3001
const PERSIST_FILENAME = process.env.PERSIST_FILENAME || "share.json";
const PERSIST_FLUSH_MS = Number(process.env.PERSIST_FLUSH_MS || 30000);
const PERSIST_OPS_THRESHOLD = Number(process.env.PERSIST_OPS_THRESHOLD || 50);
const PERSIST_ENABLED = Boolean(PERSIST_BASE_URL);
const ROOM_IDLE_TTL_MS = Number(process.env.ROOM_IDLE_TTL_MS || 60000);
const EDITOR_TTL_MS = Number(process.env.EDITOR_TTL_MS || 30000);
const FORCE_EDIT_ENABLED = process.env.COLLAB_FORCE_EDIT_ENABLED === "true";
const EDIT_REQUEST_DISMISS_MS = Number(process.env.COLLAB_EDIT_REQUEST_DISMISS_MS || 60000);

if (!PERSIST_ENABLED) {
  console.warn("[collab] PERSIST_BASE_URL not set; collaboration will not persist changes");
}

const rooms = new Map();

const server = new WebSocketServer({ port: PORT }, () => {
  console.log(`[collab] WebSocket server listening on ws://localhost:${PORT}`);
});

const now = () => Date.now();
const PERSIST_BACKOFF_BASE_MS = 10000;
const PERSIST_BACKOFF_RATE_LIMIT_BASE_MS = 60000;
const PERSIST_BACKOFF_MAX_MS = 5 * 60 * 1000;
const CLIENT_NAME_MAX_LEN = 48;

const sanitizeClientName = (value) => {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CLIENT_NAME_MAX_LEN);
};

const schedulePersistBackoff = (room, status) => {
  const base =
    status === 403 || status === 429
      ? PERSIST_BACKOFF_RATE_LIMIT_BASE_MS
      : PERSIST_BACKOFF_BASE_MS;
  const prev = room.backoffMs || 0;
  const next = prev ? Math.min(prev * 2, PERSIST_BACKOFF_MAX_MS) : base;
  room.backoffMs = next;
  room.backoffUntil = now() + next;
};
const sanitizeDiagram = (diagram) => {
  if (!diagram) return diagram;
  const clean = JSON.parse(JSON.stringify(diagram));
  delete clean.transform; // keep viewport local
  return clean;
};

const diagramsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const coalescePayload = (raw) => {
  if (!raw) return {};
  return raw.data || raw;
};

const extractRemoteMeta = (raw) => {
  const payload = coalescePayload(raw);
  const latestHistory = payload?.history?.[0];
  const revision =
    latestHistory?.version ||
    latestHistory?.sha ||
    latestHistory?.commit ||
    latestHistory?.commit_id ||
    payload?.version ||
    payload?.sha ||
    payload?.revision ||
    null;
  const updatedAt =
    latestHistory?.committed_at || payload?.updated_at || payload?.updatedAt || null;

  return { revision, updatedAt };
};

const fetchRemoteMeta = async (shareId) => {
  let revision = null;
  let updatedAt = null;

  try {
    const metaRes = await fetch(`${PERSIST_BASE_URL}/gists/${shareId}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (metaRes.ok) {
      const metaPayload = await metaRes.json();
      const meta = extractRemoteMeta(metaPayload);
      revision = meta.revision || revision;
      updatedAt = meta.updatedAt || updatedAt;
    }
  } catch (e) {
    // ignore
  }

  if (revision) return { revision, updatedAt };

  try {
    const commitsRes = await fetch(
      `${PERSIST_BASE_URL}/gists/${shareId}/commits?per_page=1&page=1`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      },
    );
    if (!commitsRes.ok) return { revision, updatedAt };
    const commitsPayload = await commitsRes.json();
    const commits = coalescePayload(commitsPayload);
    const first = Array.isArray(commits) ? commits?.[0] : commits?.data?.[0];
    return {
      revision: first?.version || first?.sha || first?.commit || first?.commit_id || revision,
      updatedAt: first?.committed_at || first?.updated_at || updatedAt,
    };
  } catch (e) {
    return { revision, updatedAt };
  }
};

const getRoom = (shareId) => {
  if (!rooms.has(shareId)) {
    rooms.set(shareId, {
      clients: new Set(),
      diagram: null,
      presence: new Map(),
      dismissedEditRequests: new Map(),
      lastFlushed: 0,
      opCount: 0,
      dirty: false,
      version: 0,
      lastPersistedVersion: 0,
      lastPersistedRevision: null,
      lastPersistedUpdatedAt: null,
      persisting: false,
      backoffUntil: 0,
      backoffMs: 0,
      editorClientId: null,
      editorSince: 0,
      editorTtlMs: EDITOR_TTL_MS,
      emptySince: null,
    });
  }
  return rooms.get(shareId);
};

const isEditRequestDismissed = (room, editorClientId, fromClientId) => {
  if (!editorClientId || !fromClientId) return false;
  const key = `${editorClientId}:${fromClientId}`;
  const until = room.dismissedEditRequests.get(key) || 0;
  if (!until) return false;
  if (now() < until) return true;
  room.dismissedEditRequests.delete(key);
  return false;
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
    participants[clientId] = { lastSeen: info.lastSeen, mode: info.mode, name: info.name || "" };
  }
  broadcast(room, { type: "presence", participants });
};

const persistRoom = async (shareId, { force = false } = {}) => {
  if (!PERSIST_ENABLED) return;
  const room = rooms.get(shareId);
  if (!room || !room.diagram || !room.dirty) return;

  if (room.persisting) return;
  if (!force && room.backoffUntil && now() < room.backoffUntil) return;

  room.persisting = true;
  const snapshot = room.diagram;
  const snapshotVersion = room.version || 0;
  const opCountAtStart = room.opCount || 0;
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
      schedulePersistBackoff(room, res.status);
      broadcast(room, {
        type: "persist_error",
        error: `${res.status} ${res.statusText}`,
        message: `${res.status} ${res.statusText}`,
      });
      return;
    }

    let patchPayload = null;
    try {
      patchPayload = await res.json();
    } catch (e) {
      patchPayload = null;
    }

    let { revision, updatedAt } = extractRemoteMeta(patchPayload);
    if (!revision || !updatedAt) {
      const meta = await fetchRemoteMeta(shareId);
      revision = revision || meta.revision || null;
      updatedAt = updatedAt || meta.updatedAt || null;
    }

    // Successful persist: reset backoff and counters to avoid bursty re-flush.
    room.backoffUntil = 0;
    room.backoffMs = 0;
    room.lastFlushed = now();

    if (room.version === snapshotVersion && room.diagram === snapshot) {
      room.dirty = false;
      room.lastPersistedVersion = snapshotVersion;
      room.lastPersistedRevision = revision || room.lastPersistedRevision;
      room.lastPersistedUpdatedAt = updatedAt || room.lastPersistedUpdatedAt;
      room.opCount = 0;
      broadcast(room, {
        type: "persisted",
        lastFlushed: room.lastFlushed,
        revision,
        updatedAt,
        persistedVersion: snapshotVersion,
        noChanges: false,
      });
    } else {
      const remaining = (room.opCount || 0) - opCountAtStart;
      room.opCount = remaining > 0 ? remaining : room.opCount;
      setTimeout(() => {
        if (rooms.has(shareId)) {
          persistRoom(shareId);
        }
      }, 0);
    }
  } catch (e) {
    console.warn(`[collab] persist error for ${shareId}`, e);
    schedulePersistBackoff(room);
    broadcast(room, { type: "persist_error", error: "network", message: "network" });
  } finally {
    room.persisting = false;
  }
};

const sendJson = (socket, payload) => {
  try {
    socket.send(JSON.stringify(payload));
  } catch (e) {
    // ignore
  }
};

const roomMeta = (room) => ({
  roomVersion: room.version || 0,
  lastPersistedVersion: room.lastPersistedVersion || 0,
  dirty: Boolean(room.dirty),
  revision: room.lastPersistedRevision || null,
  updatedAt: room.lastPersistedUpdatedAt || null,
});

const setPresence = (room, clientId, lastSeen, { clientName } = {}) => {
  const prev = room.presence.get(clientId) || {};
  const nextName =
    clientName !== undefined ? sanitizeClientName(clientName) : prev.name || "";
  room.presence.set(clientId, {
    lastSeen,
    mode: room.editorClientId === clientId ? "edit" : "view",
    name: nextName,
  });
};

const releaseEditor = (room, reason) => {
  if (!room.editorClientId) return;
  const prevEditor = room.editorClientId;
  room.editorClientId = null;
  room.editorSince = 0;
  const prev = room.presence.get(prevEditor);
  if (prev) room.presence.set(prevEditor, { ...prev, mode: "view" });
  broadcast(room, {
    type: "mode",
    mode: "view",
    reason: reason || "expired",
    editorClientId: null,
  });
};

const ensureEditorValid = (room) => {
  if (!room.editorClientId) return;
  const info = room.presence.get(room.editorClientId);
  if (!info) {
    releaseEditor(room, "expired");
    return;
  }
  if (now() - info.lastSeen > (room.editorTtlMs || EDITOR_TTL_MS)) {
    releaseEditor(room, "expired");
  }
};

const sendToClientId = (room, targetClientId, payload) => {
  for (const client of room.clients) {
    if (client.meta?.clientId === targetClientId && client.readyState === client.OPEN) {
      sendJson(client, payload);
    }
  }
};

server.on("connection", (socket) => {
  socket.meta = {
    shareId: null,
    clientId: null,
    clientName: "",
    requestedMode: "view",
    effectiveMode: "view",
  };

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
      const { shareId, clientId, mode, clientName } = message;
      if (!shareId || !clientId) {
        socket.send(JSON.stringify({ type: "error", error: "Missing shareId or clientId" }));
        return;
      }
      const room = getRoom(shareId);
      room.emptySince = null;

      ensureEditorValid(room);

      const requestedMode = mode === "view" ? "view" : "edit";
      let effectiveMode = "view";

      if (requestedMode === "edit") {
        if (!room.editorClientId || room.editorClientId === clientId) {
          room.editorClientId = clientId;
          room.editorSince = now();
          effectiveMode = "edit";
        } else {
          effectiveMode = "view";
        }
      } else {
        effectiveMode = "view";
        if (room.editorClientId === clientId) {
          releaseEditor(room, "released");
        }
      }

      socket.meta = {
        shareId,
        clientId,
        clientName: sanitizeClientName(clientName),
        requestedMode,
        effectiveMode,
      };
      room.clients.add(socket);
      setPresence(room, clientId, now(), { clientName: socket.meta.clientName });

      sendJson(socket, {
        type: "mode",
        mode: effectiveMode,
        reason: effectiveMode === "edit" ? "granted" : requestedMode === "edit" ? "locked" : "granted",
        editorClientId: room.editorClientId,
        ...roomMeta(room),
      });

      if (room.diagram) {
        socket.send(
          JSON.stringify({
            type: "op",
            clientId: "server",
            op: { kind: "doc:replace", diagram: room.diagram, version: room.version },
          }),
        );
      }

      sendPresence(shareId);
      return;
    }

    const { shareId, clientId } = socket.meta;
    if (!shareId || !clientId) return;
    const room = getRoom(shareId);
    ensureEditorValid(room);

    switch (message.type) {
      case "heartbeat": {
        setPresence(room, clientId, now());
        sendPresence(shareId);
        break;
      }
      case "set_client_name": {
        const nextName = sanitizeClientName(message.clientName);
        socket.meta.clientName = nextName;
        setPresence(room, clientId, now(), { clientName: nextName });
        sendPresence(shareId);
        break;
      }
      case "request_release": {
        if (!room.editorClientId || room.editorClientId === clientId) break;
        setPresence(room, clientId, now());
        if (isEditRequestDismissed(room, room.editorClientId, clientId)) {
          sendJson(socket, {
            type: "edit_request_denied",
            reason: "dismissed",
            editorClientId: room.editorClientId,
          });
          sendPresence(shareId);
          break;
        }
        sendToClientId(room, room.editorClientId, {
          type: "edit_request",
          fromClientId: clientId,
          at: now(),
        });
        sendJson(socket, { type: "edit_request_sent", editorClientId: room.editorClientId });
        sendPresence(shareId);
        break;
      }
      case "dismiss_edit_request": {
        if (!room.editorClientId) break;
        if (room.editorClientId !== clientId) break;
        const targetClientId = message.targetClientId;
        if (!targetClientId) break;
        room.dismissedEditRequests.set(
          `${clientId}:${targetClientId}`,
          now() + EDIT_REQUEST_DISMISS_MS,
        );
        sendJson(socket, { type: "edit_request_dismissed", targetClientId });
        sendToClientId(room, targetClientId, {
          type: "edit_request_denied",
          reason: "dismissed",
          editorClientId: clientId,
        });
        sendPresence(shareId);
        break;
      }
      case "request_edit": {
        ensureEditorValid(room);
        if (!room.editorClientId || room.editorClientId === clientId) {
          room.editorClientId = clientId;
          room.editorSince = now();
          socket.meta.effectiveMode = "edit";
          setPresence(room, clientId, now());
          sendJson(socket, {
            type: "mode",
            mode: "edit",
            reason: "granted",
            editorClientId: clientId,
            ...roomMeta(room),
          });
        } else {
          socket.meta.effectiveMode = "view";
          setPresence(room, clientId, now());
          sendJson(socket, {
            type: "mode",
            mode: "view",
            reason: "locked",
            editorClientId: room.editorClientId,
            ...roomMeta(room),
          });
        }
        sendPresence(shareId);
        break;
      }
      case "force_edit": {
        ensureEditorValid(room);
        if (!FORCE_EDIT_ENABLED) {
          sendJson(socket, {
            type: "force_edit_denied",
            reason: "disabled",
            editorClientId: room.editorClientId ?? null,
          });
          break;
        }

        const prevEditor = room.editorClientId;
        room.editorClientId = clientId;
        room.editorSince = now();

        for (const client of room.clients) {
          const id = client.meta?.clientId;
          if (!id) continue;
          client.meta.effectiveMode = id === clientId ? "edit" : "view";
          const prev = room.presence.get(id);
          if (prev) {
            room.presence.set(id, { ...prev, mode: id === clientId ? "edit" : "view" });
          }
        }

        const meta = { editorClientId: clientId, ...roomMeta(room) };
        broadcast(room, { type: "mode", mode: "view", reason: "forced", ...meta });
        sendToClientId(room, clientId, { type: "mode", mode: "edit", reason: "forced", ...meta });

        if (prevEditor && prevEditor !== clientId) {
          sendToClientId(room, prevEditor, { type: "mode", mode: "view", reason: "forced", ...meta });
        }

        sendPresence(shareId);
        break;
      }
      case "release_edit": {
        if (room.editorClientId === clientId) {
          releaseEditor(room, "released");
        }
        socket.meta.effectiveMode = "view";
        setPresence(room, clientId, now());
        sendJson(socket, {
          type: "mode",
          mode: "view",
          reason: "released",
          editorClientId: null,
          ...roomMeta(room),
        });
        sendPresence(shareId);
        break;
      }
      case "persist_now": {
        if (!PERSIST_ENABLED) {
          sendJson(socket, { type: "persist_error", error: "disabled", message: "disabled" });
          break;
        }
        if (!room.dirty) {
          sendJson(socket, {
            type: "persisted",
            lastFlushed: room.lastFlushed || now(),
            revision: room.lastPersistedRevision || null,
            updatedAt: room.lastPersistedUpdatedAt || null,
            persistedVersion: room.lastPersistedVersion || 0,
            noChanges: true,
          });
          break;
        }
        persistRoom(shareId, { force: true });
        break;
      }
      case "op": {
        if (socket.meta.effectiveMode !== "edit") break;
        if (!room.editorClientId || room.editorClientId !== clientId) break;

        if (message.op?.kind === "doc:replace") {
          const sanitized = sanitizeDiagram(message.op.diagram);
          // Drop no-op updates (e.g., viewport/transform-only changes)
          if (!room.diagram || !diagramsEqual(sanitized, room.diagram)) {
            room.diagram = sanitized;
            room.dirty = true;
            room.opCount += 1;
            room.version = (room.version || 0) + 1;
            message.op = { ...message.op, diagram: sanitized, version: room.version };
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

    const wasEditor = room.editorClientId === clientId;
    if (wasEditor) {
      releaseEditor(room, "expired");
    }

    if (wasEditor && room.clients.size > 0 && room.dirty) {
      persistRoom(shareId, { force: true });
    }

    if (room.clients.size === 0) {
      if (room.dirty) {
        persistRoom(shareId, { force: true });
      }
      room.emptySince = room.emptySince || now();
      return;
    }
    sendPresence(shareId);
  });
});

// periodic cleanup/presence refresh
let tickInProgress = false;
setInterval(() => {
  if (tickInProgress) return;
  tickInProgress = true;

  const run = async () => {
  const cutoff = now() - 30000;
  for (const [shareId, room] of rooms.entries()) {
    ensureEditorValid(room);

    for (const [clientId, info] of room.presence.entries()) {
      if (info.lastSeen < cutoff) {
        room.presence.delete(clientId);
      }
    }

    if (room.editorClientId && !room.presence.has(room.editorClientId)) {
      releaseEditor(room, "expired");
    }

    if (
      PERSIST_ENABLED &&
      room.dirty &&
      now() - room.lastFlushed > PERSIST_FLUSH_MS
    ) {
      persistRoom(shareId);
    }

    if (
      room.clients.size === 0 &&
      room.emptySince &&
      now() - room.emptySince > ROOM_IDLE_TTL_MS
    ) {
      if (room.persisting) continue;
      if (room.dirty) {
        await persistRoom(shareId, { force: true });
      }
      rooms.delete(shareId);
      continue;
    }

    sendPresence(shareId);
  }
  };

  run()
    .catch(() => {})
    .finally(() => {
      tickInProgress = false;
    });
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
