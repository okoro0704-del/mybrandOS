import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type {
  Asset,
  AssetGroupBy,
  AssetLibraryCategory,
  AssetOrigin,
  AssetQuery,
  AssetSortDir,
  AssetSortField,
  AssetStatus,
  AssetSummary,
} from "@mybrandos/shared";
import { api } from "../lib/api";

type AssetState = {
  assets: Asset[];
  summary: AssetSummary | null;
  loading: boolean;
  query: Required<Pick<AssetQuery, "search" | "category" | "sort" | "dir" | "groupBy">> & {
    status?: AssetStatus;
    origin?: AssetOrigin;
    published?: boolean;
    imported?: boolean;
    hasProject?: boolean;
    hasPersonalSpace?: boolean;
    hasRevenue?: boolean;
    hasAudience?: boolean;
    createdAfter?: string;
    updatedAfter?: string;
  };
  setSearch: (search: string) => void;
  setCategory: (category: AssetLibraryCategory) => void;
  setStatus: (status?: AssetStatus) => void;
  setOrigin: (origin?: AssetOrigin) => void;
  setFlag: (key: "published" | "imported" | "hasProject" | "hasPersonalSpace" | "hasRevenue" | "hasAudience", value?: boolean) => void;
  setCreatedAfter: (createdAfter?: string) => void;
  setUpdatedAfter: (updatedAfter?: string) => void;
  setSort: (sort: AssetSortField, dir?: AssetSortDir) => void;
  setGroupBy: (groupBy: AssetGroupBy) => void;
  refresh: () => Promise<void>;
  getOne: (id: string) => Promise<Asset | null>;
  updateStatus: (id: string, status: AssetStatus) => Promise<void>;
};

const AssetContext = createContext<AssetState | null>(null);

export function AssetProvider({ children }: { children: ReactNode }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [summary, setSummary] = useState<AssetSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState<AssetState["query"]>({
    search: "",
    category: "ALL",
    sort: "updatedAt",
    dir: "desc",
    groupBy: "none",
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.search) params.set("search", query.search);
      if (query.category) params.set("category", query.category);
      if (query.status) params.set("status", query.status);
      if (query.origin) params.set("origin", query.origin);
      if (query.published) params.set("published", "true");
      if (query.imported) params.set("imported", "true");
      if (query.hasProject) params.set("hasProject", "true");
      if (query.hasPersonalSpace) params.set("hasPersonalSpace", "true");
      if (query.hasRevenue) params.set("hasRevenue", "true");
      if (query.hasAudience) params.set("hasAudience", "true");
      if (query.createdAfter) params.set("createdAfter", query.createdAfter);
      if (query.updatedAfter) params.set("updatedAfter", query.updatedAfter);
      params.set("sort", query.sort);
      params.set("dir", query.dir);
      const [list, sum] = await Promise.all([
        api<{ assets: Asset[] }>(`/assets?${params}`),
        api<AssetSummary>("/assets/summary"),
      ]);
      setAssets(list.assets);
      setSummary(sum);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const getOne = useCallback(async (id: string) => {
    try {
      const data = await api<{ asset: Asset }>(`/assets/${id}`);
      return data.asset;
    } catch {
      return null;
    }
  }, []);

  const updateStatus = useCallback(async (id: string, status: AssetStatus) => {
    await api(`/assets/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await refresh();
  }, [refresh]);

  const value = useMemo<AssetState>(
    () => ({
      assets,
      summary,
      loading,
      query,
      setSearch: (search) => setQuery((q) => ({ ...q, search })),
      setCategory: (category) => setQuery((q) => ({ ...q, category })),
      setStatus: (status) => setQuery((q) => ({ ...q, status, published: undefined })),
      setOrigin: (origin) => setQuery((q) => ({ ...q, origin, imported: undefined })),
      setFlag: (key, value) => setQuery((q) => ({ ...q, [key]: value })),
      setCreatedAfter: (createdAfter) => setQuery((q) => ({ ...q, createdAfter })),
      setUpdatedAfter: (updatedAfter) => setQuery((q) => ({ ...q, updatedAfter })),
      setSort: (sort, dir) => setQuery((q) => ({ ...q, sort, dir: dir ?? q.dir })),
      setGroupBy: (groupBy) => setQuery((q) => ({ ...q, groupBy })),
      refresh,
      getOne,
      updateStatus,
    }),
    [assets, summary, loading, query, refresh, getOne, updateStatus],
  );

  return <AssetContext.Provider value={value}>{children}</AssetContext.Provider>;
}

export function useAssets() {
  const ctx = useContext(AssetContext);
  if (!ctx) throw new Error("useAssets must be used inside AssetProvider");
  return ctx;
}
