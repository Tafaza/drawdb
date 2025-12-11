import { Tag, Tooltip } from "@douyinfe/semi-ui";
import { useMemo } from "react";
import { useCollab } from "../../hooks/useCollab";

const STATUS_COLORS = {
  open: "green",
  connecting: "yellow",
  error: "red",
  closed: "grey",
  disabled: "grey",
};

export default function CollabStatus() {
  const { enabled, connection, participants, mode, lastError, persist } = useCollab();

  const label = useMemo(() => {
    if (!enabled) return "Collab off";
    return connection;
  }, [enabled, connection]);

  const count = enabled ? Object.keys(participants || {}).length : 0;
  const color = STATUS_COLORS[connection] || "grey";

  return (
    <Tooltip
      content={
        enabled
          ? `Mode: ${mode} • Participants: ${count}${
              persist?.status === "error" ? " • Persist error" : ""
            }${lastError ? " • Error" : ""}`
          : "Live collaboration disabled"
      }
    >
      <Tag color={color} size="large">
        <span className="flex items-center gap-2">
          <i className="bi bi-people" />
          {label}
          {enabled && <span className="text-xs">({count})</span>}
          {enabled && persist?.status === "error" && (
            <span className="text-xs text-red-500">persist</span>
          )}
        </span>
      </Tag>
    </Tooltip>
  );
}
