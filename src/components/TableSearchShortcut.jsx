import { useEffect, useMemo, useState } from "react";
import { AutoComplete, Modal } from "@douyinfe/semi-ui";
import { IconSearch } from "@douyinfe/semi-icons";
import { useTranslation } from "react-i18next";
import { useHotkeys } from "react-hotkeys-hook";
import { useDiagram, useTableFocus } from "../hooks";

export default function TableSearchShortcut() {
  const { tables } = useDiagram();
  const { focusTableById } = useTableFocus();
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  useHotkeys(
    "mod+k",
    (event) => {
      event.preventDefault();
      setVisible(true);
    },
    { enableOnFormTags: true, preventDefault: true },
  );

  useEffect(() => {
    if (!visible) {
      setSearchValue("");
    }
  }, [visible]);

  const options = useMemo(
    () =>
      tables.map((table) => ({
        value: table.id,
        label: table.name,
      })),
    [tables],
  );

  const filteredOptions = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return options;

    return options.filter((option) =>
      option.label?.toLowerCase().includes(query),
    );
  }, [options, searchValue]);

  const handleSelect = (option) => {
    const targetId =
      typeof option === "object" && option !== null ? option.value : option;

    if (!targetId) return;

    if (focusTableById(targetId)) {
      setVisible(false);
      setSearchValue("");
    }
  };

  const handleEnter = (e) => {
    if (e.key !== "Enter") return;
    const topMatch = filteredOptions[0];
    if (topMatch) {
      e.preventDefault();
      handleSelect(topMatch);
    }
  };

  return (
    <Modal
      title={t("search")}
      visible={visible}
      onCancel={() => setVisible(false)}
      footer={null}
      closable
      maskClosable
    >
      <AutoComplete
        autoFocus
        data={filteredOptions}
        value={searchValue}
        prefix={<IconSearch />}
        placeholder={t("search")}
        showClear
        onSearch={setSearchValue}
        onChange={setSearchValue}
        onSelect={handleSelect}
        onSelectWithObject
        renderSelectedItem={(option) =>
          typeof option === "object" && option !== null
            ? `${option.label ?? ""}`
            : `${option ?? ""}`
        }
        renderItem={(option) => (
          <div className="flex items-center justify-between">
            <span className="truncate">{option.label}</span>
          </div>
        )}
        emptyContent={<div className="p-3 popover-theme">{t("not_found")}</div>}
        className="w-full"
        onKeyDown={handleEnter}
      />
    </Modal>
  );
}
