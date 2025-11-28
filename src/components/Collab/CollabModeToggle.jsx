import { Button, ButtonGroup, Tooltip } from "@douyinfe/semi-ui";
import { useCollab } from "../../hooks/useCollab";

export default function CollabModeToggle({ mode = "edit", onChange }) {
  const { enabled } = useCollab();

  const handleSelect = (nextMode) => {
    if (nextMode === mode) return;
    onChange?.(nextMode);
  };

  return (
    <Tooltip
      content={
        enabled
          ? "Switch collaboration mode (Edit/View)"
          : "Live collaboration disabled"
      }
    >
      <ButtonGroup size="small">
        <Button
          type={mode === "edit" ? "primary" : "tertiary"}
          disabled={!enabled}
          onClick={() => handleSelect("edit")}
        >
          Edit
        </Button>
        <Button
          type={mode === "view" ? "primary" : "tertiary"}
          disabled={!enabled}
          onClick={() => handleSelect("view")}
        >
          View
        </Button>
      </ButtonGroup>
    </Tooltip>
  );
}
