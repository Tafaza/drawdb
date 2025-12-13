import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollabClient } from "../collab/client";
import { nanoid } from "nanoid";
import { generateRandomClientName, loadClientName, saveClientName } from "../utils/clientName";

export const CollabContext = createContext({
  enabled: false,
  connection: "disabled",
  clientId: "",
  clientName: "",
  setClientName: () => {},
  participants: {},
  requestedMode: "edit",
  effectiveMode: "edit",
  mode: "edit",
  editorClientId: null,
  editRequest: null,
  editRequestDenied: null,
  forceEditDenied: null,
  lastError: null,
  persist: { status: "idle", lastFlushed: null },
  sendOp: () => {},
  persistNow: () => {},
  requestEdit: () => {},
  releaseEdit: () => {},
  requestRelease: () => {},
  forceEdit: () => {},
  dismissEditRequest: () => {},
  clearEditRequest: () => {},
  clearEditRequestDenied: () => {},
  clearForceEditDenied: () => {},
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
  const EDIT_REQUEST_TTL_MS = 15000;
  const [connection, setConnection] = useState("disabled");
  const [participants, setParticipants] = useState({});
  const [lastError, setLastError] = useState(null);
  const [persist, setPersist] = useState({ status: "idle", lastFlushed: null });
  const [effectiveMode, setEffectiveMode] = useState(mode === "view" ? "view" : "edit");
  const [editorClientId, setEditorClientId] = useState(null);
  const [editRequest, setEditRequest] = useState(null);
  const [editRequestDenied, setEditRequestDenied] = useState(null);
  const [forceEditDenied, setForceEditDenied] = useState(null);
  const [clientName, setClientNameState] = useState(
    () => loadClientName() || generateRandomClientName(),
  );
  const clientNameRef = useRef(clientName);
  const editRequestTimeoutRef = useRef(null);
  const clientRef = useRef(null);
  const clientIdRef = useRef(clientIdProp || nanoid());
  const clientId = clientIdRef.current;

  const enabled = Boolean(import.meta.env.VITE_COLLAB_WS_URL && shareId);
  const modeFromParam = mode === "view" ? "view" : "edit";
  const modeRef = useRef(modeFromParam);

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

  const clearEditRequest = useCallback(() => {
    if (editRequestTimeoutRef.current) {
      clearTimeout(editRequestTimeoutRef.current);
      editRequestTimeoutRef.current = null;
    }
    setEditRequest(null);
  }, []);

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
      case "edit_request": {
        if (editRequestTimeoutRef.current) {
          clearTimeout(editRequestTimeoutRef.current);
          editRequestTimeoutRef.current = null;
        }
        setEditRequest({
          fromClientId: message.fromClientId ?? null,
          fromClientName: message.fromClientName || message.clientName || null,
          at: message.at ?? Date.now(),
        });
        editRequestTimeoutRef.current = setTimeout(() => {
          editRequestTimeoutRef.current = null;
          setEditRequest(null);
        }, EDIT_REQUEST_TTL_MS);
        break;
      }
      case "edit_request_denied": {
        setEditRequestDenied({
          reason: message.reason || "denied",
          editorClientId: message.editorClientId ?? null,
          at: Date.now(),
        });
        break;
      }
      case "op":
        onRemoteOpRef.current?.(message);
        break;
      case "error":
        setLastError(message.error);
        break;
      case "force_edit_denied":
        setLastError(message.reason || message.error || "force_edit_denied");
        setForceEditDenied({
          reason: message.reason || "denied",
          editorClientId: message.editorClientId ?? null,
          at: Date.now(),
        });
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
      clearEditRequest();
      setEditRequestDenied(null);
      setForceEditDenied(null);
    }
  }, [enabled, modeFromParam, clearEditRequest]);

  useEffect(() => {
    if (effectiveMode === "edit") return;
    if (!editRequest) return;
    clearEditRequest();
  }, [effectiveMode, editRequest, clearEditRequest]);

  useEffect(() => {
    if (!editRequest?.fromClientId) return;
    if (participants?.[editRequest.fromClientId]) return;
    if (editRequest?.fromClientName) return;
    clearEditRequest();
  }, [editRequest?.fromClientId, editRequest?.fromClientName, participants, clearEditRequest]);

  useEffect(() => {
    return () => {
      if (editRequestTimeoutRef.current) {
        clearTimeout(editRequestTimeoutRef.current);
        editRequestTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const client = new CollabClient({
      url: import.meta.env.VITE_COLLAB_WS_URL,
      shareId,
      mode: modeRef.current,
      clientId,
      clientName: clientNameRef.current,
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
  }, [enabled, shareId, clientId, handleMessage]);

  useEffect(() => {
    modeRef.current = modeFromParam;
    clientRef.current?.setMode?.(modeFromParam);
  }, [modeFromParam]);

  useEffect(() => {
    clientNameRef.current = clientName;
    clientRef.current?.setClientName?.(clientName);
  }, [clientName]);

  useEffect(() => {
    saveClientName(clientName);
  }, [clientName]);

  const setClientName = useCallback((nextName) => {
    const cleaned = String(nextName || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 48);
    setClientNameState(cleaned || generateRandomClientName());
  }, []);

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

  const requestRelease = useCallback(() => {
    if (!clientRef.current) return;
    clientRef.current.send("request_release", {});
  }, []);

  const forceEdit = useCallback(() => {
    if (!clientRef.current) return;
    clientRef.current.send("force_edit", {});
  }, []);

  const participantsWithNames = useMemo(() => {
    if (!enabled) return participants;
    const current = participants?.[clientId] ?? {};
    const nextSelf = {
      ...current,
      name: current?.name || current?.clientName || current?.label || current?.title || clientName,
    };
    return { ...(participants || {}), [clientId]: nextSelf };
  }, [enabled, participants, clientId, clientName]);

  const dismissEditRequest = useCallback((targetClientId) => {
    if (!clientRef.current) return;
    clientRef.current.send("dismiss_edit_request", { targetClientId });
  }, []);

  const clearEditRequestDenied = useCallback(() => {
    setEditRequestDenied(null);
  }, []);

  const clearForceEditDenied = useCallback(() => {
    setForceEditDenied(null);
  }, []);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      persistNow,
      requestEdit,
      releaseEdit,
      requestRelease,
      forceEdit,
      connection,
      effectiveMode,
      requestedMode: modeFromParam,
      editorClientId,
    };
    return () => {
      apiRef.current = null;
    };
  }, [
    apiRef,
    persistNow,
    requestEdit,
    releaseEdit,
    requestRelease,
    forceEdit,
    connection,
    effectiveMode,
    modeFromParam,
    editorClientId,
  ]);

  const value = useMemo(
    () => ({
      enabled,
      connection,
      clientId,
      clientName,
      setClientName,
      participants: participantsWithNames,
      requestedMode: modeFromParam,
      effectiveMode,
      mode: effectiveMode,
      editorClientId,
      editRequest,
      editRequestDenied,
      forceEditDenied,
      lastError,
      persist,
      sendOp,
      persistNow,
      requestEdit,
      releaseEdit,
      requestRelease,
      forceEdit,
      dismissEditRequest,
      clearEditRequest,
      clearEditRequestDenied,
      clearForceEditDenied,
    }),
    [
      enabled,
      connection,
      clientId,
      clientName,
      setClientName,
      participantsWithNames,
      modeFromParam,
      effectiveMode,
      editorClientId,
      editRequest,
      editRequestDenied,
      forceEditDenied,
      lastError,
      persist,
      sendOp,
      persistNow,
      requestEdit,
      releaseEdit,
      requestRelease,
      forceEdit,
      dismissEditRequest,
      clearEditRequest,
      clearEditRequestDenied,
      clearForceEditDenied,
    ],
  );

  return <CollabContext.Provider value={value}>{children}</CollabContext.Provider>;
}
