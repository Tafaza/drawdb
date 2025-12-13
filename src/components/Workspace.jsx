import { useState, useEffect, useCallback, useMemo, createContext, useRef } from "react";
import ControlPanel from "./EditorHeader/ControlPanel";
import Canvas from "./EditorCanvas/Canvas";
import { CanvasContextProvider } from "../context/CanvasContext";
import SidePanel from "./EditorSidePanel/SidePanel";
import { DB, State } from "../data/constants";
import { db } from "../data/db";
import {
  useLayout,
  useSettings,
  useTransform,
  useDiagram,
  useUndoRedo,
  useAreas,
  useNotes,
  useTypes,
  useTasks,
  useSaveState,
  useEnums,
} from "../hooks";
import FloatingControls from "./FloatingControls";
import TableSearchShortcut from "./TableSearchShortcut";
import { Button, Modal, Tag } from "@douyinfe/semi-ui";
import { IconAlertTriangle } from "@douyinfe/semi-icons";
import { useTranslation } from "react-i18next";
import { databases } from "../data/databases";
import { isRtl } from "../i18n/utils/rtl";
import { useSearchParams } from "react-router-dom";
import { get, getCommits, SHARE_FILENAME, VERSION_FILENAME } from "../api/gists";
import { nanoid } from "nanoid";
import { CollabProvider } from "../context/CollabContext";
import CollabStatus from "./Collab/CollabStatus";
import { useCollab } from "../hooks/useCollab";
import CollabEditActions from "./Collab/CollabEditActions";

export const IdContext = createContext({
  gistId: "",
  setGistId: () => {},
  version: "",
  setVersion: () => {},
});

const SIDEPANEL_MIN_WIDTH = 384;

export default function WorkSpace() {
  const [id, setId] = useState(0);
  const [gistId, setGistId] = useState("");
  const [version, setVersion] = useState("");
  const [remoteMeta, setRemoteMeta] = useState(null);
  const [loadedFromGistId, setLoadedFromGistId] = useState("");
  const [title, setTitle] = useState("Untitled Diagram");
  const [resize, setResize] = useState(false);
  const [width, setWidth] = useState(SIDEPANEL_MIN_WIDTH);
  const [lastSaved, setLastSaved] = useState("");
  const [isLoadingRemote, setIsLoadingRemote] = useState(false);
  const [showSelectDbModal, setShowSelectDbModal] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [selectedDb, setSelectedDb] = useState("");
  const [collabSyncReady, setCollabSyncReady] = useState(false);
  const { layout, setLayout } = useLayout();
  const { settings } = useSettings();
  const { types, setTypes } = useTypes();
  const { areas, setAreas } = useAreas();
  const { tasks, setTasks } = useTasks();
  const { notes, setNotes } = useNotes();
  const { saveState, setSaveState } = useSaveState();
  const { transform, setTransform } = useTransform();
  const { enums, setEnums } = useEnums();
  const {
    tables,
    relationships,
    setTables,
    setRelationships,
    database,
    setDatabase,
  } = useDiagram();
  const { undoStack, redoStack, setUndoStack, setRedoStack } = useUndoRedo();
  const { t, i18n } = useTranslation();
  let [searchParams, setSearchParams] = useSearchParams();
  const shareIdParam = searchParams.get("shareId");
  const [collabMode, setCollabMode] = useState(() => {
    const paramMode = searchParams.get("mode");
    if (paramMode === "view") return "view";
    if (paramMode === "edit") return "edit";
    if (shareIdParam) return "view";
    const stored = localStorage.getItem("collabMode");
    return stored === "view" ? "view" : "edit";
  });
  const userSelectedModeRef = useRef(Boolean(searchParams.get("mode")));
  const collabShareId = useMemo(
    () => gistId || loadedFromGistId || shareIdParam,
    [gistId, loadedFromGistId, shareIdParam],
  );
  const collabEnabled = useMemo(
    () => Boolean(import.meta.env.VITE_COLLAB_WS_URL && collabShareId),
    [collabShareId],
  );
  const [collabEffectiveMode, setCollabEffectiveMode] = useState(collabMode);
  const [collabConnection, setCollabConnection] = useState("disabled");
  const collabApiRef = useRef(null);
  const [collabRoomVersion, setCollabRoomVersion] = useState(0);
  const [collabLastPersistedVersion, setCollabLastPersistedVersion] = useState(0);
  const applyingRemoteRef = useRef(false);
  const collabClientIdRef = useRef(nanoid());
  const collabVersionRef = useRef(0);
  const transformRef = useRef(transform);
  const [collabDirty, setCollabDirty] = useState(false);
  const [collabPersistError, setCollabPersistError] = useState(false);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);
  useEffect(() => {
    collabDirty && setCollabPersistError(false);
  }, [collabDirty]);
  const handleResize = (e) => {
    if (!resize) return;
    const w = isRtl(i18n.language) ? window.innerWidth - e.clientX : e.clientX;
    if (w > SIDEPANEL_MIN_WIDTH) setWidth(w);
  };

  const refreshRemoteMeta = useCallback(async () => {
    if (!collabShareId) return;
    try {
      const { data } = await get(collabShareId);
      const latestHistory = data?.history?.[0];
      let revision = latestHistory?.version || data?.version;
      let updatedAt =
        latestHistory?.committed_at || data?.updated_at || data?.updatedAt;

      if (!revision) {
        try {
          const commits = await getCommits(collabShareId, 1, 1);
          const latestCommit = commits?.data?.[0];
          if (latestCommit?.version) {
            revision = latestCommit.version;
            updatedAt = updatedAt ?? latestCommit.committed_at;
          }
        } catch (err) {
          console.log(err);
        }
      }

      if (revision || updatedAt) {
        setRemoteMeta({
          revision: revision ?? "",
          updatedAt: updatedAt ?? "",
        });
      }
    } catch (e) {
      console.log(e);
    }
  }, [collabShareId]);

  const setCollabModeParam = useCallback(
    (nextMode) => {
      const params = new URLSearchParams(searchParams);
      if (params.get("shareId")) {
        params.set("mode", nextMode);
      } else if (nextMode === "view") {
        params.set("mode", "view");
      } else {
        params.delete("mode");
      }
      setCollabMode(nextMode);
      localStorage.setItem("collabMode", nextMode);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleCollabModeChange = useCallback(
    (nextMode) => {
      userSelectedModeRef.current = true;

      if (nextMode === "edit" && collabEnabled && collabConnection === "open") {
        collabApiRef.current?.requestEdit?.();
        collabApiRef.current?.requestRelease?.();
      }

      if (
        nextMode === "view" &&
        collabEnabled &&
        collabConnection === "open" &&
        collabEffectiveMode === "edit" &&
        collabRoomVersion > collabLastPersistedVersion
      ) {
        collabApiRef.current?.persistNow?.();
        collabApiRef.current?.releaseEdit?.();
        setTimeout(() => {
          setCollabModeParam(nextMode);
        }, 200);
        return;
      }

      if (
        nextMode === "view" &&
        collabEnabled &&
        collabConnection === "open" &&
        collabEffectiveMode === "edit"
      ) {
        collabApiRef.current?.releaseEdit?.();
      }

      setCollabModeParam(nextMode);
    },
    [
      collabConnection,
      collabEffectiveMode,
      collabEnabled,
      collabLastPersistedVersion,
      collabRoomVersion,
      setCollabModeParam,
    ],
  );

  const autoSwitchToView = useCallback(
    () => setCollabModeParam("view"),
    [setCollabModeParam],
  );

  const prevCollabShareIdRef = useRef(collabShareId);
  useEffect(() => {
    const hasModeParam = Boolean(searchParams.get("mode"));
    if (collabShareId !== prevCollabShareIdRef.current) {
      // New share link: reset manual selection based on explicit mode param
      userSelectedModeRef.current = hasModeParam;
      prevCollabShareIdRef.current = collabShareId;
    } else if (hasModeParam) {
      // If a mode param is present, respect it without resetting to view otherwise
      userSelectedModeRef.current = true;
    }
  }, [collabShareId, searchParams]);

  useEffect(() => {
    if (!collabShareId) return;
    if (userSelectedModeRef.current) return;
    if (collabMode !== "view") {
      setCollabModeParam("view");
    }
  }, [collabShareId, collabMode, setCollabModeParam]);

  useEffect(() => {
    if (collabShareId) return;
    if (collabMode !== "edit") {
      userSelectedModeRef.current = false;
      setCollabModeParam("edit");
    }
  }, [collabShareId, collabMode, setCollabModeParam]);

  const applyDiagramState = useCallback(
    (diagram) => {
      if (!diagram) return;
      applyingRemoteRef.current = true;
      setDatabase(diagram.database ?? DB.GENERIC);
      setTitle(diagram.title ?? "Untitled Diagram");
      setTables(diagram.tables ?? []);
      setRelationships(diagram.relationships ?? []);
      setNotes(diagram.notes ?? []);
      setAreas(diagram.subjectAreas ?? []);
      setTasks(diagram.todos ?? []);

      // Preserve local viewport to avoid remote edits snapping the view
      const nextTransform =
        transformRef.current ?? diagram.transform ?? { pan: { x: 0, y: 0 }, zoom: 1 };
      setTransform(nextTransform);

      if (databases[diagram.database ?? DB.GENERIC].hasTypes) {
        setTypes(diagram.types ?? []);
      }
      if (databases[diagram.database ?? DB.GENERIC].hasEnums) {
        setEnums(diagram.enums ?? []);
      }
      setTimeout(() => {
        applyingRemoteRef.current = false;
      }, 0);
    },
    [
      setAreas,
      setDatabase,
      setNotes,
      setRelationships,
      setTables,
      setTasks,
      setTitle,
      setTransform,
      setTypes,
      setEnums,
      transformRef,
    ],
  );

  const handleRemoteOp = useCallback(
    (message) => {
      if (!message?.op) return;

      const incomingVersion = message.op?.version ?? 0;
      if (incomingVersion && incomingVersion < collabVersionRef.current) return;

      if (incomingVersion) {
        collabVersionRef.current = incomingVersion;
        setCollabRoomVersion(incomingVersion);
      }

      if (message.clientId && message.clientId === collabClientIdRef.current) {
        return;
      }

      if (message.op.kind === "doc:replace") {
        applyDiagramState(message.op.diagram);
        setCollabSyncReady(true);
        setCollabDirty(false);
        setCollabPersistError(false);
      }
    },
    [
      applyDiagramState,
      collabClientIdRef,
      collabVersionRef,
      setCollabSyncReady,
      setCollabDirty,
      setCollabPersistError,
    ],
  );

  const buildDiagramSnapshot = useCallback(() => {
    return {
      title,
      tables,
      relationships,
      notes,
      subjectAreas: areas,
      database,
      ...(databases[database].hasTypes && { types }),
      ...(databases[database].hasEnums && { enums }),
      todos: tasks,
    };
  }, [
    areas,
    database,
    enums,
    notes,
    relationships,
    tables,
    tasks,
    title,
    types,
  ]);

  const save = useCallback(async () => {
    const name = window.name.split(" ");
    const op = name[0];
    const saveAsDiagram = window.name === "" || op === "d" || op === "lt";

    if (saveAsDiagram) {
      if (searchParams.has("shareId")) {
        searchParams.delete("shareId");
        setSearchParams(searchParams, { replace: true });
      }
      if ((id === 0 && window.name === "") || op === "lt") {
        await db.diagrams
          .add({
            database: database,
            name: title,
            gistId: gistId ?? "",
            lastModified: new Date(),
            tables: tables,
            references: relationships,
            notes: notes,
            areas: areas,
            todos: tasks,
            pan: transform.pan,
            zoom: transform.zoom,
            loadedFromGistId: loadedFromGistId,
            ...(databases[database].hasEnums && { enums: enums }),
            ...(databases[database].hasTypes && { types: types }),
          })
          .then((id) => {
            setId(id);
            window.name = `d ${id}`;
            setSaveState(State.SAVED);
            setLastSaved(new Date().toLocaleString());
          });
      } else {
        await db.diagrams
          .update(id, {
            database: database,
            name: title,
            lastModified: new Date(),
            tables: tables,
            references: relationships,
            notes: notes,
            areas: areas,
            todos: tasks,
            gistId: gistId ?? "",
            pan: transform.pan,
            zoom: transform.zoom,
            loadedFromGistId: loadedFromGistId,
            ...(databases[database].hasEnums && { enums: enums }),
            ...(databases[database].hasTypes && { types: types }),
          })
          .then(() => {
            setSaveState(State.SAVED);
            setLastSaved(new Date().toLocaleString());
          });
      }
    } else {
      await db.templates
        .update(id, {
          database: database,
          title: title,
          tables: tables,
          relationships: relationships,
          notes: notes,
          subjectAreas: areas,
          todos: tasks,
          pan: transform.pan,
          zoom: transform.zoom,
          ...(databases[database].hasEnums && { enums: enums }),
          ...(databases[database].hasTypes && { types: types }),
        })
        .then(() => {
          setSaveState(State.SAVED);
          setLastSaved(new Date().toLocaleString());
        })
        .catch(() => {
          setSaveState(State.ERROR);
        });
    }
  }, [
    searchParams,
    setSearchParams,
    tables,
    relationships,
    notes,
    areas,
    types,
    title,
    id,
    tasks,
    transform,
    setSaveState,
    database,
    enums,
    gistId,
    loadedFromGistId,
  ]);

  const load = useCallback(async () => {
    setRemoteMeta(null);
    setIsLoadingRemote(false);
    let syncReady = true;

    const loadLatestDiagram = async () => {
      try {
        const d = await db.diagrams.orderBy("lastModified").last();
        if (d) {
          if (d.loadedFromGistId) {
            const refreshed = await loadFromGist(d.loadedFromGistId, {
              silent: true,
            });
            if (refreshed) {
              setId(d.id);
              window.name = `d ${d.id}`;
              return;
            }
          }
          const nextDatabase = d.database ?? DB.GENERIC;
          const resolvedDatabase = databases[nextDatabase]?.label
            ? nextDatabase
            : DB.GENERIC;
          setDatabase(resolvedDatabase);
          setId(d.id);
          setGistId(d.gistId);
          setLoadedFromGistId(d.loadedFromGistId);
          setTitle(d.name);
          setTables(d.tables ?? []);
          setRelationships(d.references ?? []);
          setNotes(d.notes ?? []);
          setAreas(d.subjectAreas ?? d.areas ?? []);
          setTasks(d.todos ?? []);
          setTransform({ pan: d.pan, zoom: d.zoom });
          const databaseMeta = databases[resolvedDatabase];
          if (databaseMeta.hasTypes) {
            if (d.types) {
              setTypes(
                d.types.map((t) =>
                  t.id
                    ? t
                    : {
                        ...t,
                        id: nanoid(),
                        fields: (t.fields ?? []).map((f) =>
                          f.id ? f : { ...f, id: nanoid() },
                        ),
                      },
                ),
              );
            } else {
              setTypes([]);
            }
          }
          if (databaseMeta.hasEnums) {
            const nextEnums = Array.isArray(d.enums) ? d.enums : [];
            setEnums(
              nextEnums.map((e) => (!e.id ? { ...e, id: nanoid() } : e)),
            );
          }
          window.name = `d ${d.id}`;
        } else {
          window.name = "";
          if (selectedDb === "") setShowSelectDbModal(true);
        }
      } catch (error) {
        console.log(error);
      }
    };

    const loadDiagram = async (id) => {
      try {
        const diagram = await db.diagrams.get(id);
        if (diagram) {
          if (diagram.loadedFromGistId) {
            const refreshed = await loadFromGist(diagram.loadedFromGistId, {
              silent: true,
            });
            if (refreshed) {
              setId(diagram.id);
              window.name = `d ${diagram.id}`;
              return;
            }
          }
          const nextDatabase = diagram.database ?? DB.GENERIC;
          const resolvedDatabase = databases[nextDatabase]?.label
            ? nextDatabase
            : DB.GENERIC;
          setDatabase(resolvedDatabase);
          setId(diagram.id);
          setGistId(diagram.gistId);
          setLoadedFromGistId(diagram.loadedFromGistId);
          setTitle(diagram.name);
          setTables(diagram.tables ?? []);
          setRelationships(diagram.references ?? []);
          setAreas(diagram.subjectAreas ?? diagram.areas ?? []);
          setNotes(diagram.notes ?? []);
          setTasks(diagram.todos ?? []);
          setTransform({
            pan: diagram.pan,
            zoom: diagram.zoom,
          });
          setUndoStack([]);
          setRedoStack([]);
          const databaseMeta = databases[resolvedDatabase];
          if (databaseMeta.hasTypes) {
            if (diagram.types) {
              setTypes(
                diagram.types.map((t) =>
                  t.id
                    ? t
                    : {
                        ...t,
                        id: nanoid(),
                        fields: (t.fields ?? []).map((f) =>
                          f.id ? f : { ...f, id: nanoid() },
                        ),
                      },
                ),
              );
            } else {
              setTypes([]);
            }
          }
          if (databaseMeta.hasEnums) {
            const nextEnums = Array.isArray(diagram.enums) ? diagram.enums : [];
            setEnums(nextEnums.map((e) => (!e.id ? { ...e, id: nanoid() } : e)));
          }
          window.name = `d ${diagram.id}`;
        } else {
          window.name = "";
        }
      } catch (error) {
        console.log(error);
      }
    };

    const loadTemplate = async (id) => {
      await db.templates
        .get(id)
        .then((diagram) => {
          if (diagram) {
            const nextDatabase = diagram.database ?? DB.GENERIC;
            const resolvedDatabase = databases[nextDatabase]?.label
              ? nextDatabase
              : DB.GENERIC;
            setDatabase(resolvedDatabase);
            setId(diagram.id);
            setTitle(diagram.title);
            setTables(diagram.tables ?? []);
            setRelationships(diagram.relationships ?? []);
            setAreas(diagram.subjectAreas ?? diagram.areas ?? []);
            setTasks(diagram.todos ?? []);
            setNotes(diagram.notes ?? []);
            setTransform({
              zoom: 1,
              pan: { x: 0, y: 0 },
            });
            setUndoStack([]);
            setRedoStack([]);
            const databaseMeta = databases[resolvedDatabase];
            if (databaseMeta.hasTypes) {
              if (diagram.types) {
                setTypes(
                  diagram.types.map((t) =>
                    t.id
                      ? t
                      : {
                          ...t,
                          id: nanoid(),
                          fields: (t.fields ?? []).map((f) =>
                            f.id ? f : { ...f, id: nanoid() },
                          ),
                        },
                  ),
                );
              } else {
                setTypes([]);
              }
            }
            if (databaseMeta.hasEnums) {
              const nextEnums = Array.isArray(diagram.enums) ? diagram.enums : [];
              setEnums(nextEnums.map((e) => (!e.id ? { ...e, id: nanoid() } : e)));
            }
          } else {
            if (selectedDb === "") setShowSelectDbModal(true);
          }
        })
        .catch((error) => {
          console.log(error);
          if (selectedDb === "") setShowSelectDbModal(true);
        });
    };

    const loadFromGist = async (shareId, { silent = false } = {}) => {
      setIsLoadingRemote(true);
      try {
        const { data } = await get(shareId);
        const latestHistory = data?.history?.[0];
        let revision = latestHistory?.version || data?.version;
        let updatedAt =
          latestHistory?.committed_at || data?.updated_at || data?.updatedAt;

        if (!revision) {
          try {
            const commits = await getCommits(shareId, 1, 1);
            const latestCommit = commits?.data?.[0];
            if (latestCommit?.version) {
              revision = latestCommit.version;
              updatedAt = updatedAt ?? latestCommit.committed_at;
            }
          } catch (err) {
            console.log(err);
          }
        }

        if (revision || updatedAt) {
          setRemoteMeta({
            revision: revision ?? "",
            updatedAt: updatedAt ?? "",
          });
        } else {
          setRemoteMeta(null);
        }
        const shareFile =
          data?.files?.[SHARE_FILENAME] ?? data?.files?.[VERSION_FILENAME];
        const content = shareFile?.content;
        if (!content) {
          throw new Error("Shared diagram is missing content");
        }
        const parsedDiagram = JSON.parse(content);
        setUndoStack([]);
        setRedoStack([]);
        setGistId(shareId);
        setLoadedFromGistId(shareId);
        const nextDatabase = parsedDiagram.database ?? DB.GENERIC;
        const resolvedDatabase = databases[nextDatabase]?.label
          ? nextDatabase
          : DB.GENERIC;
        setDatabase(resolvedDatabase);
        setTitle(parsedDiagram.title ?? "Untitled Diagram");
        setTables(parsedDiagram.tables ?? []);
        setRelationships(parsedDiagram.relationships ?? []);
        setNotes(parsedDiagram.notes ?? []);
        setAreas(parsedDiagram.subjectAreas ?? parsedDiagram.areas ?? []);
        setTasks(parsedDiagram.todos ?? []);
        setTransform(
          parsedDiagram.transform ?? { pan: { x: 0, y: 0 }, zoom: 1 },
        );
        const databaseMeta = databases[resolvedDatabase];
        if (databaseMeta.hasTypes) {
          if (parsedDiagram.types) {
            setTypes(
              parsedDiagram.types.map((t) =>
                t.id
                  ? t
                  : {
                      ...t,
                      id: nanoid(),
                      fields: (t.fields ?? []).map((f) =>
                        f.id ? f : { ...f, id: nanoid() },
                      ),
                    },
              ),
            );
          } else {
            setTypes([]);
          }
        }
        if (databaseMeta.hasEnums) {
          const nextEnums = Array.isArray(parsedDiagram.enums)
            ? parsedDiagram.enums
            : [];
          setEnums(
            nextEnums.map((e) => (!e.id ? { ...e, id: nanoid() } : e)),
          );
        }
      } catch (e) {
        console.log(e);
        if (!silent) {
          setSaveState(State.FAILED_TO_LOAD);
        }
        setRemoteMeta(null);
        return false;
      } finally {
        setIsLoadingRemote(false);
      }
      return true;
    };

    const shareId = shareIdParam;
    if (shareId) {
      const existingDiagram = await db.diagrams.get({
        loadedFromGistId: shareId,
      });

      if (existingDiagram) {
        window.name = "d " + existingDiagram.id;
        setId(existingDiagram.id);
      } else {
        window.name = "";
        setId(0);
      }
      const success = await loadFromGist(shareId);
      syncReady = success;
      return syncReady;
    }

    if (window.name === "") {
      await loadLatestDiagram();
      return syncReady;
    }

    const name = window.name.split(" ");
    const op = name[0];
    const id = parseInt(name[1]);
    switch (op) {
      case "d": {
        await loadDiagram(id);
        break;
      }
      case "t":
      case "lt": {
        await loadTemplate(id);
        break;
      }
      default:
        break;
    }
    return syncReady;
  }, [
    setTransform,
    setRedoStack,
    setUndoStack,
    setRelationships,
    setTables,
    setAreas,
    setNotes,
    setTypes,
    setTasks,
    setDatabase,
    setEnums,
    selectedDb,
    setSaveState,
    shareIdParam,
  ]);

  const returnToCurrentDiagram = async () => {
    await load();
    setLayout((prev) => ({ ...prev, readOnly: false }));
    setVersion(null);
  };

  useEffect(() => {
    const paramMode = searchParams.get("mode");
    if (paramMode === "view") {
      if (collabMode !== "view") {
        setCollabMode("view");
        localStorage.setItem("collabMode", "view");
      }
      return;
    }
    if (paramMode === "edit") {
      if (collabMode !== "edit") {
        setCollabMode("edit");
        localStorage.setItem("collabMode", "edit");
      }
      return;
    }

    if (collabShareId) return;

    const stored = localStorage.getItem("collabMode");
    const next = stored === "view" ? "view" : "edit";
    if (collabMode !== next) {
      setCollabMode(next);
    }
  }, [searchParams, collabMode, collabShareId]);

  useEffect(() => {
    if (!collabShareId) return;

    refreshRemoteMeta();
    if (!collabEnabled) {
      const interval = setInterval(refreshRemoteMeta, 120000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [collabShareId, refreshRemoteMeta, collabEnabled]);

  useEffect(() => {
    collabVersionRef.current = 0;
    setCollabDirty(false);
    setCollabPersistError(false);
  }, [collabShareId]);

  useEffect(() => {
    setLayout((prev) => {
      const shouldBeReadOnly =
        Boolean(version) || (collabEnabled && collabEffectiveMode === "view");
      if (shouldBeReadOnly) {
        if (prev.readOnly) return prev;
        return { ...prev, readOnly: true };
      }
      if (prev.readOnly && !version) {
        return { ...prev, readOnly: false };
      }
      return prev;
    });
  }, [collabEnabled, collabEffectiveMode, setLayout, version]);

  useEffect(() => {
    if (
      tables?.length === 0 &&
      areas?.length === 0 &&
      notes?.length === 0 &&
      types?.length === 0 &&
      tasks?.length === 0
    )
      return;

    if (applyingRemoteRef.current) return;

    const shouldAutosave = settings.autosave || collabEnabled;

    if (shouldAutosave) {
      setSaveState(State.SAVING);
    }
  }, [
    undoStack,
    redoStack,
    settings.autosave,
    collabEnabled,
    tables?.length,
    areas?.length,
    notes?.length,
    types?.length,
    relationships?.length,
    tasks?.length,
    transform.zoom,
    title,
    gistId,
    setSaveState,
  ]);

  useEffect(() => {
    if (layout.readOnly) return;

    if (saveState !== State.SAVING) return;

    save();
  }, [saveState, layout, save]);

  useEffect(() => {
    document.title = "Editor | drawDB";

    setCollabSyncReady(false);
    let cancelled = false;
    const runLoad = async () => {
      try {
        const success = await load();
        if (!cancelled) {
          setCollabSyncReady(Boolean(success));
        }
      } catch (e) {
        if (!cancelled) {
          setCollabSyncReady(false);
        }
      }
    };

    runLoad();

    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <CollabProvider
      shareId={collabShareId}
      mode={collabMode}
      clientId={collabClientIdRef.current}
      apiRef={collabApiRef}
      onConnection={setCollabConnection}
      onMode={(message) => {
        const next = message?.mode === "edit" ? "edit" : "view";
        setCollabEffectiveMode(next);
        if (typeof message?.roomVersion === "number") {
          collabVersionRef.current = message.roomVersion;
          setCollabRoomVersion(message.roomVersion);
        }
        if (typeof message?.lastPersistedVersion === "number") {
          setCollabLastPersistedVersion(message.lastPersistedVersion);
        }
        if (next === "view" && collabMode === "edit") {
          autoSwitchToView();
        }
      }}
      onPersisted={(message) => {
        setCollabDirty(false);
        setCollabPersistError(false);
        if (typeof message?.persistedVersion === "number") {
          setCollabLastPersistedVersion(message.persistedVersion);
        }
        if (!message?.noChanges && (message?.revision || message?.updatedAt)) {
          setRemoteMeta((prev) => ({
            revision: message.revision ?? prev?.revision ?? "",
            updatedAt: message.updatedAt ?? prev?.updatedAt ?? "",
          }));
        }
      }}
      onPersistError={() => {
        setCollabPersistError(true);
      }}
      onRemoteOp={handleRemoteOp}
    >
      <CollabAutoViewGuard
        currentMode={collabMode}
        onSwitchToView={autoSwitchToView}
        userSelectedModeRef={userSelectedModeRef}
      />
      <TableSearchShortcut />
      <div className="h-full flex flex-col overflow-hidden theme">
        <IdContext.Provider value={{ gistId, setGistId, version, setVersion }}>
          <div className="relative px-2">
            <div className="flex-1 min-w-0">
              <ControlPanel
                diagramId={id}
                setDiagramId={setId}
                title={title}
                setTitle={setTitle}
                lastSaved={lastSaved}
                setLastSaved={setLastSaved}
                hideSaveState={Boolean(collabShareId)}
                headerRight={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <CollabStatus showClient />
                    <CollabEditActions
                      inline
                      onSwitchToEdit={() => {
                        userSelectedModeRef.current = true;
                        setCollabModeParam("edit");
                      }}
                      onSwitchToView={() => handleCollabModeChange("view")}
                    />
                  </div>
                }
                collabMetadata={{
                  shareId: collabShareId,
                  lastModified: remoteMeta?.updatedAt,
                  revision: version || remoteMeta?.revision,
                  isLoading: isLoadingRemote,
                  dirty: collabEnabled && collabRoomVersion > collabLastPersistedVersion,
                  persistError: collabPersistError,
                  canPersistNow:
                    collabEnabled &&
                    collabConnection === "open" &&
                    collabEffectiveMode === "edit",
                  onPersistNow: () => collabApiRef.current?.persistNow?.(),
                }}
              />
            </div>
          </div>
        </IdContext.Provider>
        <CollabEmitter
          buildSnapshot={buildDiagramSnapshot}
          applyingRemoteRef={applyingRemoteRef}
          canSync={collabSyncReady}
          onSend={() => setCollabDirty(true)}
        />
        <div
          className="flex h-full overflow-y-auto"
          onPointerUp={(e) => e.isPrimary && setResize(false)}
          onPointerLeave={(e) => e.isPrimary && setResize(false)}
          onPointerMove={(e) => e.isPrimary && handleResize(e)}
          onPointerDown={(e) => {
            // Required for onPointerLeave to trigger when a touch pointer leaves
            // https://stackoverflow.com/a/70976017/1137077
            e.target.releasePointerCapture(e.pointerId);
          }}
          style={isRtl(i18n.language) ? { direction: "rtl" } : {}}
        >
          {layout.sidebar && (
            <SidePanel resize={resize} setResize={setResize} width={width} />
          )}
          <div className="relative w-full h-full overflow-hidden">
            <CanvasContextProvider className="h-full w-full">
              <Canvas saveState={saveState} setSaveState={setSaveState} />
            </CanvasContextProvider>
            {version && (
              <div className="absolute right-8 top-2 space-x-2">
                <Button
                  icon={<i className="fa-solid fa-rotate-right mt-0.5"></i>}
                  onClick={() => setShowRestoreModal(true)}
                >
                  {t("restore_version")}
                </Button>
                <Button
                  type="tertiary"
                  onClick={returnToCurrentDiagram}
                  icon={<i className="bi bi-arrow-return-right mt-1"></i>}
                >
                  {t("return_to_current")}
                </Button>
              </div>
            )}
            {!(layout.sidebar || layout.toolbar || layout.header) && (
              <div className="fixed right-5 bottom-4">
                <FloatingControls />
              </div>
            )}
          </div>
        </div>
        <Modal
          centered
          size="medium"
          closable={false}
          hasCancel={false}
          title={t("pick_db")}
          okText={t("confirm")}
          visible={showSelectDbModal}
          onOk={() => {
            if (selectedDb === "") return;
            setDatabase(selectedDb);
            setShowSelectDbModal(false);
          }}
          okButtonProps={{ disabled: selectedDb === "" }}
        >
          <div className="grid grid-cols-3 gap-4 place-content-center">
            {Object.values(databases).map((x) => (
              <div
                key={x.name}
                onClick={() => setSelectedDb(x.label)}
                className={`space-y-3 p-3 rounded-md border-2 select-none ${
                  settings.mode === "dark"
                    ? "bg-zinc-700 hover:bg-zinc-600"
                    : "bg-zinc-100 hover:bg-zinc-200"
                } ${selectedDb === x.label ? "border-zinc-400" : "border-transparent"}`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{x.name}</div>
                  {x.beta && (
                    <Tag size="small" color="light-blue">
                      Beta
                    </Tag>
                  )}
                </div>
                {x.image && (
                  <img
                    src={x.image}
                    className="h-8"
                    style={{
                      filter:
                        "opacity(0.4) drop-shadow(0 0 0 white) drop-shadow(0 0 0 white)",
                    }}
                  />
                )}
                <div className="text-xs">{x.description}</div>
              </div>
            ))}
          </div>
        </Modal>
        <Modal
          visible={showRestoreModal}
          centered
          closable
          onCancel={() => setShowRestoreModal(false)}
          title={
            <span className="flex items-center gap-2">
              <IconAlertTriangle className="text-amber-400" size="extra-large" />{" "}
              {t("restore_version")}
            </span>
          }
          okText={t("continue")}
          cancelText={t("cancel")}
          onOk={() => {
            setLayout((prev) => ({ ...prev, readOnly: false }));
            setShowRestoreModal(false);
            setVersion(null);
          }}
        >
          {t("restore_warning")}
        </Modal>
      </div>
    </CollabProvider>
  );
}

function CollabEmitter({ buildSnapshot, applyingRemoteRef, canSync, onSend }) {
  const { enabled, connection, effectiveMode, sendOp } = useCollab();
  const { layout } = useLayout();
  const lastSentRef = useRef(null);
  const buildSnapshotRef = useRef(buildSnapshot);

  useEffect(() => {
    buildSnapshotRef.current = buildSnapshot;
  }, [buildSnapshot]);

  useEffect(() => {
    if (
      !enabled ||
      effectiveMode !== "edit" ||
      layout.readOnly ||
      connection !== "open" ||
      !canSync
    )
      return undefined;

    const syncInterval = setInterval(() => {
      if (applyingRemoteRef.current) return;

      const diagram = buildSnapshotRef.current();
      const serialized = JSON.stringify(diagram);

      if (serialized !== lastSentRef.current) {
        lastSentRef.current = serialized;
        sendOp({ kind: "doc:replace", diagram });
        onSend?.();
      }
    }, 500);

    return () => {
      clearInterval(syncInterval);
    };
  }, [enabled, effectiveMode, layout.readOnly, connection, sendOp, applyingRemoteRef, canSync, onSend]);

  return null;
}

function CollabAutoViewGuard({ currentMode, onSwitchToView, userSelectedModeRef }) {
  const { enabled, connection, participants, clientId } = useCollab();

  useEffect(() => {
    if (!enabled || connection !== "open") return;
    if (currentMode !== "edit") return;
    if (userSelectedModeRef.current) return;

    const hasOtherEditor = Object.entries(participants || {}).some(
      ([participantId, info]) => participantId !== clientId && info?.mode === "edit",
    );

    if (hasOtherEditor) {
      onSwitchToView();
    }
  }, [
    enabled,
    connection,
    participants,
    clientId,
    currentMode,
    onSwitchToView,
    userSelectedModeRef,
  ]);

  return null;
}
