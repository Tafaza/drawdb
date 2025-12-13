import { Button, Popconfirm, Tag, Tooltip, Toast } from "@douyinfe/semi-ui"
import { useEffect, useMemo, useRef, useState } from "react"
import { useCollab } from "../../hooks/useCollab"
import { getStableClientNameFromId } from "../../utils/clientName"

export default function CollabEditActions({
  onSwitchToEdit,
  onSwitchToView,
  inline = false,
}) {
  const {
    enabled,
    connection,
    clientId,
    editorClientId,
    participants,
    effectiveMode,
    editRequest,
    editRequestDenied,
    forceEditDenied,
    requestEdit,
    requestRelease,
    forceEdit,
    releaseEdit,
    dismissEditRequest,
    clearEditRequest,
    clearEditRequestDenied,
    clearForceEditDenied,
  } = useCollab()

  const [isTrying, setIsTrying] = useState(false)
  const shouldSwitchToEditRef = useRef(false)
  const ignoreNextGrantRef = useRef(false)
  const prevHasOtherEditorRef = useRef(false)

  const canAct = enabled && connection === "open"
  const otherEditorClientId = useMemo(() => {
    if (editorClientId && editorClientId !== clientId) return editorClientId
    const candidate = Object.entries(participants || {}).find(
      ([id, info]) => id !== clientId && info?.mode === "edit",
    )
    return candidate?.[0] || null
  }, [participants, editorClientId, clientId])

  const hasOtherEditor = Boolean(otherEditorClientId)

  const otherEditorLabel = useMemo(() => {
    if (!otherEditorClientId) return ""
    const info = participants?.[otherEditorClientId]
    return (
      info?.name ||
      info?.clientName ||
      info?.label ||
      info?.title ||
      getStableClientNameFromId(otherEditorClientId)
    )
  }, [participants, otherEditorClientId])

  useEffect(() => {
    if (effectiveMode !== "edit") return
    if (ignoreNextGrantRef.current) {
      ignoreNextGrantRef.current = false
      shouldSwitchToEditRef.current = false
      setIsTrying(false)
      releaseEdit?.()
      return
    }
    if (!shouldSwitchToEditRef.current) return
    shouldSwitchToEditRef.current = false
    setIsTrying(false)
    onSwitchToEdit?.()
    Toast.success("Edit granted")
  }, [effectiveMode, onSwitchToEdit, releaseEdit])

  useEffect(() => {
    if (!editRequestDenied) return
    shouldSwitchToEditRef.current = false
    ignoreNextGrantRef.current = false
    setIsTrying(false)
    clearEditRequestDenied?.()
    Toast.info("Edit request dismissed by editor")
  }, [editRequestDenied, clearEditRequestDenied])

  useEffect(() => {
    if (!forceEditDenied) return
    shouldSwitchToEditRef.current = false
    ignoreNextGrantRef.current = false
    setIsTrying(false)
    clearForceEditDenied?.()
    Toast.error(
      forceEditDenied?.reason === "disabled"
        ? "Force edit is disabled on the server"
        : "Force edit denied",
    )
  }, [forceEditDenied, clearForceEditDenied])

  useEffect(() => {
    if (!isTrying) return
    if (!canAct) {
      shouldSwitchToEditRef.current = false
      ignoreNextGrantRef.current = false
      prevHasOtherEditorRef.current = hasOtherEditor
      setIsTrying(false)
    }
  }, [isTrying, canAct, hasOtherEditor])

  useEffect(() => {
    if (!isTrying) return
    if (!hasOtherEditor) return

    const interval = setInterval(() => {
      requestRelease?.()
    }, 12000)

    return () => {
      clearInterval(interval)
    }
  }, [isTrying, hasOtherEditor, requestRelease])

  useEffect(() => {
    if (!isTrying) {
      prevHasOtherEditorRef.current = hasOtherEditor
      return
    }

    if (prevHasOtherEditorRef.current && !hasOtherEditor) {
      requestEdit?.()
    }
    prevHasOtherEditorRef.current = hasOtherEditor
  }, [isTrying, hasOtherEditor, requestEdit])

  const requestEditWithRetry = ({ force = false } = {}) => {
    if (!canAct) return
    shouldSwitchToEditRef.current = true
    ignoreNextGrantRef.current = false
    setIsTrying(true)

    if (force) {
      forceEdit?.()
    } else {
      requestEdit?.()
      requestRelease?.()
    }
  }

  const editRequestLabel = useMemo(() => {
    if (!editRequest?.fromClientId) return "Edit requested"
    const info = participants?.[editRequest.fromClientId]
    const fromLabel =
      editRequest?.fromClientName ||
      info?.name ||
      info?.clientName ||
      info?.label ||
      info?.title ||
      getStableClientNameFromId(editRequest.fromClientId)
    return `Edit requested (${fromLabel})`
  }, [editRequest?.fromClientId, editRequest?.fromClientName, participants])

  if (!enabled) return null

  return (
    <div
      className={
        inline
          ? "flex flex-wrap items-center justify-end gap-2"
          : "flex flex-col items-end gap-1"
      }
    >
      {effectiveMode === "edit" && editRequest && (
        <div className="flex items-center gap-2">
          <Tag size="small" type="light" color="orange">
            {editRequestLabel}
          </Tag>
          <Tooltip content="Release edit so others can edit">
            <Button size="small" onClick={onSwitchToView}>
              Release
            </Button>
          </Tooltip>
          <Button
            size="small"
            type="tertiary"
            onClick={() => {
              const from = editRequest?.fromClientId
              if (from) dismissEditRequest?.(from)
              clearEditRequest?.()
            }}
          >
            Dismiss
          </Button>
        </div>
      )}

      {effectiveMode === "edit" && !editRequest && (
        <Tooltip content="Release edit so others can edit">
          <Button size="small" onClick={onSwitchToView}>
            Release edit
          </Button>
        </Tooltip>
      )}

      {effectiveMode !== "edit" && (
        <div className="flex items-center gap-2">
          <Tooltip
            content={
              hasOtherEditor
                ? `Ask editor (${otherEditorLabel}) to release`
                : "Try to become editor"
            }
          >
            <Button
              size="small"
              disabled={!canAct || isTrying}
              loading={isTrying}
              onClick={() => requestEditWithRetry({ force: false })}
            >
              Try edit
            </Button>
          </Tooltip>

          {isTrying && (
            <Button
              size="small"
              type="tertiary"
              onClick={() => {
                ignoreNextGrantRef.current = true
                shouldSwitchToEditRef.current = false
                prevHasOtherEditorRef.current = hasOtherEditor
                setIsTrying(false)
              }}
            >
              Cancel
            </Button>
          )}

          <Popconfirm
            title="Force edit?"
            content="This will revoke the current editor and put everyone else in view."
            okText="Force"
            cancelText="Cancel"
            position="bottomRight"
            onConfirm={() => requestEditWithRetry({ force: true })}
          >
            <Button
              size="small"
              disabled={!canAct}
              type="tertiary"
              className="text-red-600"
            >
              Force edit
            </Button>
          </Popconfirm>
        </div>
      )}
    </div>
  )
}
