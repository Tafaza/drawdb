import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollabClient } from "../collab/client";
import { nanoid } from "nanoid";

export const CollabContext = createContext({
  enabled: false,
  connection: "disabled",
  clientId: "",
  participants: {},
  requestedMode: "edit",
  effectiveMode: "edit",
  mode: "edit",
  editorClientId: null,
  lastError: null,
  persist: { status: "idle", lastFlushed: null },
  sendOp: () => {},
  persistNow: () => {},
  requestEdit: () => {},
  releaseEdit: () => {},
});

export function CollabProvider({
  shareId,
  mode = "edit",
  clientId: clientIdProp,
  onRemoteOp,
  onPersisted,
  onPersistError,
  onMode,
  onConnection,
  apiRef,
  children,
}) {
  const [connection, setConnection] = useState("disabled");
  const [participants, setParticipants] = useState({});
  const [lastError, setLastError] = useState(null);
  const [persist, setPersist] = useState({ status: "idle", lastFlushed: null });
  const [effectiveMode, setEffectiveMode] = useState(mode === "view" ? "view" : "edit");
  const [editorClientId, setEditorClientId] = useState(null);
  const clientRef = useRef(null);
  const clientIdRef = useRef(clientIdProp || nanoid());
  const clientId = clientIdRef.current;

  const enabled = Boolean(import.meta.env.VITE_COLLAB_WS_URL && shareId);
  const modeFromParam = mode === "view" ? "view" : "edit";

  const onRemoteOpRef = useRef(onRemoteOp);
  useEffect(() => {
    onRemoteOpRef.current = onRemoteOp;
  }, [onRemoteOp]);

  const onPersistedRef = useRef(onPersisted);
  useEffect(() => {
    onPersistedRef.current = onPersisted;
  }, [onPersisted]);

  const onPersistErrorRef = useRef(onPersistError);
  useEffect(() => {
    onPersistErrorRef.current = onPersistError;
  }, [onPersistError]);

  const onModeRef = useRef(onMode);
  useEffect(() => {
    onModeRef.current = onMode;
  }, [onMode]);

  const onConnectionRef = useRef(onConnection);
  useEffect(() => {
    onConnectionRef.current = onConnection;
  }, [onConnection]);

  const handleMessage = useCallback((message) => {
    if (!message?.type) return;

    switch (message.type) {
      case "presence":
        setParticipants(message.participants ?? {});
        break;
      case "mode": {
        const nextMode = message.mode === "edit" ? "edit" : "view";
        setEffectiveMode(nextMode);
        setEditorClientId(message.editorClientId ?? null);
        onModeRef.current?.(message);
        break;
      }
      case "op":
        onRemoteOpRef.current?.(message);
        break;
      case "error":
        setLastError(message.error);
        break;
      case "persisted":
        setPersist({
          status: "ok",
          lastFlushed: message.lastFlushed ?? Date.now(),
          revision: message.revision ?? null,
          updatedAt: message.updatedAt ?? null,
          persistedVersion: message.persistedVersion ?? null,
          noChanges: Boolean(message.noChanges),
        });
        onPersistedRef.current?.(message);
        break;
      case "persist_error":
        setPersist((prev) => ({
          status: "error",
          lastFlushed: prev.lastFlushed,
          error: message.message || message.error,
        }));
        onPersistErrorRef.current?.(message);
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setConnection("disabled");
      setEffectiveMode(modeFromParam);
      setEditorClientId(null);
      return;
    }

    const client = new CollabClient({
      url: import.meta.env.VITE_COLLAB_WS_URL,
      shareId,
      mode: modeFromParam,
      clientId,
      onMessage: handleMessage,
      onStatus: (status) => {
        setConnection(status);
        onConnectionRef.current?.(status);
      },
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [enabled, shareId, modeFromParam, clientId, handleMessage]);

  const sendOp = useCallback((op) => {
    if (!clientRef.current) return;
    clientRef.current.send("op", { op });
  }, []);

  const persistNow = useCallback(() => {
    if (!clientRef.current) return;
    setPersist((prev) => ({ ...prev, status: "saving" }));
    clientRef.current.send("persist_now", {});
  }, []);

  const requestEdit = useCallback(() => {
    if (!clientRef.current) return;
    clientRef.current.send("request_edit", {});
  }, []);

  const releaseEdit = useCallback(() => {
    if (!clientRef.current) return;
    clientRef.current.send("release_edit", {});
  }, []);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      persistNow,
      requestEdit,
      releaseEdit,
      connection,
      effectiveMode,
      requestedMode: modeFromParam,
      editorClientId,
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, persistNow, requestEdit, releaseEdit, connection, effectiveMode, modeFromParam, editorClientId]);

  const value = useMemo(
    () => ({
      enabled,
      connection,
      clientId,
      participants,
      requestedMode: modeFromParam,
      effectiveMode,
      mode: effectiveMode,
      editorClientId,
      lastError,
      persist,
      sendOp,
      persistNow,
      requestEdit,
      releaseEdit,
    }),
    [
      enabled,
      connection,
      clientId,
      participants,
      modeFromParam,
      effectiveMode,
      editorClientId,
      lastError,
      persist,
      sendOp,
      persistNow,
      requestEdit,
      releaseEdit,
    ],
  );

  return <CollabContext.Provider value={value}>{children}</CollabContext.Provider>;
}
