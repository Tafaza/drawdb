import {
  Image,
  Input,
  Modal as SemiUIModal,
  Spin,
  Toast,
  Checkbox,
} from "@douyinfe/semi-ui";
import { saveAs } from "file-saver";
import { Parser } from "node-sql-parser";
import { Parser as OracleParser } from "oracle-sql-parser";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { DB, MODAL, STATUS, State } from "../../../data/constants";
import { databases } from "../../../data/databases";
import { db } from "../../../data/db";
import {
  useAreas,
  useDiagram,
  useEnums,
  useNotes,
  useSaveState,
  useTasks,
  useTransform,
  useTypes,
  useUndoRedo,
} from "../../../hooks";
import { isRtl } from "../../../i18n/utils/rtl";
import { importSQL } from "../../../utils/importSQL";
import {
  getModalTitle,
  getModalWidth,
  getOkText,
} from "../../../utils/modalData";
import CodeEditor from "../../CodeEditor";
import ImportDiagram from "./ImportDiagram";
import ImportSource from "./ImportSource";
import Language from "./Language";
import New from "./New";
import Open from "./Open";
import Rename from "./Rename";
import SetTableWidth from "./SetTableWidth";
import SetDiagramFontSize from "./SetDiagramFontSize";
import Share from "./Share";
import { IdContext } from "../../Workspace";
import { nanoid } from "nanoid";

const extensionToLanguage = {
  md: "markdown",
  sql: "sql",
  dbml: "dbml",
  json: "json",
};

function ExportTableSelector({
  tables,
  selectedTableIds,
  onChange,
  t,
  disabled,
}) {
  const allSelected =
    tables.length > 0 && selectedTableIds.length === tables.length;
  const indeterminate =
    selectedTableIds.length > 0 && !allSelected && tables.length > 0;

  const toggleTable = (tableId, checked) => {
    if (checked) {
      onChange(
        selectedTableIds.includes(tableId)
          ? selectedTableIds
          : [...selectedTableIds, tableId],
      );
      return;
    }
    onChange(selectedTableIds.filter((id) => id !== tableId));
  };

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{t("tables_to_export")}</div>
        <Checkbox
          aria-label="select all tables"
          indeterminate={indeterminate}
          checked={allSelected}
          disabled={disabled}
          onChange={(e) =>
            onChange(
              e.target.checked ? tables.map((table) => table.id) : [],
            )
          }
        >
          {allSelected ? t("clear") : t("select_all")}
        </Checkbox>
      </div>
      <div className="text-xs text-gray-600 mt-1">
        {t("relationships_filtered_notice")}
      </div>
      {tables.length === 0 ? (
        <div className="text-gray-500 text-sm mt-2">{t("no_tables")}</div>
      ) : (
        <div className="grid grid-cols-2 gap-2 mt-2">
          {tables.map((table) => (
            <Checkbox
              aria-label={`table ${table.name}`}
              key={table.id}
              checked={selectedTableIds.includes(table.id)}
              disabled={disabled}
              onChange={(e) => toggleTable(table.id, e.target.checked)}
            >
              <span className="truncate">{table.name}</span>
            </Checkbox>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Modal({
  modal,
  setModal,
  title,
  setTitle,
  setDiagramId,
  exportData,
  setExportData,
  importDb,
  importFrom,
  tables = [],
  selectedTableIds = [],
  onTableSelectionChange = () => {},
  onResetExportSelection = () => {},
  exportSelectionEnabled = false,
}) {
  const { t, i18n } = useTranslation();
  const { setGistId } = useContext(IdContext);
  const { setTables, setRelationships, database, setDatabase } = useDiagram();
  const { setNotes } = useNotes();
  const { setAreas } = useAreas();
  const { setTypes } = useTypes();
  const { setEnums } = useEnums();
  const { setTasks } = useTasks();
  const { setTransform } = useTransform();
  const { setUndoStack, setRedoStack } = useUndoRedo();
  const { setSaveState } = useSaveState();
  const [uncontrolledTitle, setUncontrolledTitle] = useState(title);
  const [uncontrolledLanguage, setUncontrolledLanguage] = useState(
    i18n.language,
  );
  const [importSource, setImportSource] = useState({
    src: "",
    overwrite: false,
  });
  const [importData, setImportData] = useState(null);
  const [error, setError] = useState({
    type: STATUS.NONE,
    message: "",
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState(-1);
  const [selectedDiagramId, setSelectedDiagramId] = useState(0);
  const [saveAsTitle, setSaveAsTitle] = useState(title);

  const overwriteDiagram = () => {
    setTables(importData.tables);
    setRelationships(importData.relationships);
    setAreas(importData.subjectAreas ?? []);
    setNotes(importData.notes ?? []);
    if (importData.title) {
      setTitle(importData.title);
    }
    if (databases[database].hasEnums && importData.enums) {
      setEnums(importData.enums);
    }
    if (databases[database].hasTypes && importData.types) {
      setTypes(importData.types);
    }
  };

  const loadDiagram = async (id) => {
    await db.diagrams
      .get(id)
      .then((diagram) => {
        if (diagram) {
          if (diagram.database) {
            setDatabase(diagram.database);
          } else {
            setDatabase(DB.GENERIC);
          }
          setDiagramId(diagram.id);
          setTitle(diagram.name);
          setTables(diagram.tables);
          setRelationships(diagram.references);
          setAreas(diagram.areas);
          setNotes(diagram.notes);
          setTasks(diagram.todos ?? []);
          setGistId(diagram.gistId ?? "");
          setTransform({
            pan: diagram.pan,
            zoom: diagram.zoom,
          });
          setUndoStack([]);
          setRedoStack([]);
          if (databases[database].hasTypes) {
            setTypes(
              diagram.types.map((t) =>
                t.id
                  ? t
                  : {
                      ...t,
                      id: nanoid(),
                      fields: t.fields.map((f) =>
                        f.id ? f : { ...f, id: nanoid() },
                      ),
                    },
              ),
            );
          }
          setEnums(
            diagram.enums.map((e) => (!e.id ? { ...e, id: nanoid() } : e)) ??
              [],
          );
          window.name = `d ${diagram.id}`;
          setSaveState(State.SAVING);
        } else {
          window.name = "";
          Toast.error(t("didnt_find_diagram"));
        }
      })
      .catch((error) => {
        console.log(error);
        Toast.error(t("didnt_find_diagram"));
      });
  };

  const parseSQLAndLoadDiagram = () => {
    const targetDatabase = database === DB.GENERIC ? importDb : database;

    let ast = null;
    try {
      if (targetDatabase === DB.ORACLESQL) {
        const oracleParser = new OracleParser();

        ast = oracleParser.parse(importSource.src);
      } else {
        const parser = new Parser();

        ast = parser.astify(importSource.src, {
          database: targetDatabase,
        });
      }
    } catch (error) {
      const message = error.location
        ? `${error.name} [Ln ${error.location.start.line}, Col ${error.location.start.column}]: ${error.message}`
        : error.message;

      setError({ type: STATUS.ERROR, message });
      return;
    }

    try {
      const diagramData = importSQL(
        ast,
        database === DB.GENERIC ? importDb : database,
        database,
      );

      if (importSource.overwrite) {
        setTables(diagramData.tables);
        setRelationships(diagramData.relationships);
        if (databases[database].hasTypes) setTypes(diagramData.types ?? []);
        if (databases[database].hasEnums) setEnums(diagramData.enums ?? []);
        setTransform((prev) => ({ ...prev, pan: { x: 0, y: 0 } }));
        setNotes([]);
        setAreas([]);
      } else {
        setTables((prev) => [...prev, ...diagramData.tables]);
        setRelationships((prev) =>
          [...prev, ...diagramData.relationships].map((r, i) => ({
            ...r,
            id: i,
          })),
        );
        if (databases[database].hasTypes && diagramData.types.length)
          setTypes((prev) => [...prev, ...diagramData.types]);
        if (databases[database].hasEnums && diagramData.enums.length)
          setEnums((prev) => [...prev, ...diagramData.enums]);
      }

      setUndoStack([]);
      setRedoStack([]);

      setModal(MODAL.NONE);
    } catch (e) {
      setError({
        type: STATUS.ERROR,
        message: `Please check for syntax errors or let us know about the error.`,
      });
    }
  };

  const createNewDiagram = (id) => {
    const newWindow = window.open("/editor");
    newWindow.name = "lt " + id;
  };

  const getModalOnOk = async () => {
    switch (modal) {
      case MODAL.IMG:
        saveAs(
          exportData.data,
          `${exportData.filename}.${exportData.extension}`,
        );
        return;
      case MODAL.CODE: {
        const blob = new Blob([exportData.data], {
          type: "application/json",
        });
        saveAs(blob, `${exportData.filename}.${exportData.extension}`);
        return;
      }
      case MODAL.IMPORT:
        if (error.type !== STATUS.ERROR) {
          setTransform((prev) => ({ ...prev, pan: { x: 0, y: 0 } }));
          overwriteDiagram();
          setImportData(null);
          setModal(MODAL.NONE);
          setUndoStack([]);
          setRedoStack([]);
        }
        return;
      case MODAL.IMPORT_SRC:
        parseSQLAndLoadDiagram();
        return;
      case MODAL.OPEN:
        if (selectedDiagramId === 0) return;
        loadDiagram(selectedDiagramId);
        setModal(MODAL.NONE);
        return;
      case MODAL.RENAME:
        setTitle(uncontrolledTitle);
        setModal(MODAL.NONE);
        return;
      case MODAL.SAVEAS:
        setTitle(saveAsTitle);
        setModal(MODAL.NONE);
        return;
      case MODAL.NEW:
        createNewDiagram(selectedTemplateId);
        setModal(MODAL.NONE);
        return;
      case MODAL.LANGUAGE:
        i18n.changeLanguage(uncontrolledLanguage);
        setModal(MODAL.NONE);
        return;
      default:
        setModal(MODAL.NONE);
        return;
    }
  };

  const getModalBody = () => {
    switch (modal) {
      case MODAL.IMPORT:
        return (
          <ImportDiagram
            setImportData={setImportData}
            error={error}
            setError={setError}
            importFrom={importFrom}
          />
        );
      case MODAL.IMPORT_SRC:
        return (
          <ImportSource
            importData={importSource}
            setImportData={setImportSource}
            error={error}
            setError={setError}
          />
        );
      case MODAL.NEW:
        return (
          <New
            selectedTemplateId={selectedTemplateId}
            setSelectedTemplateId={setSelectedTemplateId}
          />
        );
      case MODAL.RENAME:
        return (
          <Rename key={title} title={title} setTitle={setUncontrolledTitle} />
        );
      case MODAL.OPEN:
        return (
          <Open
            selectedDiagramId={selectedDiagramId}
            setSelectedDiagramId={setSelectedDiagramId}
          />
        );
      case MODAL.SAVEAS:
        return (
          <Input
            placeholder={t("name")}
            value={saveAsTitle}
            onChange={(v) => setSaveAsTitle(v)}
          />
        );
      case MODAL.CODE:
      case MODAL.IMG:
        {
          const showSelector = modal === MODAL.CODE && exportSelectionEnabled;
          const hasSelection =
            !showSelector || selectedTableIds.length > 0;
          const hasData =
            hasSelection &&
            exportData.data !== "" &&
            exportData.data !== null &&
            exportData.data !== undefined;

          return (
            <>
              {showSelector && (
                <ExportTableSelector
                  tables={tables}
                  selectedTableIds={selectedTableIds}
                  onChange={onTableSelectionChange}
                  t={t}
                />
              )}
              {hasData ? (
                modal === MODAL.IMG ? (
                  <Image src={exportData.data} alt="Diagram" height={280} />
                ) : (
                  <CodeEditor
                    height={360}
                    value={exportData.data}
                    language={extensionToLanguage[exportData.extension]}
                    options={{ readOnly: true }}
                    showCopyButton={true}
                  />
                )
              ) : (
                <div className="text-center my-3 text-sky-600">
                  {showSelector && selectedTableIds.length === 0 ? (
                    <div>{t("select_tables_to_export")}</div>
                  ) : (
                    <Spin tip={t("loading")} size="large" />
                  )}
                </div>
              )}
              <div className="text-sm font-semibold mt-2">{t("filename")}:</div>
              <Input
                value={exportData.filename}
                placeholder={t("filename")}
                suffix={<div className="p-2">{`.${exportData.extension}`}</div>}
                onChange={(value) =>
                  setExportData((prev) => ({ ...prev, filename: value }))
                }
                field="filename"
              />
            </>
          );
        }
      case MODAL.TABLE_WIDTH:
        return <SetTableWidth />;
      case MODAL.FONT_SIZE:
        return <SetDiagramFontSize />;
      case MODAL.LANGUAGE:
        return (
          <Language
            language={uncontrolledLanguage}
            setLanguage={setUncontrolledLanguage}
          />
        );
      case MODAL.SHARE:
        return <Share title={title} setModal={setModal} />;
      default:
        return <></>;
    }
  };

  return (
    <SemiUIModal
      style={isRtl(i18n.language) ? { direction: "rtl" } : {}}
      title={getModalTitle(modal)}
      visible={modal !== MODAL.NONE}
      onOk={getModalOnOk}
      afterClose={() => {
        setExportData(() => ({
          data: "",
          extension: "",
          filename: `${title}_${new Date().toISOString()}`,
        }));
        onResetExportSelection();
        setError({
          type: STATUS.NONE,
          message: "",
        });
        setImportData(null);
        setImportSource({
          src: "",
          overwrite: false,
        });
      }}
      onCancel={() => {
        if (modal === MODAL.RENAME) setUncontrolledTitle(title);
        if (modal === MODAL.LANGUAGE) setUncontrolledLanguage(i18n.language);
        setModal(MODAL.NONE);
      }}
      centered
      closeOnEsc={true}
      okText={getOkText(modal)}
      okButtonProps={{
        disabled:
          (error && error?.type === STATUS.ERROR) ||
          (modal === MODAL.IMPORT &&
            (error.type === STATUS.ERROR || !importData)) ||
          (modal === MODAL.RENAME && title === "") ||
          ((modal === MODAL.IMG || modal === MODAL.CODE) && !exportData.data) ||
          (modal === MODAL.SAVEAS && saveAsTitle === "") ||
          (modal === MODAL.IMPORT_SRC && importSource.src === ""),
        hidden: modal === MODAL.SHARE,
      }}
      hasCancel={modal !== MODAL.SHARE}
      cancelText={t("cancel")}
      width={getModalWidth(modal)}
      bodyStyle={{
        maxHeight: window.innerHeight - 280,
        overflow:
          modal === MODAL.CODE || modal === MODAL.IMG ? "hidden" : "auto",
        direction: "ltr",
      }}
    >
      {getModalBody()}
    </SemiUIModal>
  );
}
