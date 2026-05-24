"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";

interface SyncLog {
  id: string;
  property: string;
  status: string;
  records_synced: number;
  message: string;
  created_at: string;
}

export default function LogImportPage() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterProperty, setFilterProperty] = useState("All");
  const [properties, setProperties] = useState<string[]>([]);

  const fetchProperties = async () => {
    const { data: props } = await supabase.from("property_api_settings").select("property_name").order("property_name");
    if (props && props.length > 0) {
      setProperties(props.map(p => p.property_name));
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterProperty && filterProperty !== "All") {
        params.append("property", filterProperty);
      }
      params.append("limit", "200");

      const response = await fetch(`/api/admin/sync/logs?${params.toString()}`);
      const result = await response.json();

      if (result.status === "success") {
        setLogs(result.data);
      } else {
        setError(result.detail || result.message || "Failed to fetch logs");
      }
    } catch (err: any) {
      setError(`Failed to fetch logs: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProperties();
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [filterProperty]);

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const day = String(d.getDate()).padStart(2, '0');
      const month = months[d.getMonth()];
      const year = d.getFullYear();
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      const secs = String(d.getSeconds()).padStart(2, '0');
      return `${day}-${month}-${year} ${hours}:${mins}:${secs}`;
    } catch {
      return dateStr;
    }
  };

  // Calculate summary stats
  const totalSuccess = logs.filter(l => l.status === "success").length;
  const totalError = logs.filter(l => l.status === "error").length;
  const totalRecords = logs.reduce((acc, l) => acc + (l.records_synced || 0), 0);
  const lastSync = logs.length > 0 ? formatDate(logs[0].created_at) : "No sync yet";

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Log Import" description="Auto Import activity logs and sync status" />

      <div className="p-6 flex flex-col gap-6 overflow-y-auto flex-1">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2">Last Sync</p>
            <p className="text-sm font-bold text-white truncate">{lastSync}</p>
          </div>
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2">Total Success</p>
            <p className="text-2xl font-black text-emerald-400">{totalSuccess}</p>
          </div>
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2">Total Errors</p>
            <p className="text-2xl font-black text-red-400">{totalError}</p>
          </div>
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2">Records Synced</p>
            <p className="text-2xl font-black text-[#AAA024]">{totalRecords.toLocaleString()}</p>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex items-center gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Filter by Property</span>
            <select 
              value={filterProperty} 
              onChange={(e) => setFilterProperty(e.target.value)} 
              className="bg-white/5 border border-white/10 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/50"
            >
              <option value="All">All Properties</option>
              {properties.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="ml-auto">
            <button 
              onClick={fetchLogs} 
              disabled={loading}
              className="bg-[#AAA024] text-white px-5 py-2 rounded-xl text-sm font-bold hover:bg-[#8f871e] transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              Refresh
            </button>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Log Table */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden flex-1">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left px-5 py-4 text-[10px] uppercase font-bold text-slate-500 tracking-wider">Date & Time</th>
                  <th className="text-left px-5 py-4 text-[10px] uppercase font-bold text-slate-500 tracking-wider">Property</th>
                  <th className="text-left px-5 py-4 text-[10px] uppercase font-bold text-slate-500 tracking-wider">Status</th>
                  <th className="text-left px-5 py-4 text-[10px] uppercase font-bold text-slate-500 tracking-wider">Records</th>
                  <th className="text-left px-5 py-4 text-[10px] uppercase font-bold text-slate-500 tracking-wider">Message</th>
                </tr>
              </thead>
              <tbody>
                {loading && logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-16 text-slate-500">
                      <div className="flex flex-col items-center gap-3">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#AAA024]"></div>
                        <p className="text-sm">Loading logs...</p>
                      </div>
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-16 text-slate-500">
                      <div className="flex flex-col items-center gap-3">
                        <svg className="w-12 h-12 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p className="text-sm font-medium">No sync logs found</p>
                        <p className="text-xs text-slate-600">Auto Import has not run yet or no logs recorded.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  logs.map((log, idx) => (
                    <tr key={log.id || idx} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                      <td className="px-5 py-3">
                        <span className="text-[#AAA024] font-bold text-xs">{formatDate(log.created_at)}</span>
                      </td>
                      <td className="px-5 py-3 text-slate-300 font-medium text-xs">{log.property || "-"}</td>
                      <td className="px-5 py-3">
                        <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider ${
                          log.status === "success" 
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                            : "bg-red-500/10 text-red-400 border border-red-500/20"
                        }`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-white font-bold">{log.records_synced || 0}</span>
                      </td>
                      <td className="px-5 py-3 text-slate-400 text-xs max-w-md truncate">{log.message || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar { height: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.02); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(170, 160, 36, 0.3); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(170, 160, 36, 0.5); }
      `}</style>
    </div>
  );
}
