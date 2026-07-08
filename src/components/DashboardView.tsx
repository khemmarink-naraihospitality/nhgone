"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import PageHeader from "./PageHeader";
import * as XLSX from 'xlsx';
import ImportChart from "./ImportChart";

type Section = "reservations" | "members" | "payments" | "bills" | "resources";
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
    "mews_id", "Amount", "Currency", "Original Amount", "Status", "Type", "Kind",
    "Number", "Processed At", "Charged At", "Notes", "Identifier", "Receipt Identifier",
    "Bill Id", "Account Id"
  ],
  bills: [
    "mews_id", "Number", "Type", "State", "Owner Name", "Issued At", "Due At", "Paid At", "Notes"
  ],
  resources: [
    "Identifier", "Name", "State", "Active", "Parent Resource Id", "Floor Number", "Location Notes", "Created", "Updated"
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
                          activeSection === "members" ? "/members/live" :
                          activeSection === "bills" ? "/bills/live" :
                          activeSection === "resources" ? "/resources/live" : "/payments/live";
        queryParams.append("property_name", selectedProperty);
        queryParams.append("start_date", startDate ? `${startDate}:00Z` : "");
        queryParams.append("end_date", endDate ? `${endDate}:00Z` : "");
      } else {
        endpoint = activeSection === "reservations" ? "/reservations/saved" :
                   activeSection === "members" ? "/members/managed" :
                   activeSection === "resources" ? "/resources/managed" :
                   activeSection === "bills" ? "/bills/managed" : "/payments/managed";
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
      
      // /reservations/live paginates via Cursor (chunk_limit defaults to 1 server-side
      // to avoid Vercel timeouts on the heavier reservation+relations fetch); follow the
      // returned cursor here so the table isn't silently capped at one chunk (~500 rows).
      const isPaginatedLive = dataSource === "live" && activeSection === "reservations";

      try {
        let accumulated: any[] = [];
        let cursor: string | null = null;

        do {
          if (cursor) {
            queryParams.set("cursor", cursor);
          } else {
            queryParams.delete("cursor");
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 60000);
          let response: Response;
          try {
            response = await fetch(`${apiUrl}${endpoint}?${queryParams.toString()}`, {
              signal: controller.signal
            });
          } finally {
            clearTimeout(timeoutId);
          }

          if (!response.ok) {
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
              const errResult = await response.json();
              throw new Error(errResult.message || `Server error: ${response.status}`);
            }
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
          }

          const result = await response.json();
          if (result.status !== "success") {
            setError(result.message || "Failed to fetch data");
            return;
          }

          accumulated = accumulated.concat(result.data || []);
          setData([...accumulated]);
          cursor = isPaginatedLive ? (result.cursor || null) : null;
        } while (cursor);
      } catch (err: any) {
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
      const endpoint = activeSection === "reservations" ? "/reservations/sync-manual"
                     : activeSection === "members"       ? "/members/sync-manual"
                     : activeSection === "resources"      ? "/resources/sync-manual"
                     : activeSection === "bills"          ? "/bills/sync-manual"
                     :                                    "/payments/sync-manual";
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
    
    const endpoint = activeSection === "reservations" ? "/reservations/saved"
                    : activeSection === "resources"    ? "/resources/managed"
                    : activeSection === "bills"         ? "/bills/managed"
                    :                                    "/members/managed";
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
        const itemDateStr = item.report_date || item["Import Date"] || item.processed_at || item.synced_at || item.created_at;
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
    <div className="flex-1 flex flex-col bg-[#FFEFD2] text-[#152A00] p-4 md:p-6">
      <div className="max-w-7xl mx-auto w-full">
        <PageHeader title={title} description={subtitle}>
          {allowToggleDataSource && (
            <div className="flex items-center gap-1 bg-[#152A00]/5 border border-[#152A00]/10 p-1">
              <button
                onClick={() => setDataSource("live")}
                className={`px-6 py-2 text-[10px] font-bold tracked-caps transition-all ${dataSource === "live" ? "bg-[#152A00] text-[#FFEFD2]" : "text-[#152A00]/40 hover:text-[#152A00]"}`}
              >
                MEWS
              </button>
              <button
                onClick={() => setDataSource("saved")}
                className={`px-6 py-2 text-[10px] font-bold tracked-caps transition-all ${dataSource === "saved" ? "bg-[#152A00] text-[#FFEFD2]" : "text-[#152A00]/40 hover:text-[#152A00]"}`}
              >
                Data Mart
              </button>
            </div>
          )}
        </PageHeader>
          
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4 mt-4 mb-4">
          <div className="flex flex-col gap-2 w-full md:w-80">
            <label className="text-[9px] font-bold text-[#152A00]/50 tracked-caps ml-1">Select Property</label>
            <select value={selectedProperty} onChange={(e) => setSelectedProperty(e.target.value)} className="w-full bg-white border border-[#152A00]/14 px-4 py-2 text-[13px] appearance-none cursor-pointer text-[#152A00] focus:border-[#152A00] outline-none">
              {properties.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2 w-full md:w-56">
            <label className="text-[9px] font-bold text-[#152A00]/50 tracked-caps ml-1">Start Date</label>
            <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full bg-white border border-[#152A00]/14 px-4 py-1.5 text-[13px] text-[#152A00] focus:border-[#152A00] outline-none" />
          </div>
          <div className="flex flex-col gap-2 w-full md:w-56">
            <label className="text-[9px] font-bold text-[#152A00]/50 tracked-caps ml-1">End Date</label>
            <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full bg-white border border-[#152A00]/14 px-4 py-1.5 text-[13px] text-[#152A00] focus:border-[#152A00] outline-none" />
          </div>
          <button onClick={fetchData} disabled={loading} className="btn-brand btn-primary h-[46px]">Sync Data</button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 mb-1 bg-[#fffaf0] p-4 border border-[#152A00]/14 border-b-0">
          {showSectionTabs && (
            <div className="flex gap-8 border-b border-[#152A00]/10">
              {(["reservations", "members", "payments", "bills", "resources"] as Section[]).map((s) => (
                <button 
                  key={s} 
                  onClick={() => setActiveSection(s)} 
                  className={`pb-3 text-[11px] font-bold tracked-caps transition-all px-1 border-b-2 ${activeSection === s ? "border-[#152A00] text-[#152A00]" : "border-transparent text-[#152A00]/30 hover:text-[#152A00]"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-1 items-center justify-end gap-6">
            <div className="relative max-w-xs w-full">
              <input type="text" placeholder="Filter records..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-white border border-[#152A00]/14 px-4 py-2 text-[13px] text-[#152A00] focus:border-[#152A00] outline-none" />
            </div>
            <div className="flex gap-3">
              {showCheckboxes && selectedIds.length > 0 && (
                <button onClick={handleDeleteSelected} className="px-6 py-2 bg-[#250719] text-[#FFEFD2] text-[10px] tracked-caps">
                  Delete ({selectedIds.length})
                </button>
              )}
              {isSuperAdmin && dataSource === "live" && (
                <button onClick={handleManualSync} disabled={data.length === 0 || syncing} className="btn-brand btn-secondary py-2 text-[10px]">
                  Import To Data Mart
                </button>
              )}
              <button onClick={exportToExcel} disabled={data.length === 0} className="btn-brand btn-primary py-2 text-[10px]">
                Export Excel
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="p-4 bg-white border border-red-200 text-red-700 text-sm leading-relaxed mb-6">{error}</div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center py-16 bg-[#fffaf0] border border-[#152A00]/14">
            <div className="animate-spin h-8 w-8 border-2 border-[#152A00]/10 border-t-[#152A00]"></div>
            <p className="mt-4 text-[10px] tracked-caps opacity-40 font-bold">Retrieving portfolio data...</p>
          </div>
        ) : (
          <div className="bg-[#fffaf0] border border-[#152A00]/14 flex flex-col mb-8 shadow-[20px_20px_60px_rgba(21,42,0,0.03)]">
            <div ref={topScrollRef} onScroll={handleTopScroll} className="overflow-x-auto overflow-y-hidden h-2 bg-[#152A00]/5">
              <div style={{ width: tableContainerRef.current?.scrollWidth || 'auto', height: '1px' }}></div>
            </div>
            <div ref={tableContainerRef} onScroll={handleTableScroll} className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-max">
                <thead>
                  <tr className="bg-[#152A00]/5">
                    {showCheckboxes && (
                      <th className="p-2 px-3 border-b border-[#152A00]/10">
                        <input type="checkbox" checked={selectedIds.length === filteredAndSortedData.length && filteredAndSortedData.length > 0} onChange={toggleSelectAll} className="accent-[#152A00]" />
                      </th>
                    )}
                    {allKeys.map((col) => (
                      <th key={col} onClick={() => requestSort(col)} className="p-2 px-3 text-[9px] font-bold text-[#152A00]/50 uppercase tracking-[0.12em] border-b border-[#152A00]/10 cursor-pointer hover:bg-[#152A00]/5 whitespace-nowrap transition-colors">
                        <div className="flex items-center gap-2">
                          {col.replace(/([A-Z])/g, ' $1').trim()}
                          <span className="text-[8px] opacity-40">{sortConfig?.key === col ? (sortConfig.direction === 'asc' ? "↑" : "↓") : "•"}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#152A00]/5">
                  {filteredAndSortedData.length === 0 ? (
                    <tr><td colSpan={100} className="p-10 text-center text-[#152A00]/30 font-display text-2xl italic">No entries found in this range.</td></tr>
                  ) : (
                    paginatedData.map((item, idx) => (
                      <tr key={item.Identifier || item.mews_id || idx} className={`hover:bg-[#152A00]/3 transition-colors ${selectedIds.includes(item.Identifier || item.mews_id) ? 'bg-[#152A00]/5' : ''}`}>
                        {showCheckboxes && (
                          <td className="p-2 px-3">
                            <input type="checkbox" checked={selectedIds.includes(item.Identifier || item.mews_id)} onChange={() => toggleSelectRow(item.Identifier || item.mews_id)} className="accent-[#152A00]" />
                          </td>
                        )}
                        {allKeys.map((key) => <td key={key} className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap overflow-hidden max-w-[300px] text-ellipsis">{renderValue(key, item[key])}</td>)}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {filteredAndSortedData.length > 0 && (
              <div className="p-4 bg-white border-t border-[#152A00]/10 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-6 text-[10px] font-bold tracked-caps text-[#152A00]/40">
                  <div className="flex items-center gap-2">
                    <span>PAGE SIZE</span>
                    <select value={rowsPerPage} onChange={(e) => setRowsPerPage(Number(e.target.value))} className="bg-transparent border border-[#152A00]/10 px-2 py-1 outline-none text-[#152A00]">
                      {[20, 50, 100, 200, 500].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <span>{(currentPage-1)*rowsPerPage + 1} – {Math.min(currentPage*rowsPerPage, filteredAndSortedData.length)} OF {filteredAndSortedData.length} RECORDS</span>
                </div>
                <div className="flex gap-2">
                  <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-4 py-2 text-[10px] font-bold tracked-caps border border-[#152A00]/10 disabled:opacity-20 hover:bg-[#152A00]/5 transition-colors">PREVIOUS</button>
                  <div className="flex gap-1">
                    {[...Array(Math.min(5, totalPages))].map((_, i) => (
                      <button key={i} onClick={() => setCurrentPage(i+1)} className={`w-8 h-8 text-[10px] font-bold transition-all ${currentPage === i+1 ? "bg-[#152A00] text-[#FFEFD2]" : "text-[#152A00] hover:bg-[#152A00]/5 border border-[#152A00]/10"}`}>{i+1}</button>
                    ))}
                  </div>
                  <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-4 py-2 text-[10px] font-bold tracked-caps border border-[#152A00]/10 disabled:opacity-20 hover:bg-[#152A00]/5 transition-colors">NEXT</button>
                </div>
              </div>
            )}
          </div>
        )}

        {showSyncModal && syncStatus && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#152A00]/40 backdrop-blur-sm">
            <div className="bg-white border border-[#152A00]/14 p-12 shadow-[40px_40px_100px_rgba(21,42,0,0.1)] max-w-md w-full text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-[#152A00]"></div>
              <h3 className="font-display text-3xl text-[#152A00] mb-2 text-left">Synchronization Complete</h3>
              <p className="text-[#152A00]/60 text-sm mb-10 text-left">Portfolio data has been successfully imported to the management layer.</p>
              
              <div className="grid grid-cols-2 gap-1px bg-[#152A00]/10 border border-[#152A00]/10 my-8">
                <div className="bg-[#fffaf0] p-6 text-left">
                  <p className="text-[9px] font-bold text-[#152A00]/50 tracked-caps mb-2">NEW ENTRIES</p>
                  <p className="text-4xl font-display text-[#152A00]">{syncStatus.inserted}</p>
                </div>
                <div className="bg-[#fffaf0] p-6 text-left">
                  <p className="text-[9px] font-bold text-[#152A00]/50 tracked-caps mb-2">DUPLICATES</p>
                  <p className="text-4xl font-display text-[#152A00]/40">{syncStatus.skipped}</p>
                </div>
              </div>
              
              <button 
                onClick={() => setShowSyncModal(false)} 
                className="w-full py-5 bg-[#152A00] text-[#FFEFD2] text-[11px] font-bold tracked-caps transition-all active:scale-[0.985]"
              >
                RETURN TO MANAGEMENT
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
