import { Spin, Tag, Tooltip } from "@douyinfe/semi-ui";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";

export default function CollabMetadata({
  shareId,
  lastModified,
  revision,
  isLoading,
  dirty = false,
  persistError = false,
}) {
  const { t, i18n } = useTranslation();

  if (!shareId && !isLoading) return null;

  const formattedDate = lastModified
    ? DateTime.fromISO(lastModified)
        .setLocale(i18n.language)
        .toLocaleString(DateTime.DATETIME_MED)
    : null;

  if (!isLoading && !formattedDate && !revision) {
    return null;
  }

  return (
    <div className="text-xs text-gray-500 flex items-center gap-2 min-w-0">
      {isLoading && (
        <>
          <Spin size="small" />
          <span>{t("loading")}</span>
        </>
      )}
      {!isLoading && formattedDate && (
        <Tooltip content={`${t("last_modified")}: ${formattedDate}`}>
          <span className="truncate max-w-[220px]">
            {t("last_modified")}: {formattedDate}
          </span>
        </Tooltip>
      )}
      {!isLoading && dirty && (
        <Tag size="small" type="light" color="orange">
          {t("saving")}
        </Tag>
      )}
      {!isLoading && persistError && (
        <Tag size="small" type="danger">
          {t("failed_to_save")}
        </Tag>
      )}
      {!isLoading && revision && (
        <Tooltip content={`${t("revision")}: ${revision}`}>
          <Tag size="small" type="light">
            rev {revision.substring(0, 7)}
          </Tag>
        </Tooltip>
      )}
    </div>
  );
}
