import { useMemo } from "react";
import { useTableFocus } from "../../../hooks";
import { TreeSelect } from "@douyinfe/semi-ui";
import { IconSearch } from "@douyinfe/semi-icons";
import { useTranslation } from "react-i18next";

export default function SearchBar({ tables }) {
  const { focusTableById } = useTableFocus();
  const { t } = useTranslation();

  const treeData = useMemo(() => {
    return tables.map(({ id, name: parentName, fields }, i) => {
      const children = fields?.map(({ name }, j) => ({
        tableId: id,
        id: `${j}`,
        label: name,
        value: name,
        key: `${i}-${j}`,
      }));

      return {
        tableId: id,
        id: `${i}`,
        label: parentName,
        value: parentName,
        key: `${i}`,
        children,
      };
    });
  }, [tables]);

  return (
    <TreeSelect
      searchPosition="trigger"
      dropdownStyle={{ maxHeight: 400, overflow: "auto" }}
      treeData={treeData}
      prefix={<IconSearch />}
      emptyContent={<div className="p-3 popover-theme">{t("not_found")}</div>}
      filterTreeNode
      placeholder={t("search")}
      onChange={(node) => {
        if (!node?.tableId) return;

        const { tableId, id, children } = node;

        focusTableById(tableId);

        document
          .getElementById(`scroll_table_${tableId}`)
          ?.scrollIntoView({ behavior: "smooth" });

        if (!children) {
          document
            .getElementById(`scroll_table_${tableId}_input_${id}`)
            ?.focus();
        }
      }}
      onChangeWithObject
      className="w-full"
    />
  );
}
