import { useCallback } from "react";
import { useDiagram, useSelect, useSettings, useTransform } from ".";
import { ObjectType, Tab, tableWidth as defaultTableWidth } from "../data/constants";
import { getTableHeight } from "../utils/utils";

export default function useTableFocus() {
  const { tables } = useDiagram();
  const { settings } = useSettings();
  const { setTransform } = useTransform();
  const { setSelectedElement } = useSelect();

  const focusTableById = useCallback(
    (tableId) => {
      const table = tables.find((t) => t.id === tableId);
      if (!table) return false;

      const width = settings.tableWidth ?? defaultTableWidth;
      const centerX = table.x + width / 2;
      const centerY = table.y + getTableHeight(table) / 2;

      setTransform((prev) => ({
        ...prev,
        pan: {
          x: centerX,
          y: centerY,
        },
      }));

      setSelectedElement((prev) => ({
        ...prev,
        element: ObjectType.TABLE,
        id: tableId,
        open: true,
        currentTab: Tab.TABLES,
      }));

      return true;
    },
    [setSelectedElement, setTransform, settings.tableWidth, tables],
  );

  return { focusTableById };
}
