"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";

interface PropertySyncSettings {
  id: string;
  property_name: string;
  sync_hour: number;
  sync_minute: number;
  sync_enabled: boolean;
  sync_reservations: boolean;
  sync_members: boolean;
  sync_payments: boolean;
  sync_bills: boolean;
  sync_resources: boolean;
  // ST Files' own independent schedule - always imports TODAY's Bangkok
  // date (not yesterday, unlike the 5 tables above), matching what the
  // manual Import To Data Mart button on /st-files fetches by default.
  st_files_sync_enabled: boolean;
  st_files_sync_hour: number | null;
  st_files_sync_minute: number | null;
}

const SYNC_TABLE_OPTIONS: { key: keyof PropertySyncSettings; label: string }[] = [
  { key: "sync_reservations", label: "Reservations" },
  { key: "sync_members", label: "Members" },
  { key: "sync_payments", label: "Payments" },
  { key: "sync_bills", label: "Bills (+ Order Items)" },
  { key: "sync_resources", label: "Resources" },
];

export default function AdminSyncPage() {
  const [properties, setProperties] = useState<PropertySyncSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProperty, setEditingProperty] = useState<PropertySyncSettings | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchProperties = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("property_api_settings")
        .select("id, property_name, sync_hour, sync_minute, sync_enabled, sync_reservations, sync_members, sync_payments, sync_bills, sync_resources, st_files_sync_enabled, st_files_sync_hour, st_files_sync_minute")
        .order("property_name");
      
      if (error) throw error;
      setProperties(data || []);
    } catch (err: unknown) {
      console.error("Failed to fetch sync settings:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProperties();
  }, []);

  const handleToggleSync = async (prop: PropertySyncSettings) => {
    const newEnabled = !prop.sync_enabled;
    // Optimistic update
    setProperties(prev => prev.map(p => p.id === prop.id ? { ...p, sync_enabled: newEnabled } : p));
    
    const { error } = await supabase
      .from("property_api_settings")
      .update({ sync_enabled: newEnabled })
      .eq("id", prop.id);

    if (error) {
      console.error("Failed to toggle sync:", error);
      // Revert on error
      setProperties(prev => prev.map(p => p.id === prop.id ? { ...p, sync_enabled: prop.sync_enabled } : p));
      alert("Failed to update sync status");
    }
  };

  const handleSaveSettings = async () => {
    if (!editingProperty) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("property_api_settings")
        .update({
          sync_hour: editingProperty.sync_hour,
          sync_minute: editingProperty.sync_minute,
          sync_enabled: editingProperty.sync_enabled,
          sync_reservations: editingProperty.sync_reservations,
          sync_members: editingProperty.sync_members,
          sync_payments: editingProperty.sync_payments,
          sync_bills: editingProperty.sync_bills,
          sync_resources: editingProperty.sync_resources,
          st_files_sync_enabled: editingProperty.st_files_sync_enabled,
          st_files_sync_hour: editingProperty.st_files_sync_hour,
          st_files_sync_minute: editingProperty.st_files_sync_minute,
        })
        .eq("id", editingProperty.id);
      
      if (error) throw error;
      setProperties(prev => prev.map(p => p.id === editingProperty.id ? editingProperty : p));
      setEditingProperty(null);
    } catch (err) {
      console.error("Failed to save settings:", err);
      alert("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 bg-white min-h-screen text-slate-900 font-sans relative">
      <PageHeader 
        title="Auto Import Schedule" 
        description="Manage automated daily synchronization schedules for each property."
      >
        <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200">
           <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
           <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Scheduler Active (Asia/Bangkok)</span>
        </div>
      </PageHeader>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-6">
        <div className="p-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
           <h3 className="text-sm font-bold text-slate-700">Property Settings</h3>
           <button 
             onClick={fetchProperties}
             className="p-2 text-slate-400 hover:text-[#AAA024] transition-colors"
             title="Refresh"
           >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
           </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/30 border-b border-slate-100">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Property Name</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Sync Time</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Auto-Sync</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={4} className="py-20 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#AAA024] mx-auto"></div></td></tr>
              ) : properties.length === 0 ? (
                <tr><td colSpan={4} className="py-20 text-center text-slate-400 text-sm">No properties configured. Add properties via API Setting first.</td></tr>
              ) : properties.map((prop) => (
                <tr key={prop.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-5">
                    <div className="text-sm font-bold text-slate-700">{prop.property_name}</div>
                    <div className="text-[10px] text-slate-400 font-medium">Daily incremental sync</div>
                  </td>
                  <td className="px-6 py-5 text-center">
                    <span className="bg-[#AAA024]/5 text-[#AAA024] px-3 py-1.5 rounded-lg text-sm font-mono font-bold border border-[#AAA024]/10">
                      {String(prop.sync_hour).padStart(2, '0')}:{String(prop.sync_minute).padStart(2, '0')}
                    </span>
                    {prop.st_files_sync_enabled && (
                      <div className="mt-1.5 text-[10px] text-slate-400 font-medium">
                        ST Files {String(prop.st_files_sync_hour ?? 0).padStart(2, '0')}:{String(prop.st_files_sync_minute ?? 0).padStart(2, '0')}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex justify-center">
                      <button 
                        onClick={() => handleToggleSync(prop)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${prop.sync_enabled ? 'bg-emerald-500' : 'bg-slate-200'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${prop.sync_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-5 text-center">
                    <button 
                      onClick={() => setEditingProperty(prop)}
                      className="px-4 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-200 transition-all border border-slate-200"
                    >
                      Edit Schedule
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editingProperty && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
           <div className="bg-[#1a1a1a] rounded-[24px] w-full max-w-[440px] shadow-2xl overflow-hidden border border-white/10 p-8 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center mb-8">
                 <h2 className="text-xl font-bold text-white">Edit Auto Import Schedule</h2>
                 <button onClick={() => setEditingProperty(null)} className="text-white/40 hover:text-white transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
              </div>

              <div className="mb-6">
                <p className="text-white/60 text-sm">{editingProperty.property_name}</p>
              </div>

              <div className="space-y-6">
                 <div>
                    <label className="text-xs font-bold text-white/40 ml-1 block mb-3 uppercase tracking-widest">Scheduled Time (24h, Asia/Bangkok)</label>
                    <div className="grid grid-cols-2 gap-4">
                       <div className="space-y-2">
                          <label className="text-[10px] font-bold text-white/20 ml-1">HOUR (0-23)</label>
                          <input 
                            type="number"
                            min="0"
                            max="23"
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-lg focus:outline-none focus:ring-2 focus:ring-[#AAA024]/40 transition-all"
                            value={editingProperty.sync_hour}
                            onChange={(e) => setEditingProperty({...editingProperty, sync_hour: parseInt(e.target.value) || 0})}
                          />
                       </div>
                       <div className="space-y-2">
                          <label className="text-[10px] font-bold text-white/20 ml-1">MINUTE (0-59)</label>
                          <input 
                            type="number"
                            min="0"
                            max="59"
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-lg focus:outline-none focus:ring-2 focus:ring-[#AAA024]/40 transition-all"
                            value={editingProperty.sync_minute}
                            onChange={(e) => setEditingProperty({...editingProperty, sync_minute: parseInt(e.target.value) || 0})}
                          />
                       </div>
                    </div>
                 </div>

                 <div>
                    <label className="text-xs font-bold text-white/40 ml-1 block mb-3 uppercase tracking-widest">Data To Sync</label>
                    <div className="space-y-2">
                       {SYNC_TABLE_OPTIONS.map((opt) => (
                         <label key={opt.key} className="flex items-center gap-3 bg-white/5 px-4 py-2.5 rounded-xl border border-white/5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editingProperty[opt.key] as boolean}
                              onChange={(e) => setEditingProperty({ ...editingProperty, [opt.key]: e.target.checked })}
                              className="accent-[#AAA024] w-4 h-4"
                            />
                            <span className="text-sm text-white">{opt.label}</span>
                         </label>
                       ))}
                    </div>
                 </div>

                 <div className="border-t border-white/10 pt-6">
                    <label className="text-xs font-bold text-white/40 ml-1 block mb-3 uppercase tracking-widest">ST Files Auto Import</label>
                    <div className="flex items-center gap-3 bg-white/5 p-4 rounded-2xl border border-white/5 mb-4">
                       <button
                         onClick={() => setEditingProperty({
                           ...editingProperty,
                           st_files_sync_enabled: !editingProperty.st_files_sync_enabled,
                           // Sensible default (05:00) the first time this is turned
                           // on for a property that's never had it configured.
                           st_files_sync_hour: editingProperty.st_files_sync_hour ?? 5,
                           st_files_sync_minute: editingProperty.st_files_sync_minute ?? 0,
                         })}
                         className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0 ${editingProperty.st_files_sync_enabled ? 'bg-emerald-500' : 'bg-white/10'}`}
                       >
                         <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editingProperty.st_files_sync_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                       </button>
                       <div className="flex flex-col">
                          <span className="text-sm font-bold text-white">Import to Database daily</span>
                          <span className="text-[10px] text-white/40">Auto-imports that day&apos;s ST Files report (Live API result) into our Database, same as the manual &quot;Import To Data Mart&quot; button</span>
                       </div>
                    </div>
                    {editingProperty.st_files_sync_enabled && (
                       <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                             <label className="text-[10px] font-bold text-white/20 ml-1">HOUR (0-23)</label>
                             <input
                               type="number"
                               min="0"
                               max="23"
                               className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-lg focus:outline-none focus:ring-2 focus:ring-[#AAA024]/40 transition-all"
                               value={editingProperty.st_files_sync_hour ?? 5}
                               onChange={(e) => setEditingProperty({...editingProperty, st_files_sync_hour: parseInt(e.target.value) || 0})}
                             />
                          </div>
                          <div className="space-y-2">
                             <label className="text-[10px] font-bold text-white/20 ml-1">MINUTE (0-59)</label>
                             <input
                               type="number"
                               min="0"
                               max="59"
                               className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-lg focus:outline-none focus:ring-2 focus:ring-[#AAA024]/40 transition-all"
                               value={editingProperty.st_files_sync_minute ?? 0}
                               onChange={(e) => setEditingProperty({...editingProperty, st_files_sync_minute: parseInt(e.target.value) || 0})}
                             />
                          </div>
                       </div>
                    )}
                 </div>

                 <div className="flex items-center gap-3 bg-white/5 p-4 rounded-2xl border border-white/5">
                    <button
                      onClick={() => setEditingProperty({...editingProperty, sync_enabled: !editingProperty.sync_enabled})}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${editingProperty.sync_enabled ? 'bg-emerald-500' : 'bg-white/10'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editingProperty.sync_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                    <div className="flex flex-col">
                       <span className="text-sm font-bold text-white">Enable Automated Sync</span>
                       <span className="text-[10px] text-white/40">Keep this on for daily automated imports</span>
                    </div>
                 </div>

                 <div className="pt-4 flex gap-3">
                    <button 
                      onClick={handleSaveSettings}
                      disabled={saving}
                      className="flex-1 bg-[#AAA024] text-white rounded-xl py-3.5 text-sm font-extrabold shadow-xl shadow-[#AAA024]/20 hover:bg-[#8f871e] transition-all disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Save Schedule"}
                    </button>
                    <button 
                      onClick={() => setEditingProperty(null)}
                      className="flex-1 bg-white/5 text-white/60 rounded-xl py-3.5 text-sm font-bold hover:bg-white/10 transition-all border border-white/5"
                    >
                      Cancel
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
