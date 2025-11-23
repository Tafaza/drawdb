import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollabClient } from "../collab/client";
import { nanoid } from "nanoid";

export const CollabContext = createContext({
  enabled: false,
  connection: "disabled",
  clientId: "",
  participants: {},
  mode: "edit",
  lastError: null,
  sendOp: () => {},
});

export function CollabProvider({ shareId, mode = "edit", onRemoteOp, children }) {
  const [connection, setConnection] = useState("disabled");
  const [participants, setParticipants] = useState({});
  const [lastError, setLastError] = useState(null);
  const clientRef = useRef(null);
  const clientId = useMemo(() => {
    const stored = localStorage.getItem("collabClientId");
    if (stored) return stored;
    const id = nanoid();
    localStorage.setItem("collabClientId", id);
    return id;
  }, []);

  const enabled = Boolean(import.meta.env.VITE_COLLAB_WS_URL && shareId);
  const modeFromParam = mode === "view" ? "view" : "edit";

  const handleMessage = useCallback(
    (message) => {
      if (!message?.type) return;

      switch (message.type) {
        case "presence":
          setParticipants(message.participants ?? {});
          break;
        case "op":
          onRemoteOp?.(message);
          break;
        case "error":
          setLastError(message.error);
          break;
        default:
          break;
      }
    },
    [onRemoteOp],
  );

  useEffect(() => {
    if (!enabled) {
      setConnection("disabled");
      return;
    }

    const client = new CollabClient({
      url: import.meta.env.VITE_COLLAB_WS_URL,
      shareId,
      mode: modeFromParam,
      clientId,
      onMessage: handleMessage,
      onStatus: setConnection,
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

  const value = {
    enabled,
    connection,
    clientId,
    participants,
    mode: modeFromParam,
    lastError,
    sendOp,
  };

  return <CollabContext.Provider value={value}>{children}</CollabContext.Provider>;
}
