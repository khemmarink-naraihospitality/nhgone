"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAllowedProperties } from "@/lib/allowedProperties";

/**
 * The one property the whole app is looking at - MEWS-style: picked once from
 * the switcher at the top-right of every page (PropertySwitcher) instead of a
 * separate "Select Property" dropdown on each page. Remembered per browser, so
 * moving from Statistic Files to Revenue Files stays on the same hotel.
 *
 * The list is still getAllowedProperties(), so a property-restricted role only
 * ever sees (and can only ever be switched to) its own properties.
 */

export interface PropertyInfo {
  name: string;
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
}

interface SelectedPropertyContextValue {
  properties: PropertyInfo[];
  selectedProperty: string;
  current: PropertyInfo | null;
  setSelectedProperty: (name: string) => void;
  loaded: boolean;
  refreshProperties: () => Promise<void>;
}

const STORAGE_KEY = "nhgone.selectedProperty";

const SelectedPropertyContext = createContext<SelectedPropertyContextValue>({
  properties: [],
  selectedProperty: "",
  current: null,
  setSelectedProperty: () => {},
  loaded: false,
  refreshProperties: async () => {},
});

function readStoredProperty(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function SelectedPropertyProvider({ children }: { children: React.ReactNode }) {
  const [properties, setProperties] = useState<PropertyInfo[]>([]);
  const [selectedProperty, setSelectedPropertyState] = useState("");
  const [loaded, setLoaded] = useState(false);

  const refreshProperties = useCallback(async () => {
    const { properties: names } = await getAllowedProperties();

    // Explicit columns, never select("*"): this table also holds the MEWS
    // tokens, and a browser has no business receiving them even encrypted.
    // The two image columns come from api/sql/property_images.sql - before
    // that runs this query errors, and every property just shows its initials.
    const images = new Map<string, { profile_image_url: string | null; background_image_url: string | null }>();
    const { data, error } = await supabase
      .from("property_api_settings")
      .select("property_name, profile_image_url, background_image_url");
    if (!error) {
      for (const row of data || []) images.set(row.property_name, row);
    }

    setProperties(
      names.map((name) => ({
        name,
        profileImageUrl: images.get(name)?.profile_image_url || null,
        backgroundImageUrl: images.get(name)?.background_image_url || null,
      }))
    );
    // Keep the current choice if it is still allowed, else the one this
    // browser remembered, else the first - a stale or no-longer-permitted
    // name must never survive into a page's API calls.
    setSelectedPropertyState((cur) => {
      const wanted = cur || readStoredProperty();
      return names.includes(wanted) ? wanted : names[0] || "";
    });
    setLoaded(true);
  }, []);

  useEffect(() => {
    // Load-on-mount, which is exactly what this rule is aimed at - but the
    // list genuinely lives in Supabase and every setState inside
    // refreshProperties happens after its awaits, not synchronously in this
    // body. Nothing renders off it until `loaded` flips.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshProperties();
  }, [refreshProperties]);

  const setSelectedProperty = useCallback((name: string) => {
    setSelectedPropertyState(name);
    try {
      window.localStorage.setItem(STORAGE_KEY, name);
    } catch {
      // Private mode / blocked storage: still switches for this visit.
    }
  }, []);

  const value = useMemo<SelectedPropertyContextValue>(
    () => ({
      properties,
      selectedProperty,
      current: properties.find((p) => p.name === selectedProperty) || null,
      setSelectedProperty,
      loaded,
      refreshProperties,
    }),
    [properties, selectedProperty, setSelectedProperty, loaded, refreshProperties]
  );

  return <SelectedPropertyContext.Provider value={value}>{children}</SelectedPropertyContext.Provider>;
}

export function useSelectedProperty(): SelectedPropertyContextValue {
  return useContext(SelectedPropertyContext);
}
