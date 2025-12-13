import { Banner, Button, Input, Spin, Toast } from "@douyinfe/semi-ui";
import { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { IdContext } from "../../Workspace";
import { IconLink } from "@douyinfe/semi-icons";
import {
  useAreas,
  useDiagram,
  useEnums,
  useNotes,
  useTypes,
} from "../../../hooks";
import { databases } from "../../../data/databases";
import { MODAL } from "../../../data/constants";
import { create, get, patch, SHARE_FILENAME } from "../../../api/gists";

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!value || typeof value !== "object") return value;
  const sorted = {};
  Object.keys(value)
    .sort()
    .forEach((key) => {
      sorted[key] = sortKeysDeep(value[key]);
    });
  return sorted;
}

function normalizeJsonString(value) {
  if (typeof value !== "string") return "";
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(sortKeysDeep(parsed));
  } catch (e) {
    return value.trim();
  }
}

function coalescePayload(raw) {
  if (!raw) return {};
  return raw.data || raw;
}

export default function Share({ title, setModal }) {
  const { t } = useTranslation();
  const { gistId, setGistId } = useContext(IdContext);
  const [loading, setLoading] = useState(true);
  const { tables, relationships, database } = useDiagram();
  const { notes } = useNotes();
  const { areas } = useAreas();
  const { types } = useTypes();
  const { enums } = useEnums();
  const [error, setError] = useState(null);
  const baseUrl =
    window.location.origin + window.location.pathname + "?shareId=" + gistId;
  const viewUrl = baseUrl + "&mode=view";
  const editUrl = baseUrl + "&mode=edit";

  const diagramToString = useCallback(() => {
    return JSON.stringify(
      {
        title,
        tables: tables,
        relationships: relationships,
        notes: notes,
        subjectAreas: areas,
        database: database,
        ...(databases[database].hasTypes && { types: types }),
        ...(databases[database].hasEnums && { enums: enums }),
      },
      null,
      2,
    );
  }, [
    areas,
    notes,
    tables,
    relationships,
    database,
    title,
    enums,
    types,
  ]);

  const unshare = useCallback(async () => {
    try {
      const deleted = await patch(gistId, SHARE_FILENAME, undefined);
      if (deleted) {
        setGistId("");
      }
      setModal(MODAL.NONE);
    } catch (e) {
      console.error(e);
      setError(e);
    }
  }, [gistId, setModal, setGistId]);

  useEffect(() => {
    const updateOrGenerateLink = async () => {
      try {
        setLoading(true);
        if (!gistId || gistId === "") {
          const id = await create(SHARE_FILENAME, diagramToString());
          setGistId(id);
        } else {
          const raw = await get(gistId);
          const payload = coalescePayload(raw);
          const existing = payload.files?.[SHARE_FILENAME]?.content ?? "";
          const next = diagramToString();

          if (normalizeJsonString(existing) !== normalizeJsonString(next)) {
            await patch(gistId, SHARE_FILENAME, next);
          }
        }
      } catch (e) {
        setError(e);
      } finally {
        setLoading(false);
      }
    };
    updateOrGenerateLink();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyLink = (value) => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        Toast.success(t("copied_to_clipboard"));
      })
      .catch(() => {
        Toast.error(t("oops_smth_went_wrong"));
      });
  };

  if (loading)
    return (
      <div className="text-blue-500 text-center">
        <Spin size="middle" />
        <div>{t("loading")}</div>
      </div>
    );

  return (
    <div>
      {error && (
        <Banner
          description={t("oops_smth_went_wrong")}
          type="danger"
          closeIcon={null}
          fullMode={false}
        />
      )}
      {!error && (
        <>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input value={viewUrl} size="large" readOnly />
              <Button theme="solid" icon={<IconLink />} onClick={() => copyLink(viewUrl)}>
                {t("copy_link")}
              </Button>
            </div>
            <div className="flex gap-2">
              <Input value={editUrl} size="large" readOnly />
              <Button theme="solid" icon={<IconLink />} onClick={() => copyLink(editUrl)}>
                {t("copy_link")}
              </Button>
            </div>
          </div>
          <div className="text-xs mt-2">{t("share_info")}</div>
          <div className="flex gap-2 mt-3">
            <Button block onClick={unshare}>
              {t("unshare")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
