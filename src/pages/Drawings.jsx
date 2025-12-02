import { useCallback, useEffect, useMemo, useState } from "react";
import Navbar from "../components/Navbar";
import { Banner, Button, Spin, Tag, Toast } from "@douyinfe/semi-ui";
import { del as deleteGist, get, list, SHARE_FILENAME } from "../api/gists";

const FALLBACK_TITLE = "Untitled diagram";

function coalescePayload(raw) {
  if (!raw) return {};
  // API responses tend to wrap data under `data`
  return raw.data || raw;
}

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

async function hydrateShare(gistSummary) {
  try {
    const payload = coalescePayload(gistSummary);
    const id = payload.id || gistSummary?.id;
    const hasShareFile = payload.files?.[SHARE_FILENAME];
    let shareFile = payload.files?.[SHARE_FILENAME];
    let updatedAt = payload.updated_at || payload.created_at;

    if (!shareFile || !shareFile.content) {
      const full = coalescePayload(await get(id));
      shareFile = full.files?.[SHARE_FILENAME] || shareFile;
      updatedAt = full.updated_at || updatedAt;
    }

    const parsed = shareFile?.content ? JSON.parse(shareFile.content) : null;
    const title = parsed?.title || payload.description || FALLBACK_TITLE;

    return {
      id,
      title,
      updatedAt,
      description: payload.description || "",
      hasContent: Boolean(shareFile?.content),
      size: shareFile?.size,
    };
  } catch (e) {
    return {
      id: gistSummary?.id,
      title: gistSummary?.description || FALLBACK_TITLE,
      updatedAt: gistSummary?.updated_at,
      error: true,
    };
  }
}

export default function Drawings() {
  const [drawings, setDrawings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [removing, setRemoving] = useState(null);

  const fetchDrawings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const raw = await list();
      const payload = coalescePayload(raw);
      const items = Array.isArray(payload) ? payload : payload.data || [];
      const candidates = items.filter(
        (g) => coalescePayload(g).files?.[SHARE_FILENAME],
      );

      const hydrated = await Promise.all(candidates.map(hydrateShare));
      setDrawings(hydrated);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "My Drawings | drawDB";
    fetchDrawings();
  }, [fetchDrawings]);

  const handleDelete = useCallback(
    async (id) => {
      if (!id) return;
      setRemoving(id);
      try {
        await deleteGist(id);
        setDrawings((prev) => prev.filter((d) => d.id !== id));
        Toast.success("Diagram removed");
      } catch (e) {
        Toast.error("Failed to remove diagram");
      } finally {
        setRemoving(null);
      }
    },
    [setDrawings],
  );

  const content = useMemo(() => {
    if (loading) {
      return (
        <div className="flex justify-center py-12">
          <Spin size="large" />
        </div>
      );
    }

    if (error) {
      return (
        <Banner
          type="danger"
          description="Could not load drawings for this token."
          fullMode={false}
        />
      );
    }

    if (!drawings.length) {
      return (
        <div className="text-center text-zinc-500 py-12">
          No drawings found for this GitHub token.
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {drawings.map((item) => (
          <div
            key={item.id}
            className="border border-zinc-200 rounded-lg p-4 flex items-center justify-between hover:border-sky-200 transition-colors bg-white"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="text-lg font-semibold">{item.title}</div>
                {item.error && (
                  <Tag color="red" size="large">
                    Load failed
                  </Tag>
                )}
              </div>
              <div className="text-sm text-zinc-500">
                ID: {item.id} • Updated {formatDate(item.updatedAt)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                disabled={item.error}
                onClick={() => window.open(`/editor?shareId=${item.id}`, "_blank")}
              >
                Open
              </Button>
              <Button
                type="danger"
                loading={removing === item.id}
                onClick={() => handleDelete(item.id)}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  }, [drawings, loading, error, removing, handleDelete]);

  return (
    <div className="min-h-screen bg-zinc-100">
      <Navbar />
      <div className="max-w-5xl mx-auto px-6 md:px-4 pb-16">
        <div className="flex justify-between items-center mt-8 mb-4">
          <div>
            <div className="text-3xl font-bold text-sky-900">Your drawings</div>
            <div className="text-sm text-zinc-600">
              Lists diagrams accessible by the configured GitHub token.
            </div>
          </div>
          <Button onClick={fetchDrawings}>Refresh</Button>
        </div>
        <div className="bg-white border border-zinc-200 shadow-xs rounded-xl p-5">
          {content}
        </div>
        <div className="mt-6 text-xs text-zinc-500">
          Note: this page lists gists where a `{SHARE_FILENAME}` file exists.
          Removing a diagram deletes the gist.
        </div>
      </div>
    </div>
  );
}
