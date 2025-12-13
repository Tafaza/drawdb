Yeah, that behavior makes sense given the current wiring — and it’s not your persistence changes, it’s a sneaky interaction between **URL params + `load()`**.

Let me walk through what’s happening and then I’ll show a concrete fix.

---

## What’s actually going wrong

### 1. Switching to edit mode changes the URL

When you click the collab mode toggle, you call:

```js
const setCollabModeParam = useCallback(
  (nextMode) => {
    const params = new URLSearchParams(searchParams);
    if (nextMode === "view") {
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
```

So going **from view → edit** removes `?mode=view` from the URL. 

That means `searchParams` changes, even though `shareId` stays the same.

---

### 2. The `load()` effect re-runs every time `searchParams` changes

Your `load` function is memoized like this:

```js
const load = useCallback(async () => {
  // ...
  const shareId = searchParams.get("shareId");
  if (shareId) {
    // load from gist...
  }
  // ...
}, [
  setTransform,
  // ...lots of stuff...
  selectedDb,
  setSaveState,
  searchParams,
]);
```

And then you have:

```js
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
```

So:

* Any change to `searchParams` → new `load` function → effect re-runs → **diagram is reloaded**. 

That’s fine when `shareId` changes (new link), but it also happens when you just toggle `mode`.

---

### 3. What happens in your scenario

Imagine this timeline:

1. You open a shared diagram with `?shareId=...&mode=view`.

   * `load()` runs, fetches the gist, sets local diagram.
   * Collab WS connects; you’re in **view** mode, so you **receive** `doc:replace` ops but **don’t send** any.

2. Someone else in **edit** mode makes changes.

   * The collab server’s in‑memory `room.diagram` is updated immediately.
   * Your tab in view mode receives those `op` messages and updates its local diagram accordingly. So far so good.

3. You now switch to **edit**:

   * `setCollabModeParam("edit")` removes `mode=view` from the URL.
   * `searchParams` changes → `load`’s dependencies change → the `useEffect([load])` runs again.
   * `load()` sees `shareId` in the URL and **reloads from the gist**, which only has whatever was flushed by the collab server (maybe up to 30s / N ops ago, depending on your settings).
   * Your local diagram is now reset to that **older** gist snapshot.

4. As soon as you’re in edit mode, `CollabEmitter` starts sending your snapshot:

   ```js
   if (!enabled || mode === "view" || connection !== "open" || !canSync)
     return undefined;

   const syncInterval = setInterval(() => {
     if (applyingRemoteRef.current) return;

     const diagram = buildSnapshotRef.current();
     const serialized = JSON.stringify(diagram);

     if (serialized !== lastSentRef.current) {
       lastSentRef.current = serialized;
       sendOp({ kind: "doc:replace", diagram });
     }
   }, 500);
   ```

   But the snapshot it sends is **the stale gist version you just reloaded**, not the up‑to‑date state you had in view mode.

5. The collab server sees this new `doc:replace`, treats it as the latest truth, and broadcasts it to everyone. Because your protocol is last‑writer‑wins, that overwrites the newer edits your collaborator just made.

From your perspective:

> “As soon as I go to edit, I lose their changes.”

From the system’s perspective:

> “You reloaded from an older source (gist), then pushed that older snapshot to the room.”

The persistence/version work you added (rooms, `dirty`, etc.) doesn’t affect this – it’s purely a frontend “re-load from backend when you shouldn’t” problem.

---

## The fix: don’t re-run `load()` when only `mode` changes

You **do** want `load()` to run when:

* `shareId` changes (different gist / share link), or
* the component first mounts.

You **do not** want `load()` to run when:

* Only the `mode` query param changes between `view` and `edit`.

Right now `load` depends on the full `searchParams` object, so any query param change triggers a reload.

### Step 1 – Extract the shareId param

Near the top, after:

```js
let [searchParams, setSearchParams] = useSearchParams();
```

add a derived value that only tracks the `shareId`:

```js
// Only care about shareId changes for loading; ignore other query params
const shareIdParam = searchParams.get("shareId");
```

### Step 2 – Use `shareIdParam` for `collabShareId`

Change:

```js
const collabShareId = useMemo(
  () => gistId || loadedFromGistId || searchParams.get("shareId"),
  [gistId, loadedFromGistId, searchParams],
);
```

to:

```js
const collabShareId = useMemo(
  () => gistId || loadedFromGistId || shareIdParam,
  [gistId, loadedFromGistId, shareIdParam],
);
```

This way, **changing just `mode`** no longer changes `collabShareId`, but changing the actual `shareId` will. 

All the other effects that care about `mode` can keep depending on `searchParams` – they’re separate.

### Step 3 – Use `shareIdParam` inside `load()`

Inside your `load` function, replace:

```js
const shareId = searchParams.get("shareId");
if (shareId) {
  const existingDiagram = await db.diagrams.get({
    loadedFromGistId: shareId,
  });
  // ...
}
```

with:

```js
const shareId = shareIdParam;
if (shareId) {
  const existingDiagram = await db.diagrams.get({
    loadedFromGistId: shareId,
  });
  // ...
}
```

Now `load` no longer reads `searchParams` directly. It only cares about the derived `shareIdParam`. 

### Step 4 – Update `load`’s dependencies

Finally, in the dependency array for `load`, swap out `searchParams` for `shareIdParam`:

```js
const load = useCallback(async () => {
  // ...
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
  database,
  setEnums,
  selectedDb,
  setSaveState,
- searchParams,
+ shareIdParam,
]);
```

Now:

* Changing `?shareId=...` → `shareIdParam` changes → `load` identity changes → effect re-runs → diagram reloads. ✅
* Changing `?mode=view` ↔ removing `mode` → `shareIdParam` stays the same → `load` identity is unchanged → **no reload** → you keep the in‑memory collab state you already had. ✅

---

## Why this fixes your “view → edit loses edits” case

With the above changes:

1. In view mode, you still receive remote updates over collab WS and your local diagram is always current.
2. When you toggle to edit:

   * URL updates (`mode` param) but **`shareIdParam` is unchanged**.
   * `load()` does **not** re-run, so you **don’t** overwrite the diagram with whatever’s in the gist.
   * `CollabEmitter` starts sending snapshots starting from your current (up‑to‑date) diagram.
3. Since the snapshot you send matches (or at worst is ahead of) the server’s `room.diagram`, you no longer “jump backward” and trash someone else’s edits.

This is completely compatible with your existing persistence hardening and any version tracking / flush events you added in patches 0004–0007: we’re just preventing a stale reload on mode change.

---

If you’d like, I can also draft this as a proper `0008-...` patch in the same style as your existing series so you can apply it directly with `git am`.
