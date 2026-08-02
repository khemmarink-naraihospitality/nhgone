"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { format, formatDistanceToNow } from "date-fns";

interface SyncLogRow {
  id: string;
  created_at: string;
  property: string;
  target_table: string;
  status: string;
  records_synced: number;
  message: string;
}

// "User Activity" has no event log to draw on - profiles only ever stores
// each user's single most recent last_login, not a history of logins - so
// this buckets that one timestamp per user into recency ranges instead of
// a real time series. Honest given the data available, and needs no new
// tracking infrastructure.
interface LoginBuckets {
  today: number;
  week: number;
  month: number;
  older: number;
  never: number;
}

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [totalProperties, setTotalProperties] = useState(0);
  const [syncEnabledCount, setSyncEnabledCount] = useState(0);
  const [activeUsers, setActiveUsers] = useState(0);
  const [inactiveUsers, setInactiveUsers] = useState(0);
  const [pendingUsers, setPendingUsers] = useState(0);
  const [loginBuckets, setLoginBuckets] = useState<LoginBuckets>({ today: 0, week: 0, month: 0, older: 0, never: 0 });
  const [recentLogs, setRecentLogs] = useState<SyncLogRow[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [recentErrorCount, setRecentErrorCount] = useState(0);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const [{ data: properties }, { data: profiles }, { data: logs }] = await Promise.all([
        supabase.from("property_api_settings").select("property_name, sync_enabled"),
        supabase.from("profiles").select("status, last_login"),
        supabase
          .from("sync_logs")
          .select("id, created_at, property, target_table, status, records_synced, message")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      setTotalProperties(properties?.length || 0);
      setSyncEnabledCount((properties || []).filter((p) => p.sync_enabled).length);

      let active = 0;
      let inactive = 0;
      let pending = 0;
      const buckets: LoginBuckets = { today: 0, week: 0, month: 0, older: 0, never: 0 };
      const now = Date.now();
      (profiles || []).forEach((p) => {
        if (p.status === "Active") active++;
        else if (p.status === "Inactive") inactive++;
        else if (p.status === "Pending") pending++;

        if (!p.last_login) {
          buckets.never++;
          return;
        }
        const diffDays = (now - new Date(p.last_login).getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays < 1) buckets.today++;
        else if (diffDays < 7) buckets.week++;
        else if (diffDays < 30) buckets.month++;
        else buckets.older++;
      });
      setActiveUsers(active);
      setInactiveUsers(inactive);
      setPendingUsers(pending);
      setLoginBuckets(buckets);

      const allLogs = logs || [];
      setRecentLogs(allLogs.slice(0, 10));
      setLastSyncAt(allLogs[0]?.created_at || null);
      setRecentErrorCount(allLogs.filter((l) => l.status === "error").length);
    } catch (err) {
      console.error("Failed to load admin dashboard:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const maxBucket = Math.max(loginBuckets.today, loginBuckets.week, loginBuckets.month, loginBuckets.older, loginBuckets.never, 1);
  const bucketBars: { label: string; value: number }[] = [
    { label: "Today", value: loginBuckets.today },
    { label: "This Week", value: loginBuckets.week },
    { label: "This Month", value: loginBuckets.month },
    { label: "Older", value: loginBuckets.older },
    { label: "Never", value: loginBuckets.never },
  ];

  return (
    <div className="p-8 bg-white min-h-screen text-slate-900">
      <header className="mb-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight mb-2">Admin Console</h1>
          <p className="text-slate-500 font-medium">Manage system infrastructure and MEWS API connections</p>
        </div>
        <button
          onClick={loadDashboard}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-all disabled:opacity-50 shrink-0"
        >
          <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          Refresh
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        <div className="bg-slate-50 border border-slate-200 p-6 rounded-3xl shadow-sm">
          <p className="text-[10px] font-bold text-[#AAA024] uppercase tracking-widest mb-1">Total Properties</p>
          <p className="text-4xl font-black text-slate-900">{totalProperties}</p>
        </div>
        <div className="bg-slate-50 border border-slate-200 p-6 rounded-3xl shadow-sm">
          <p className="text-[10px] font-bold text-[#AAA024] uppercase tracking-widest mb-1">Auto Sync</p>
          <p className="text-4xl font-black text-slate-900">{syncEnabledCount}<span className="text-lg text-slate-400 font-bold">/{totalProperties}</span></p>
          <p className="text-[11px] text-slate-400 font-medium mt-1">properties enabled</p>
        </div>
        <div className="bg-slate-50 border border-slate-200 p-6 rounded-3xl shadow-sm">
          <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1">Active Users</p>
          <p className="text-4xl font-black text-slate-900">{activeUsers}</p>
        </div>
        <div className="bg-slate-50 border border-slate-200 p-6 rounded-3xl shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Inactive Users</p>
          <p className="text-4xl font-black text-slate-900">{inactiveUsers}</p>
          {pendingUsers > 0 && (
            <p className="text-[11px] text-amber-600 font-bold mt-1">{pendingUsers} pending approval</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-12">
        {/* User Activity - bucketed by last_login recency, see LoginBuckets comment above */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl shadow-sm p-6">
          <h2 className="text-lg font-bold text-slate-800 mb-1">User Activity</h2>
          <p className="text-[11px] text-slate-400 font-medium mb-6">Users grouped by when they last logged in</p>
          {loading ? (
            <div className="h-[180px] flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#AAA024]"></div>
            </div>
          ) : (
            <div className="flex items-end justify-between gap-4 h-[180px] px-2">
              {bucketBars.map((b) => {
                const heightPct = Math.max((b.value / maxBucket) * 100, b.value > 0 ? 6 : 2);
                return (
                  <div key={b.label} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                    <span className="text-sm font-black text-slate-700">{b.value}</span>
                    <div className="w-full flex items-end h-[120px] bg-slate-50 rounded-lg overflow-hidden">
                      <div
                        className="w-full bg-[#AAA024] rounded-lg transition-all duration-500"
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide text-center">{b.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Auto Sync Overview */}
        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-6">
          <h2 className="text-lg font-bold text-slate-800 mb-1">Auto Sync Overview</h2>
          <p className="text-[11px] text-slate-400 font-medium mb-6">Scheduled background imports</p>
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Last Sync Run</p>
              <p className="text-xl font-black text-slate-900">
                {lastSyncAt ? formatDistanceToNow(new Date(lastSyncAt), { addSuffix: true }) : "No syncs yet"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Properties Enabled</p>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                <p className="text-xl font-black text-slate-900">{syncEnabledCount} / {totalProperties}</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Errors (last 50 runs)</p>
              <p className={`text-xl font-black ${recentErrorCount > 0 ? "text-red-600" : "text-slate-900"}`}>{recentErrorCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity Log preview */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        <div className="p-6 pb-4 flex items-center justify-between border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Recent Activity</h2>
            <p className="text-[11px] text-slate-400 font-medium mt-1">Latest 10 automated sync results</p>
          </div>
          <Link href="/admin/logs" className="text-xs font-bold text-[#AAA024] hover:text-[#8f871e] transition-colors whitespace-nowrap">
            View All →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50/80 text-xs uppercase font-bold text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">Timestamp</th>
                <th className="px-6 py-3">Property</th>
                <th className="px-6 py-3">Data Set</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Records</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">Loading...</td>
                </tr>
              ) : recentLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500 bg-slate-50/50">No activity logs recorded yet.</td>
                </tr>
              ) : (
                recentLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-3 whitespace-nowrap font-medium text-slate-900">{format(new Date(log.created_at), "dd MMM yyyy, HH:mm:ss")}</td>
                    <td className="px-6 py-3 whitespace-nowrap">{log.property}</td>
                    <td className="px-6 py-3 whitespace-nowrap">{log.target_table || "All"}</td>
                    <td className="px-6 py-3 whitespace-nowrap">
                      {log.status === "success" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100">Success</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-red-50 text-red-600 border border-red-100">Error</span>
                      )}
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-right font-medium">
                      {log.records_synced > 0 ? log.records_synced.toLocaleString() : <span className="text-slate-400">-</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
