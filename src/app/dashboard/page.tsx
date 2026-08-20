"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { supabase } from "@/lib/supabase";
import { getAllowedProperties } from "@/lib/allowedProperties";
import { getMenuPermissions, type MenuPermissions } from "@/lib/menuPermissions";

interface Stats {
  reservations: number;
  members: number;
  payments: number;
}

// Map of property_api_settings sync flags -> the target_table value the
// daily auto sync writes to sync_logs for that data set (see daily_auto_sync
// in api/app/main.py). A property's "expected" set for the traffic light is
// only the tables it actually has enabled.
const SYNC_FLAG_TABLES: [flag: string, table: string][] = [
  ["sync_reservations", "Reservations"],
  ["sync_members", "Customers"],
  ["sync_payments", "Payments"],
  ["sync_resources", "Resources"],
  ["sync_bills", "Bills"],
];

type LightLevel = "green" | "amber" | "red" | "off";

interface PropertyImportStatus {
  property: string;
  enabled: boolean;
  expected: string[];
  synced: string[];
  level: LightLevel;
  lastSyncedAt: string | null;
}

// Compact "23 Jul, 14:16" style, matching the DD-Mon format used on
// /log-import but without seconds - this is a card subtitle, not a table.
function formatLastSynced(dateStr: string): string {
  const d = new Date(dateStr);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${months[d.getMonth()]}, ${hours}:${mins}`;
}

// Start of the current Asia/Bangkok calendar day, as a UTC ISO string -
// "today" for the import status means the Bangkok day, matching how the
// sync scheduler itself thinks about days.
function startOfBangkokTodayIso(): string {
  const bkk = new Date(Date.now() + 7 * 3600_000);
  const startUtcMs = Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate()) - 7 * 3600_000;
  return new Date(startUtcMs).toISOString();
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [importStatus, setImportStatus] = useState<PropertyImportStatus[]>([]);
  const [importing, setImporting] = useState<Set<string>>(new Set());
  const [importResults, setImportResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  // Resolves to every property for an unrestricted role (Super Admin, or any
  // role with no restricted_properties set) - null until resolved, so the
  // stats/import-status fetches below can wait for it instead of firing a
  // portfolio-wide query first and then narrowing, which would flash the
  // wrong (too-large) numbers for a property-restricted role.
  const [allowedProperties, setAllowedProperties] = useState<string[] | null>(null);
  // Most recent bcp_snapshots.captured_at across whichever properties this
  // user can see - the honest signal for "is the every-5-minute BCP auto
  // capture actually still running", as opposed to the old static
  // "FastAPI Backend: Synchronized" line which never reflected anything real.
  const [bcpLastCapture, setBcpLastCapture] = useState<string | null>(null);
  const [bcpCaptureChecked, setBcpCaptureChecked] = useState(false);
  // Gates the "Sub System" cards below to the modules this role's sidebar
  // actually shows - null until resolved, so the cards stay hidden rather
  // than flashing every module before narrowing down.
  const [perms, setPerms] = useState<MenuPermissions | null>(null);

  useEffect(() => {
    getAllowedProperties().then(({ properties }) => setAllowedProperties(properties));
    getMenuPermissions().then(setPerms);
  }, []);

  useEffect(() => {
    if (allowedProperties === null) return;
    const fetchBcpHealth = async () => {
      try {
        const params = new URLSearchParams();
        if (allowedProperties.length > 0) params.set("properties", allowedProperties.join(","));
        const response = await fetch(`/api/bcp/last-capture?${params.toString()}`);
        const result = await response.json();
        setBcpLastCapture(result.status === "success" ? result.captured_at : null);
      } catch (err) {
        console.warn("Could not fetch BCP capture health:", err instanceof Error ? err.message : err);
      } finally {
        setBcpCaptureChecked(true);
      }
    };
    fetchBcpHealth();
  }, [allowedProperties]);

  // Auto capture runs every 5 minutes - green allows a little slack for
  // cron/scheduling lag, amber covers "clearly running late", red covers
  // "hasn't run in a long time or ever".
  const bcpMinutesSinceCapture = bcpLastCapture ? (Date.now() - new Date(bcpLastCapture).getTime()) / 60_000 : null;
  const bcpHealthLevel: "green" | "amber" | "red" =
    bcpMinutesSinceCapture === null ? "red" : bcpMinutesSinceCapture <= 10 ? "green" : bcpMinutesSinceCapture <= 30 ? "amber" : "red";
  const bcpHealthMessage = !bcpCaptureChecked
    ? "Checking BCP auto capture status…"
    : bcpMinutesSinceCapture === null
    ? "BCP Auto Capture: no snapshot recorded yet"
    : bcpHealthLevel === "green"
    ? `BCP Auto Capture: running (last capture ${Math.round(bcpMinutesSinceCapture)} min ago)`
    : bcpHealthLevel === "amber"
    ? `BCP Auto Capture: delayed (last capture ${Math.round(bcpMinutesSinceCapture)} min ago)`
    : `BCP Auto Capture: not running (last capture ${Math.round(bcpMinutesSinceCapture)} min ago)`;

  useEffect(() => {
    if (allowedProperties === null) return;
    const fetchStats = async () => {
      try {
        const apiUrl = "/api";
        const params = new URLSearchParams();
        if (allowedProperties.length > 0) params.set("properties", allowedProperties.join(","));
        const response = await fetch(`${apiUrl}/stats?${params.toString()}`);
        const result = await response.json();
        if (result.status === "success") {
          setStats(result.data);
        }
      } catch (err: any) {
        console.warn("Could not fetch dashboard stats. Backend might be offline:", err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, [allowedProperties]);

  const fetchImportStatus = async () => {
      try {
        let propertiesQuery = supabase
          .from("property_api_settings")
          .select("property_name, sync_enabled, sync_reservations, sync_members, sync_payments, sync_resources, sync_bills")
          .order("property_name");
        if (allowedProperties && allowedProperties.length > 0) {
          propertiesQuery = propertiesQuery.in("property_name", allowedProperties);
        }
        const [propsRes, logsRes, latestRes] = await Promise.all([
          propertiesQuery,
          supabase
            .from("sync_logs")
            .select("property, target_table, status")
            .gte("created_at", startOfBangkokTodayIso())
            .limit(1000),
          // Most recent successful sync per property, regardless of day -
          // separate from the "today" query above since a property whose
          // sync has been broken for days should still show its true last
          // success instead of nothing.
          supabase
            .from("sync_logs")
            .select("property, created_at")
            .eq("status", "success")
            .order("created_at", { ascending: false })
            .limit(500),
        ]);
        if (!propsRes.data) return;

        // Any successful import today counts, regardless of sync_type -
        // auto, manual or retry all mean the data actually arrived.
        const syncedByProperty = new Map<string, Set<string>>();
        for (const log of logsRes.data || []) {
          if (log.status !== "success" || !log.property) continue;
          if (!syncedByProperty.has(log.property)) syncedByProperty.set(log.property, new Set());
          syncedByProperty.get(log.property)!.add(log.target_table);
        }

        // latestRes is ordered newest-first, so the first row seen per
        // property is its most recent successful sync.
        const lastSyncedByProperty = new Map<string, string>();
        for (const log of latestRes.data || []) {
          if (!log.property || lastSyncedByProperty.has(log.property)) continue;
          lastSyncedByProperty.set(log.property, log.created_at);
        }

        const statuses: PropertyImportStatus[] = propsRes.data.map((p: any) => {
          const enabled = p.sync_enabled !== false;
          const expected = SYNC_FLAG_TABLES.filter(([flag]) => p[flag] !== false).map(([, table]) => table);
          const syncedSet = syncedByProperty.get(p.property_name) || new Set<string>();
          const synced = expected.filter((t) => syncedSet.has(t));
          let level: LightLevel;
          if (!enabled) level = "off";
          else if (expected.length > 0 && synced.length === expected.length) level = "green";
          else if (synced.length === 0) level = "red";
          else level = "amber";
          return {
            property: p.property_name,
            enabled,
            expected,
            synced,
            level,
            lastSyncedAt: lastSyncedByProperty.get(p.property_name) || null,
          };
        });
        setImportStatus(statuses);
      } catch (err: any) {
        console.warn("Could not fetch import status:", err.message);
      }
  };

  useEffect(() => {
    if (allowedProperties === null) return;
    fetchImportStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedProperties]);

  // Manual "Import Latest" from a property's card - reruns exactly what its
  // scheduled sync would have done (see POST /sync/property in api/app/main.py),
  // then refreshes the traffic lights so a fixed property flips to green
  // without waiting for the next automatic run.
  const handleImportNow = async (property: string) => {
    setImporting((prev) => new Set(prev).add(property));
    setImportResults((prev) => {
      const next = { ...prev };
      delete next[property];
      return next;
    });
    try {
      const response = await fetch("/api/sync/property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_name: property }),
      });
      const result = await response.json();
      if (result.status === "success" || result.status === "partial") {
        // Whichever tables actually succeeded already have a fresh "success"
        // row in sync_logs, so re-fetching recomputes the real traffic-light
        // colour from the database - it only shows green if every expected
        // table genuinely synced, not just because this call returned 200.
        const count = result.synced?.length ?? 0;
        const message = result.status === "success"
          ? `Imported ${count} table${count === 1 ? "" : "s"}`
          : `Imported ${count}, failed: ${result.failed.join(", ")}`;
        setImportResults((prev) => ({ ...prev, [property]: { ok: result.status === "success", message } }));
        await fetchImportStatus();
      } else {
        setImportResults((prev) => ({ ...prev, [property]: { ok: false, message: result.message || "Import failed" } }));
        if (result.failed?.length) await fetchImportStatus();
      }
    } catch (err: any) {
      setImportResults((prev) => ({ ...prev, [property]: { ok: false, message: err.message || "Import failed" } }));
    } finally {
      setImporting((prev) => {
        const next = new Set(prev);
        next.delete(property);
        return next;
      });
    }
  };

  return (
    <div className="flex-1 p-4 md:p-6 bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans transition-colors duration-300">
      <div className="max-w-7xl mx-auto">
        <div className="mb-4">
          <PageHeader 
            title="Overview" 
            description="Operational synchronization status for Narai Hospitality Group."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-1px bg-[var(--text-primary)]/10 border border-[var(--text-primary)]/10 mb-6">
          <StatCard title="Total Reservations" value={stats?.reservations ?? 0} label="Database" href="/data-mart" />
          <StatCard title="Registered Members" value={stats?.members ?? 0} label="Chinatown" href="/data-mart" />
          <StatCard title="Payments Processed" value={stats?.payments ?? 0} label="Synced" href="/data-mart" />
        </div>

        {importStatus.length > 0 && (
          <section className="bg-[var(--paper)] border border-[var(--text-primary)]/14 p-6 mb-6">
            <div className="flex items-baseline justify-between mb-6">
              <h2 className="text-[10px] font-bold text-[var(--text-primary)]/60 tracked-caps">Data Mart Status — Today</h2>
              <div className="flex items-center gap-4 text-[9px] font-bold tracked-caps text-[var(--text-primary)]/50">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> All tables</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500"></span> Partial</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500"></span> None</span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--text-primary)]/10 border border-[var(--text-primary)]/10">
              {importStatus.map((s) => {
                const isImporting = importing.has(s.property);
                const result = importResults[s.property];
                return (
                  <div key={s.property} className="bg-[var(--paper)] hover:bg-[var(--text-primary)]/5 transition-colors p-4 flex items-center gap-4 group">
                    <Link href="/log-import" className="contents">
                      <TrafficLight level={s.level} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-bold text-[var(--text-primary)] leading-snug">{s.property}</div>
                        <div className="text-[10px] font-bold tracked-caps mt-1 text-[var(--text-primary)]/50">
                          {s.enabled ? `${s.synced.length}/${s.expected.length} tables` : "Sync disabled"}
                        </div>
                        <div className="text-[10px] text-[var(--text-primary)]/40 mt-0.5">
                          {s.lastSyncedAt ? `Last import: ${formatLastSynced(s.lastSyncedAt)}` : "No import yet"}
                        </div>
                        {s.enabled && s.level === "amber" && (
                          <div className="text-[10px] text-[#A76400] mt-0.5 leading-snug">
                            Missing: {s.expected.filter((t) => !s.synced.includes(t)).join(", ")}
                          </div>
                        )}
                        {result && (
                          <div className={`text-[10px] font-bold mt-0.5 leading-snug ${result.ok ? "text-emerald-700" : "text-red-600"}`}>
                            {result.message}
                          </div>
                        )}
                      </div>
                    </Link>
                    {s.enabled && s.level !== "green" && (
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleImportNow(s.property); }}
                        disabled={isImporting}
                        className="shrink-0 px-3 py-2 text-[10px] font-bold tracked-caps border border-[var(--text-primary)]/20 text-[var(--text-primary)]/70 hover:bg-[var(--text-primary)]/5 hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-wait transition-colors"
                      >
                        {isImporting ? "Importing…" : "Import Latest"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="bg-[var(--paper)] border border-[var(--text-primary)]/14 p-6 mb-6">
          <h2 className="text-[10px] font-bold text-[var(--text-primary)]/60 mb-6 tracked-caps">Business Continuity Plan Health</h2>

          <div className="flex items-center gap-4">
            <div
              className={`h-2 w-2 rounded-full ${
                bcpHealthLevel === "green" ? "bg-emerald-600" : bcpHealthLevel === "amber" ? "bg-amber-500" : "bg-red-600"
              }`}
            ></div>
            <span
              className={`font-bold text-[13px] tracked-caps ${
                bcpHealthLevel === "green" ? "text-emerald-700" : bcpHealthLevel === "amber" ? "text-amber-700" : "text-red-700"
              }`}
            >
              {bcpHealthMessage}
            </span>
          </div>
        </section>

        {(() => {
          // Same module -> permission mapping the sidebar itself uses (see
          // Navigation.tsx) - Log Import is intentionally unconditional
          // there too, so it stays that way here.
          const cards = [
            { key: "data_mart", visible: !!perms?.data_mart, title: "Data Mart", body: "Synced Reservations, Members, and Payments from MEWS, kept up to date automatically and searchable/exportable at any time." },
            { key: "bcp", visible: !!perms?.bcp, title: "Business Continuity Plan", body: "Captures a backup of the reservation timeline, room status, and payments every 5 minutes, so front desk can keep working if MEWS goes down." },
            { key: "rr3", visible: !!perms?.rr3, title: "RR3", body: "Generates the Thai Hotel Act ร.ร.๓ lodger registration card for each checking-in guest, ready to print." },
            { key: "bills", visible: !!perms?.bills, title: "Bills", body: "Lists and prints guest invoices per property and date range, either live from MEWS or from the synced database." },
            { key: "log_import", visible: perms !== null, title: "Log Import", body: "Permanent history of every automated data sync - which property, which table, when, and whether it succeeded." },
          ].filter((c) => c.visible);

          if (cards.length === 0) return null;

          return (
            <section className="bg-[var(--paper)] border border-[var(--text-primary)]/14 p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5 font-display text-8xl pointer-events-none">NHG</div>

              <h2 className="text-[10px] font-bold text-[var(--text-primary)]/60 mb-6 tracked-caps">Sub System</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {cards.map((c) => (
                  <div key={c.key}>
                    <h3 className="font-display text-2xl mb-4 text-[var(--text-primary)]">{c.title}</h3>
                    <p className="text-[13px] leading-relaxed opacity-80 max-w-sm">{c.body}</p>
                  </div>
                ))}
              </div>
            </section>
          );
        })()}
      </div>
    </div>
  );
}

// A little vertical intersection-style traffic light: dark housing, three
// lamps (red / amber / green), only the lamp matching the current level is
// lit - the rest stay dim. level "off" (sync disabled) dims all three.
function TrafficLight({ level }: { level: LightLevel }) {
  const lamp = (colour: "red" | "amber" | "green") => {
    const active = level === colour;
    const activeCls = {
      red: "bg-red-500 shadow-[0_0_8px_2px_rgba(239,68,68,0.8)]",
      amber: "bg-amber-400 shadow-[0_0_8px_2px_rgba(251,191,36,0.8)]",
      green: "bg-emerald-500 shadow-[0_0_8px_2px_rgba(16,185,129,0.8)]",
    }[colour];
    const dimCls = {
      red: "bg-red-900/60",
      amber: "bg-amber-900/60",
      green: "bg-emerald-900/60",
    }[colour];
    return <div className={`w-4 h-4 rounded-full transition-all ${active ? activeCls : dimCls}`}></div>;
  };
  return (
    <div className="shrink-0 bg-[#2b2b2b] border border-black/40 rounded-md p-1.5 flex flex-col items-center gap-1.5 shadow-inner">
      {lamp("red")}
      {lamp("amber")}
      {lamp("green")}
    </div>
  );
}

function StatCard({ title, value, label, href }: { title: string, value: number, label: string, href: string }) {
  return (
    <Link href={href} className="bg-[var(--paper)] p-4 flex flex-col gap-0 transition-colors hover:bg-[var(--text-primary)]/5 group relative">
      <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps">{label}</div>
      <h3 className="font-display text-xl text-[var(--text-primary)] mb-2">{title}</h3>
      <div className="text-4xl font-display text-[var(--text-primary)] leading-none tracking-tighter">{value}</div>
      <div className="mt-3 text-[10px] font-bold tracked-caps text-[var(--text-primary)]/40 group-hover:text-[var(--text-primary)] transition-colors flex items-center gap-2">
        Manage <span className="text-[14px]">→</span>
      </div>
    </Link>
  );
}
