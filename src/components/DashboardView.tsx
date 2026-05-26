"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import PageHeader from "./PageHeader";
import * as XLSX from 'xlsx';
import ImportChart from "./ImportChart";

type Section = "reservations" | "members" | "payments";
type DataSource = "live" | "saved";

interface DashboardViewProps {
  title: string;
  subtitle: string;
  defaultDataSource: DataSource;
  defaultSection: Section;
  allowToggleDataSource?: boolean;
  showSectionTabs?: boolean;
  defaultDays?: number;
}

const SECTION_COLUMNS: Record<Section, string[]> = {
  reservations: [
    "Number", "Status", "Arrival", "Departure", "Last name", "First name", "Email", "Telephone", "Group name", 
    "Address", "Customer nationality", "Send marketing emails", "Booker", "Creator", "Created", "Release", "Confirmed", "Canceled",
    "Count (nights)", "Person count", "Count (bed, nightly)", "Requested category",
    "Space category", "Space number", "Origin", "Channel manager ID", "Group channel manager ID",
    "Group channel confirmation number", "Travel agency confirmation number", "Segment", "Rate", "Voucher",
    "Products", "Company", "Travel agency", "Average rate (nightly)", "Total amount", "Canceled cost",
    "Commission", "Customer cost", "Balance of companions", "Payment card type", "Payment card number",
    "Expiration", "Automatic payment", "Bills", "Cancellation reason", "Notes", "Customer notes",
    "Customer classifications", "Pricing classification", "Booking purpose", "Reservation source",
    "Identifier", "Company Identifier", "Travel agency Identifier", "Reservation origin details", "Restoration reason"
  ],
  members: [
    "Number", "Title", "Last Name", "First Name", "Second Last Name", "Nationality", "Preferred Language",
    "Language", "Birth Date", "Birth Place", "Occupation", "Email", "Phone", "Tax ID", "Loyalty Code",
    "Accounting Code", "Billing Code", "Car Registration", "Dietary", "Notes", "Created", "Updated",
    "Active", "Classifications", "Options", "Identifier"
  ],
  payments: [
    "mews_id", "Amount", "Currency", "Status", "Processed At", "Identifier"
  ]
};

export default function DashboardView({ 
  title, 
  subtitle, 
  defaultDataSource, 
  defaultSection,
  allowToggleDataSource = false,
  showSectionTabs = true,
  defaultDays = 1
}: DashboardViewProps) {
  const [activeSection, setActiveSection] = useState<Section>(defaultSection);
  const [dataSource, setDataSource] = useState<DataSource>(defaultDataSource);
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);

  // Sync scrollbars
  const handleTopScroll = () => {
    if (topScrollRef.current && tableContainerRef.current) {
      tableContainerRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  };

  const handleTableScroll = () => {
    if (topScrollRef.current && tableContainerRef.current) {
      topScrollRef.current.scrollLeft = tableContainerRef.current.scrollLeft;
    }
  };

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };
  
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [data, setData] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{inserted: number, skipped: number} | null>(null);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const isSuperAdmin = userRole?.toLowerCase() === "super_admin" || 
                      userRole?.toLowerCase() === "super admin" || 
                      userRole?.toLowerCase() === "admin";

  const showCheckboxes = isSuperAdmin && dataSource === "saved";

  const getDefaultRange = () => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setDate(now.getDate() - 1);
    end.setHours(23, 59, 59, 999);
    return {
      start: new Date(start.getTime() - (start.getTimezoneOffset() * 60000)).toISOString().slice(0, 16),
      end: new Date(end.getTime() - (end.getTimezoneOffset() * 60000)).toISOString().slice(0, 16)
    };
  };

  const initialRange = getDefaultRange();
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);

  const fetchProperties = async () => {
    const { data: props, error } = await supabase.from("property_api_settings").select("property_name").order("property_name");
    if (props && props.length > 0) {
      const names = props.map(p => p.property_name);
      setProperties(names);
      setSelectedProperty(names[0]);
    }
  };

  const fetchData = async () => {
    if (!selectedProperty) return;
    setLoading(true);
    setError(null);
    setSelectedIds([]);
    try {
      const apiUrl = "/api";
      let endpoint = "";
      let queryParams = new URLSearchParams();
      
      if (dataSource === "live") {
        endpoint = activeSection === "reservations" ? "/reservations/live" : 
                          activeSection === "members" ? "/members/live" : "/payments/live";
        queryParams.append("property_name", selectedProperty);
        queryParams.append("start_date", startDate ? `${startDate}:00Z` : "");
        queryParams.append("end_date", endDate ? `${endDate}:00Z` : "");
      } else {
        endpoint = activeSection === "reservations" ? "/reservations/saved" :
                   activeSection === "members" ? "/members/managed" : "/payments/managed";
        queryParams.append("property", selectedProperty);
        
        // For 'saved' data, we ensure we fetch at least a 7-day range for the chart,
        // but if the user selects a larger range for the table, we honor that.
        const now = new Date();
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(now.getDate() - 7);
        const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0] + "T00:00";
        const todayEndStr = now.toISOString().split('T')[0] + "T23:59";
        
        const apiStart = (startDate && startDate < sevenDaysAgoStr) ? startDate : sevenDaysAgoStr;
        const apiEnd = (endDate && endDate > todayEndStr) ? endDate : todayEndStr;
        
        queryParams.append("start_date", apiStart);
        queryParams.append("end_date", apiEnd);
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        const response = await fetch(`${apiUrl}${endpoint}?${queryParams.toString()}`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errResult = await response.json();
            throw new Error(errResult.message || `Server error: ${response.status}`);
          }
          throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        if (result.status === "success") {
          setData(result.data);
        } else {
          setError(result.message || "Failed to fetch data");
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        setError(err.name === 'AbortError' ? "Request timeout" : err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleManualSync = async () => {
    if (data.length === 0) return;
    setSyncing(true);
    try {
      const apiUrl = "/api";
      const endpoint = activeSection === "reservations" ? "/reservations/sync-manual" : "/members/sync-manual";
      const response = await fetch(`${apiUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          property: selectedProperty, 
          data: data,
          start_date: startDate,
          end_date: endDate
        }),
      });
      const result = await response.json();
      if (result.status === "success") {
        setSyncStatus({ inserted: result.inserted, skipped: result.skipped || 0 });
        setShowSyncModal(true);
      } else {
        setError("Failed to sync: " + (result.message || result.detail || "Unknown error"));
      }
    } catch (err: any) {
      setError("Error syncing data: " + err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} records?`)) return;
    
    const endpoint = activeSection === "reservations" ? "/reservations/saved" : "/members/managed";
    setLoading(true);
    try {
      const response = await fetch(`/api${endpoint}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mews_ids: selectedIds })
      });
      const result = await response.json();
      if (result.status === "success") {
        setData(prev => prev.filter(item => !selectedIds.includes(item.Identifier || item.mews_id)));
        setSelectedIds([]);
      } else {
        setError("Delete failed: " + (result.message || result.detail || "Unknown error"));
      }
    } catch (err: any) {
      setError("Error deleting records: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const allKeys = useMemo(() => {
    if (data.length === 0) return [];
    
    // Get all unique keys present in the data (excluding system/internal keys)
    const detectedKeys = Object.keys(data[0]).filter(k => 
      !['id', 'mews_id', 'property_id', 'synced_at', 'report_date', 'property', 'data'].includes(k)
    );

    // Get the predefined order for the current section
    const order = (SECTION_COLUMNS[activeSection] || []).map(k => k.toLowerCase());
    
    // Sort keys based on predefined order. 
    return [...detectedKeys].sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      
      const indexA = order.indexOf(aLower);
      const indexB = order.indexOf(bLower);
      
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      
      // If neither is in the predefined list, maintain original object order
      return 0; 
    });
  }, [data, activeSection]);

  const filteredAndSortedData = useMemo(() => {
    let result = [...data];
    if (dataSource === "saved") {
      result = result.filter(item => {
        // Prioritize data date over system timestamps
        const itemDateStr = item.report_date || item["Import Date"] || item.synced_at || item.created_at || item.processed_at;
        if (!itemDateStr) return true;
        
        const rawDate = new Date(itemDateStr);
        if (isNaN(rawDate.getTime())) return true;
        
        // [STANDARD] Use local time components to match datetime-local input format (YYYY-MM-DDTHH:mm).
        // AVOID .toISOString() because Thailand (UTC+7) shifts 00:00 (Local) -> 17:00 (Prev Day UTC),
        // causing records to disappear from the filtered view.
        const pad = (n: number) => String(n).padStart(2, '0');
        const itemDate = `${rawDate.getFullYear()}-${pad(rawDate.getMonth()+1)}-${pad(rawDate.getDate())}T${pad(rawDate.getHours())}:${pad(rawDate.getMinutes())}`;
        
        return itemDate >= startDate && itemDate <= endDate;
      });
    }

    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      result = result.filter(item => 
        Object.values(item).some(val => 
          String(val || "").toLowerCase().includes(lowerSearch)
        )
      );
    }
    if (sortConfig) {
      result.sort((a, b) => {
        const aVal = String(a[sortConfig.key] || "").toLowerCase();
        const bVal = String(b[sortConfig.key] || "").toLowerCase();
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [data, searchTerm, sortConfig]);

  const paginatedData = useMemo(() => {
    return filteredAndSortedData.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  }, [filteredAndSortedData, currentPage, rowsPerPage]);

  const totalPages = Math.ceil(filteredAndSortedData.length / rowsPerPage);

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredAndSortedData.length && filteredAndSortedData.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredAndSortedData.map(r => r.Identifier || r.mews_id));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const renderValue = (key: string, value: any) => {
    if (value === null || value === undefined) return "-";
    if (typeof value === 'boolean') return value ? "Yes" : "No";
    
    // Date formatting
    if (typeof value === 'string' && (value.includes('T') || (value.includes('-') && value.includes(':')))) {
      const d = new Date(value);
      if (!isNaN(d.getTime()) && value.length > 10) {
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const day = String(d.getDate()).padStart(2, '0');
        const month = months[d.getMonth()];
        const year = d.getFullYear();
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        return `${day}-${month}-${year} ${hours}:${minutes} ${ampm}`;
      }
    }
    return String(value);
  };

  const exportToExcel = () => {
    if (data.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(filteredAndSortedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
    XLSX.writeFile(workbook, `NHGOne_${activeSection}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const generateChartData = () => {
    if (dataSource !== "saved" || data.length === 0) return [];
    const countMap = new Map<string, number>();
    data.forEach(item => {
      const dateStr = item["Import Date"] || item.synced_at || item.created_at || item.report_date;
      if (dateStr) {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          const key = `${String(d.getDate()).padStart(2, '0')}-${d.getMonth()+1}-${d.getFullYear()}`;
          countMap.set(key, (countMap.get(key) || 0) + 1);
        }
      }
    });
    return Array.from(countMap.entries()).map(([date, count]) => ({ date, count })).slice(-7);
  };

  const chartData = useMemo(() => generateChartData(), [data]);

  useEffect(() => {
    fetchProperties();
    const getUserRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
        setUserRole(profile?.role || user.user_metadata?.role || null);
      }
    };
    getUserRole();
  }, []);

  useEffect(() => {
    if (selectedProperty) fetchData();
  }, [selectedProperty, dataSource, activeSection]);

  return (
    <div className="flex-1 flex flex-col bg-background text-foreground p-6">
      <div className="max-w-7xl mx-auto w-full">
        <PageHeader title={title} description={subtitle}>
          {allowToggleDataSource && (
            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-full p-1">
              <button onClick={() => setDataSource("live")} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${dataSource === "live" ? "bg-emerald-500 text-white shadow-lg" : "text-slate-400"}`}>Live API</button>
              <button onClick={() => setDataSource("saved")} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${dataSource === "saved" ? "bg-blue-500 text-white shadow-lg" : "text-slate-400"}`}>Database</button>
            </div>
          )}
        </PageHeader>
          
        <div className="flex flex-wrap items-end gap-4 mb-6">
          <div className="flex flex-col gap-2 w-full md:w-80">
            <label className="text-[10px] font-bold text-slate-400 tracked-caps ml-1">Select Property</label>
            <select value={selectedProperty} onChange={(e) => setSelectedProperty(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-sm px-4 py-2.5 text-sm appearance-none cursor-pointer text-foreground focus:ring-1 focus:ring-[#AAA024] focus:outline-none">
              {properties.map(p => <option key={p} value={p} className="bg-slate-900 text-white">{p}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2 w-full md:w-64">
            <label className="text-[10px] font-bold text-slate-400 tracked-caps ml-1">Start Date</label>
            <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-sm px-4 py-2 text-sm text-foreground focus:ring-1 focus:ring-[#AAA024] focus:outline-none" />
          </div>
          <div className="flex flex-col gap-2 w-full md:w-64">
            <label className="text-[10px] font-bold text-slate-400 tracked-caps ml-1">End Date</label>
            <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-sm px-4 py-2 text-sm text-foreground focus:ring-1 focus:ring-[#AAA024] focus:outline-none" />
          </div>
          <button onClick={fetchData} disabled={loading} className="btn-lemongrass h-[42px]">Fetch Data</button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-6 mb-6 bg-white/5 p-4 rounded-sm border border-white/10">
          {showSectionTabs && (
            <div className="flex gap-1 p-1 bg-black/20 rounded-sm">
              {(["reservations", "members", "payments"] as Section[]).map((s) => (
                <button key={s} onClick={() => setActiveSection(s)} className={`px-6 py-2 rounded-sm text-[11px] tracked-caps transition-all ${activeSection === s ? "bg-white/10 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}>{s}</button>
              ))}
            </div>
          )}
          <div className="flex flex-1 items-center justify-end gap-4">
            <input type="text" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="bg-black/20 border border-white/5 rounded-sm px-4 py-2.5 text-sm text-foreground focus:ring-1 focus:ring-[#AAA024] outline-none max-w-xs w-full" />
            <div className="flex gap-2">
              {showCheckboxes && selectedIds.length > 0 && <button onClick={handleDeleteSelected} className="px-4 py-2 bg-red-500/10 text-red-500 border border-red-500/20 rounded-sm text-[10px] tracked-caps">Delete ({selectedIds.length})</button>}
              {isSuperAdmin && dataSource === "live" && <button onClick={handleManualSync} disabled={data.length === 0 || syncing} className="btn-secondary py-1 text-[10px]">Import</button>}
              <button onClick={exportToExcel} disabled={data.length === 0} className="btn-lemongrass py-1 text-[10px]">Excel</button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="p-6 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl mb-6">{error}</div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#AAA024]/20 border-t-[#AAA024]"></div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-2xl flex flex-col mb-6">
            <div ref={topScrollRef} onScroll={handleTopScroll} className="overflow-x-auto overflow-y-hidden h-4 mb-2 bg-white/5 border-b border-white/10">
              <div style={{ width: tableContainerRef.current?.scrollWidth || 'auto', height: '1px' }}></div>
            </div>
            <div ref={tableContainerRef} onScroll={handleTableScroll} className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-max">
                <thead className="bg-white/5 sticky top-0 z-10 backdrop-blur-md">
                  <tr>
                    {showCheckboxes && (
                      <th className="p-4 border-b border-white/10">
                        <input type="checkbox" checked={selectedIds.length === filteredAndSortedData.length && filteredAndSortedData.length > 0} onChange={toggleSelectAll} />
                      </th>
                    )}
                    {allKeys.map((col) => (
                      <th key={col} onClick={() => requestSort(col)} className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-white/10 cursor-pointer hover:bg-white/10 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {col.replace(/([A-Z])/g, ' $1').trim()}
                          <span>{sortConfig?.key === col ? (sortConfig.direction === 'asc' ? "▲" : "▼") : "↕"}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredAndSortedData.length === 0 ? (
                    <tr><td colSpan={100} className="p-10 text-center text-slate-500">No data found.</td></tr>
                  ) : (
                    paginatedData.map((item, idx) => (
                      <tr key={item.Identifier || item.mews_id || idx} className={`hover:bg-white/10 group ${selectedIds.includes(item.Identifier || item.mews_id) ? 'bg-white/5' : ''}`}>
                        {showCheckboxes && (
                          <td className="p-4">
                            <input type="checkbox" checked={selectedIds.includes(item.Identifier || item.mews_id)} onChange={() => toggleSelectRow(item.Identifier || item.mews_id)} />
                          </td>
                        )}
                        {allKeys.map((key) => <td key={key} className="p-4 text-sm text-slate-400 whitespace-nowrap overflow-hidden max-w-[300px] text-ellipsis">{renderValue(key, item[key])}</td>)}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {filteredAndSortedData.length > 0 && (
              <div className="p-4 bg-white/5 border-t border-white/5 flex justify-between items-center px-8">
                <div className="flex items-center gap-4 text-[10px] text-slate-500">
                  <select value={rowsPerPage} onChange={(e) => setRowsPerPage(Number(e.target.value))} className="bg-transparent border border-white/10 rounded px-2 py-1 outline-none">
                    {[20, 50, 100, 200, 500].map(v => <option key={v} value={v} className="bg-slate-900 text-white">{v}</option>)}
                  </select>
                  <span>Showing {(currentPage-1)*rowsPerPage + 1} to {Math.min(currentPage*rowsPerPage, filteredAndSortedData.length)} of {filteredAndSortedData.length} records</span>
                </div>
                <div className="flex gap-1">
                  <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="p-1 px-2 hover:bg-white/5 rounded disabled:opacity-30">Prev</button>
                  {[...Array(Math.min(5, totalPages))].map((_, i) => (
                    <button key={i} onClick={() => setCurrentPage(i+1)} className={`w-7 h-7 rounded-lg text-[10px] font-bold ${currentPage === i+1 ? "bg-[#AAA024] text-white" : "text-slate-400 hover:bg-white/5"}`}>{i+1}</button>
                  ))}
                  <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="p-1 px-2 hover:bg-white/5 rounded disabled:opacity-30">Next</button>
                </div>
              </div>
            )}
          </div>
        )}

        {showSyncModal && syncStatus && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-white/10 rounded-3xl p-8 shadow-2xl max-w-sm w-full text-center">
              <h3 className="text-xl font-bold text-white mb-2">Import Complete</h3>
              <div className="grid grid-cols-2 gap-4 my-6">
                <div className="bg-white/5 p-4 rounded-2xl"><p className="text-[10px] font-bold text-slate-500 mb-1 uppercase">New</p><p className="text-2xl font-bold text-emerald-400">{syncStatus.inserted}</p></div>
                <div className="bg-white/5 p-4 rounded-2xl"><p className="text-[10px] font-bold text-slate-500 mb-1 uppercase">Dup</p><p className="text-2xl font-bold text-slate-400">{syncStatus.skipped}</p></div>
              </div>
              <button onClick={() => setShowSyncModal(false)} className="w-full py-3 bg-[#AAA024] text-white font-bold rounded-2xl">Confirm</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
