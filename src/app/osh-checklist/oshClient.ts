"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAllowedProperties } from "@/lib/allowedProperties";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_CHECKLIST,
  DEFAULT_PROPERTIES,
  generateDefaultTemplate,
  type OshCategory,
  type OshChecklistItem,
  type OshEmailSettings,
} from "@/lib/osh/defaults";

/**
 * What the three OSH pages share: the settings (with the prototype's
 * built-in defaults for anything never saved), the signed-in user, and which
 * properties that user may pick.
 *
 * Every call is same-origin /api - deliberately NOT NEXT_PUBLIC_API_URL,
 * which points at a stale deployment without newer endpoints.
 */

export interface OshSettings {
  properties: string[];
  categories: OshCategory[];
  checklist: OshChecklistItem[];
  emails: OshEmailSettings;
  template: string;
}

export type OshSettingKey = keyof OshSettings;

export async function apiJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...(init?.headers || {}) } : init?.headers,
  });
  let res: { status?: string; detail?: string; data?: T } = {};
  try {
    res = await response.json();
  } catch {
    // A non-JSON error page (a proxy timeout, say) - reported below.
  }
  if (!response.ok || res.status !== "success") {
    throw new Error(res.detail || `Request failed (${response.status})`);
  }
  return res.data as T;
}

const withDefaults = (saved: Partial<Record<OshSettingKey, unknown>>): OshSettings => ({
  properties: (saved.properties as string[] | null) ?? DEFAULT_PROPERTIES,
  categories: (saved.categories as OshCategory[] | null) ?? DEFAULT_CATEGORIES,
  checklist: (saved.checklist as OshChecklistItem[] | null) ?? DEFAULT_CHECKLIST,
  emails: (saved.emails as OshEmailSettings | null) ?? {},
  // The prototype's own initial template: NARAI Format built from the
  // DEFAULT lists, not the current ones - regenerating against the current
  // checklist is what Setting > Report Templates' button is for.
  template: (saved.template as string | null) ?? generateDefaultTemplate(DEFAULT_CATEGORIES, DEFAULT_CHECKLIST),
});

export function useOshSettings() {
  const [settings, setSettings] = useState<OshSettings | null>(null);
  const [storageReady, setStorageReady] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/osh/settings");
        const res = await response.json();
        if (!response.ok || res.status !== "success") throw new Error(res.detail || "Could not load OSH settings");
        if (cancelled) return;
        setStorageReady(res.storage_ready !== false);
        setSettings(withDefaults(res.data || {}));
      } catch (err) {
        if (cancelled) return;
        // Still usable - on the built-in defaults - rather than a dead page.
        setLoadError(err instanceof Error ? err.message : String(err));
        setSettings(withDefaults({}));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Persist one setting, then reflect it on screen. Throws on failure so the
   * caller can say so - the prototype could never fail to save. */
  const save = useCallback(async <K extends OshSettingKey>(key: K, value: OshSettings[K], actor: string | null) => {
    await apiJson(`/api/osh/settings/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value, actor }),
    });
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  return { settings, storageReady, loadError, save };
}

export interface OshUser {
  id: string;
  name: string | null;
}

/** The signed-in user - their id keys the draft, their name is recorded as
 * who saved/submitted. */
export function useOshUser() {
  const [user, setUser] = useState<OshUser | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser || cancelled) return;
      const { data } = await supabase.from("profiles").select("full_name").eq("id", authUser.id).single();
      if (!cancelled) setUser({ id: authUser.id, name: data?.full_name || authUser.email || null });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return user;
}

/**
 * The OSH property list narrowed to what this user's role may see
 * (role_permissions.restricted_properties, via getAllowedProperties - the
 * same rule the app-wide property switcher follows). An unrestricted role
 * sees the whole OSH list, exactly as the prototype did. Setting shows the
 * full list regardless: that page edits the list itself.
 */
export function useAllowedOshProperties(oshProperties: string[] | undefined) {
  const [allowed, setAllowed] = useState<{ properties: string[]; restricted: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    getAllowedProperties()
      .then((res) => {
        if (!cancelled) setAllowed(res);
      })
      .catch(() => {
        if (!cancelled) setAllowed({ properties: [], restricted: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const list = oshProperties || [];
    if (!allowed?.restricted) return { properties: list, restricted: false, ready: !!allowed };
    return {
      properties: list.filter((p) => allowed.properties.includes(p)),
      restricted: true,
      ready: true,
    };
  }, [oshProperties, allowed]);
}
