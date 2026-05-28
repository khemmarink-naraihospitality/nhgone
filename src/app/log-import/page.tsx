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
  target_table: string;
}

export default function LogImportPage() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterProperty, setFilterProperty] = useState("All");
  const [properties, setProperties] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

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
      params.append("limit", "100");

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
    setCurrentPage(1); // Reset to first page when filter changes
  }, [filterProperty]);

  const totalPages = Math.ceil(logs.length / itemsPerPage);
  const paginatedLogs = logs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

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
    <div className="flex flex-col min-h-screen bg-[#FFEFD2] text-[#152A00]">
      <div className="p-12 max-w-7xl mx-auto w-full flex flex-col gap-10">
        <PageHeader title="Log Import" description="History of automated portfolio synchronization and data health." />

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#152A00]/10 border border-[#152A00]/10">
          <div className="bg-[#fffaf0] p-6">
            <p className="text-[9px] font-bold text-[#152A00]/50 tracked-caps mb-3 uppercase">LAST ACTIVITY</p>
            <p className="text-sm font-bold truncate">{lastSync}</p>
          </div>
          <div className="bg-[#fffaf0] p-6 text-center md:text-left">
            <p className="text-[9px] font-bold text-[#152A00]/50 tracked-caps mb-3 uppercase">SUCCESS RATE</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-display">{totalSuccess}</span>
              <span className="text-[10px] font-bold opacity-30">BATCHES</span>
            </div>
          </div>
          <div className="bg-[#fffaf0] p-6 text-center md:text-left">
            <p className="text-[9px] font-bold text-[#152A00]/50 tracked-caps mb-3 uppercase">TOTAL ERRORS</p>
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-display ${totalError > 0 ? "text-[#A76400]" : "text-[#152A00]"}`}>{totalError}</span>
              <span className="text-[10px] font-bold opacity-30">EVENTS</span>
            </div>
          </div>
          <div className="bg-[#fffaf0] p-6 text-center md:text-right">
            <p className="text-[9px] font-bold text-[#152A00]/50 tracked-caps mb-3 uppercase">RECORDS SYNCED</p>
            <p className="text-3xl font-display text-[#152A00]">{totalRecords.toLocaleString()}</p>
          </div>
        </div>

        {/* Filter & Actions */}
        <div className="flex flex-wrap items-end justify-between gap-8 py-6 border-y border-[#152A00]/10">
          <div className="flex flex-col gap-3 min-w-[300px]">
            <label className="text-[9px] font-bold text-[#152A00]/50 tracked-caps uppercase ml-1">Entity / Property Filter</label>
            <div className="relative border-b-2 border-[#152A00]/20 focus-within:border-[#152A00] transition-colors">
              <select 
                value={filterProperty} 
                onChange={(e) => setFilterProperty(e.target.value)} 
                className="w-full bg-transparent py-3 px-1 text-[13px] font-medium text-[#152A00] outline-none appearance-none cursor-pointer"
              >
                <option value="All">View All Portfolio Activity</option>
                {properties.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <button 
            onClick={fetchLogs} 
            disabled={loading}
            className="btn-brand btn-primary h-[50px] px-10"
          >
            {loading ? "SYNCING..." : "REFRESH LOGS"}
          </button>
        </div>

        {/* Error State */}
        {error && (
          <div className="p-6 bg-white border border-[#A76400]/20 text-[#A76400] text-sm">
            {error}
          </div>
        )}

        {/* Log Table Container */}
        <div className="bg-[#fffaf0] border border-[#152A00]/14 shadow-[20px_20px_60px_rgba(21,42,0,0.03)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#152A00]/5 border-b border-[#152A00]/10">
                  <th className="px-6 py-5 text-[9px] font-bold text-[#152A00]/50 tracked-caps uppercase">TIMESTAMP</th>
                  <th className="px-6 py-5 text-[9px] font-bold text-[#152A00]/50 tracked-caps uppercase">PROPERTY</th>
                  <th className="px-6 py-5 text-[9px] font-bold text-[#152A00]/50 tracked-caps uppercase">TABLE / DOMAIN</th>
                  <th className="px-6 py-5 text-[9px] font-bold text-[#152A00]/50 tracked-caps uppercase">STATUS</th>
                  <th className="px-6 py-5 text-[9px] font-bold text-[#152A00]/50 tracked-caps uppercase">RECORDS</th>
                  <th className="px-6 py-5 text-[9px] font-bold text-[#152A00]/50 tracked-caps uppercase">MESSAGE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#152A00]/5">
                {loading && logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-32 italic text-[#152A00]/30 font-display text-xl">
                      Retrieving audit history...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-32 italic text-[#152A00]/30 font-display text-xl">
                      No activity transitions recorded.
                    </td>
                  </tr>
                ) : (
                  paginatedLogs.map((log, idx) => (
                    <tr key={log.id || idx} className="hover:bg-[#152A00]/3 transition-colors">
                      <td className="px-6 py-4">
                        <span className="text-[13px] font-bold text-[#152A00]">{formatDate(log.created_at)}</span>
                      </td>
                      <td className="px-6 py-4 text-[#152A00]/80 text-[13px]">{log.property || "Global"}</td>
                      <td className="px-6 py-4">
                        <span className="bg-[#152A00]/5 px-2 py-1 text-[10px] font-bold text-[#152A00] tracked-caps uppercase">{log.target_table || "General"}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-[10px] font-bold tracked-caps uppercase ${
                          log.status === "success" ? "text-emerald-700" : "text-[#A76400]"
                        }`}>
                          {log.status === "success" ? "✓ SUCCESS" : "× FAILED"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-[#152A00] font-bold text-[13px]">{log.records_synced || 0}</td>
                      <td className="px-6 py-4 text-[#152A00]/60 text-[12px] max-w-md truncate">{log.message || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="p-10 bg-white border-t border-[#152A00]/10 flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="text-[10px] font-bold tracked-caps text-[#152A00]/40 uppercase">
                SHOWING {Math.min(itemsPerPage, paginatedLogs.length)} OF {logs.length} TOTAL AUDIT LOGS — PAGE {currentPage} OF {totalPages}
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-6 py-2 border border-[#152A00]/10 text-[10px] font-bold tracked-caps hover:bg-[#152A00]/5 disabled:opacity-20 transition-all uppercase"
                >
                  PREVIOUS
                </button>
                <div className="flex gap-1">
                  {[...Array(totalPages)].map((_, i) => (
                    <button
                      key={i + 1}
                      onClick={() => setCurrentPage(i + 1)}
                      className={`w-9 h-9 text-[10px] font-bold transition-all ${
                        currentPage === i + 1 
                          ? "bg-[#152A00] text-[#FFEFD2]" 
                          : "border border-[#152A00]/10 text-[#152A00] hover:bg-[#152A00]/5"
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
                <button 
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-6 py-2 border border-[#152A00]/10 text-[10px] font-bold tracked-caps hover:bg-[#152A00]/5 disabled:opacity-20 transition-all uppercase"
                >
                  NEXT
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
