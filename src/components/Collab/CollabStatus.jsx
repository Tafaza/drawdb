import { Button, Input, Modal, Tag, Tooltip } from "@douyinfe/semi-ui";
import { useMemo, useState } from "react";
import { useCollab } from "../../hooks/useCollab";
import { getStableClientNameFromId } from "../../utils/clientName";

const STATUS_COLORS = {
  open: "green",
  connecting: "yellow",
  error: "red",
  closed: "grey",
  disabled: "grey",
};

export default function CollabStatus({ showClient = false }) {
  const {
    enabled,
    connection,
    participants,
    mode,
    lastError,
    persist,
    clientId,
    clientName,
    setClientName,
  } = useCollab();
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState(clientName || "");

  const label = useMemo(() => {
    if (!enabled) return "Collab off";
    return connection;
  }, [enabled, connection]);

  const count = enabled ? Object.keys(participants || {}).length : 0;
  const color = STATUS_COLORS[connection] || "grey";

  const selfLabel = useMemo(() => {
    if (!enabled) return "";
    const info = participants?.[clientId];
    return (
      info?.name ||
      info?.clientName ||
      info?.label ||
      info?.title ||
      getStableClientNameFromId(clientId)
    );
  }, [enabled, participants, clientId]);

  const displayClientLabel = clientName || selfLabel;

  return (
    <>
      <Tooltip
        content={
          enabled
            ? `Mode: ${mode} • Participants: ${count}${
                persist?.status === "error" ? " • Persist error" : ""
              }${showClient && displayClientLabel ? ` • Client: ${displayClientLabel}` : ""}${
                lastError ? " • Error" : ""
              }${showClient ? " • Click to rename" : ""}`
            : "Live collaboration disabled"
        }
      >
        <button
          type="button"
          className={showClient ? "cursor-pointer" : "cursor-default"}
          onClick={() => {
            if (!showClient) return;
            setDraftName(clientName || "");
            setRenameOpen(true);
          }}
        >
          <Tag color={color} size="large">
            <span className="flex items-center gap-2">
              <i className="bi bi-people" />
              {label}
              {enabled && <span className="text-xs">({count})</span>}
              {enabled && showClient && displayClientLabel && (
                <span className="text-xs text-gray-600">
                  • {displayClientLabel}
                </span>
              )}
              {enabled && persist?.status === "error" && (
                <span className="text-xs text-red-500">persist</span>
              )}
            </span>
          </Tag>
        </button>
      </Tooltip>

      <Modal
        title="Participant name"
        visible={renameOpen}
        onCancel={() => setRenameOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="tertiary" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button
              type="primary"
              onClick={() => {
                setClientName?.(draftName);
                setRenameOpen(false);
              }}
            >
              Save
            </Button>
          </div>
        }
      >
        <Input
          value={draftName}
          maxLength={48}
          placeholder="e.g. Alice"
          onChange={(value) => setDraftName(value)}
          onEnterPress={() => {
            setClientName?.(draftName);
            setRenameOpen(false);
          }}
        />
        <div className="text-xs text-gray-600 mt-2">
          This name identifies you in collaboration (edit requests, status, etc).
        </div>
      </Modal>
    </>
  );
}
