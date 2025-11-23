import { InputNumber, Slider, Space } from "@douyinfe/semi-ui";
import { useLayout, useSettings } from "../../../hooks";

const MIN = 10;
const MAX = 24;

export default function SetDiagramFontSize() {
  const { layout } = useLayout();
  const { settings, setSettings } = useSettings();

  const update = (value) => {
    if (!value) return;
    const clamped = Math.min(Math.max(value, MIN), MAX);
    setSettings((prev) => ({ ...prev, diagramFontSize: clamped }));
  };

  return (
    <Space vertical className="w-full">
      <Slider
        min={MIN}
        max={MAX}
        value={settings.diagramFontSize}
        onChange={update}
        disabled={layout.readOnly}
      />
      <InputNumber
        className="w-full"
        value={settings.diagramFontSize}
        readonly={layout.readOnly}
        min={MIN}
        max={MAX}
        onChange={update}
      />
    </Space>
  );
}
