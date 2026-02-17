// ============================================================
// API Client Hooks
// Connects the frontend to the Nexus API routes
// ============================================================

import { useState, useEffect, useCallback } from "react";

const API_BASE = "/api";

// Generic fetcher
async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || "API request failed");
  }

  return data.data;
}

// --- Dashboard ---

export function useDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const result = await apiFetch("/dashboard");
      setData(result);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}

// --- Sources / Content ---

export function useSources(params?: {
  type?: string;
  themeId?: string;
  search?: string;
}) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams();
      if (params?.type) queryParams.set("type", params.type);
      if (params?.themeId) queryParams.set("themeId", params.themeId);
      if (params?.search) queryParams.set("search", params.search);

      const result = await apiFetch<any>(
        `/content?${queryParams.toString()}`
      );
      setData(result);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [params?.type, params?.themeId, params?.search]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { sources: data, loading, error, refresh };
}

export function useSource(id: string) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    apiFetch(`/content/${id}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [id]);

  return { source: data, loading };
}

// --- Ingestion ---

export function useIngest() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);

  const ingest = async (url: string, type?: string) => {
    try {
      setLoading(true);
      setError(null);
      const result = await apiFetch<{ sourceId: string }>("/content/ingest", {
        method: "POST",
        body: JSON.stringify({ url, type }),
      });
      setSourceId(result.sourceId);
      return result.sourceId;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { ingest, loading, error, sourceId };
}

// --- Claims ---

export function useClaims(params?: {
  themeId?: string;
  status?: string;
  sortBy?: string;
}) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams();
      if (params?.themeId) queryParams.set("themeId", params.themeId);
      if (params?.status) queryParams.set("status", params.status);
      if (params?.sortBy) queryParams.set("sortBy", params.sortBy);

      const result = await apiFetch<any[]>(`/claims?${queryParams.toString()}`);
      setData(result);
    } catch (err) {
      console.error("Failed to fetch claims:", err);
    } finally {
      setLoading(false);
    }
  }, [params?.themeId, params?.status, params?.sortBy]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { claims: data, loading, refresh };
}

// --- Themes ---

export function useThemes() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const result = await apiFetch<any[]>("/themes");
      setData(result);
    } catch (err) {
      console.error("Failed to fetch themes:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { themes: data, loading, refresh };
}

export function useThemeDetail(id: string) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    apiFetch(`/themes/${id}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [id]);

  return { theme: data, loading };
}

// --- Review ---

export function useReviewQueue(themeId?: string) {
  const [data, setData] = useState<{ items: any[]; totalDue: number }>({
    items: [],
    totalDue: 0,
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const params = themeId ? `?themeId=${themeId}` : "";
      const result = await apiFetch<{ items: any[]; totalDue: number }>(
        `/review/queue${params}`
      );
      setData(result);
    } catch (err) {
      console.error("Failed to fetch review queue:", err);
    } finally {
      setLoading(false);
    }
  }, [themeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...data, loading, refresh };
}

export function useReviewRate() {
  const [loading, setLoading] = useState(false);

  const rate = async (
    cardId: string,
    rating: 1 | 2 | 3 | 4,
    promptType?: string,
    responseTimeMs?: number
  ) => {
    try {
      setLoading(true);
      const result = await apiFetch<any>("/review/rate", {
        method: "POST",
        body: JSON.stringify({ cardId, rating, promptType, responseTimeMs }),
      });
      return result;
    } catch (err) {
      console.error("Failed to submit rating:", err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { rate, loading };
}
