"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";

interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  role: string;
  status: "Active" | "Inactive" | "Pending";
  last_login: string;
  joined_at: string;
  created_at?: string;
}

interface RolePermissionRow {
  role: string;
  dashboard: boolean;
  data_mart: boolean;
  bills: boolean;
  rr3: boolean;
  log_import: boolean;
  admin: boolean;
}

const MENU_ITEMS: { key: keyof Omit<RolePermissionRow, "role">; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "data_mart", label: "Data Mart" },
  { key: "bills", label: "Bills" },
  { key: "rr3", label: "RR3" },
  { key: "log_import", label: "Log Import" },
  { key: "admin", label: "Admin" },
];

export default function AdminUsersPage() {
  const [activeTab, setActiveTab] = useState<"users" | "roles">("users");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [rolePermissions, setRolePermissions] = useState<RolePermissionRow[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [newRoleName, setNewRoleName] = useState("");
  const [addingRole, setAddingRole] = useState(false);


  const fetchUsers = async () => {
    console.log("Fetching users from profiles table...");
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase Error:", error.message, error.details, error.hint);
      alert("Error fetching users: " + error.message);
    } else {
      console.log("Successfully fetched users:", data);
      setUsers(data as UserProfile[]);
    }
    setLoading(false);
  };

  const fetchRolePermissions = async () => {
    setLoadingRoles(true);
    const { data, error } = await supabase
      .from("role_permissions")
      .select("*");

    if (error) {
      console.error("Failed to fetch role_permissions:", error.message);
    } else {
      // Renders every role that actually has a row - roles are created via
      // handleAddRole below, not a fixed list. Super Admin always sorts first
      // (it's the locked/read-only row); everything else is alphabetical.
      const rows = [...(data as RolePermissionRow[])].sort((a, b) => {
        if (a.role === "Super Admin") return -1;
        if (b.role === "Super Admin") return 1;
        return a.role.localeCompare(b.role);
      });
      setRolePermissions(rows);
    }
    setLoadingRoles(false);
  };

  const handleAddRole = async () => {
    const name = newRoleName.trim();
    if (!name) return;
    if (rolePermissions.some((r) => r.role.toLowerCase() === name.toLowerCase())) {
      alert(`Role "${name}" already exists`);
      return;
    }
    setAddingRole(true);
    try {
      // New roles start Dashboard-only (matching the "User" role's own
      // tightened default) rather than all-false, so a freshly created role
      // isn't immediately a blank/broken experience before anyone's had a
      // chance to check more boxes for it.
      const newRow: RolePermissionRow = {
        role: name, dashboard: true, data_mart: false, bills: false, rr3: false, log_import: false, admin: false,
      };
      const { error } = await supabase.from("role_permissions").insert(newRow);
      if (error) {
        alert("Error creating role: " + error.message);
      } else {
        setNewRoleName("");
        fetchRolePermissions();
      }
    } finally {
      setAddingRole(false);
    }
  };

  const handleTogglePermission = async (role: string, key: keyof Omit<RolePermissionRow, "role">) => {
    if (role === "Super Admin") return; // locked - always full access
    const current = rolePermissions.find((r) => r.role === role);
    if (!current) return;
    const nextValue = !current[key];

    // Optimistic update
    setRolePermissions((prev) => prev.map((r) => (r.role === role ? { ...r, [key]: nextValue } : r)));

    const { error } = await supabase
      .from("role_permissions")
      .upsert({ ...current, [key]: nextValue }, { onConflict: "role" });

    if (error) {
      console.error("Failed to update role_permissions:", error.message);
      alert("Error saving permission: " + error.message);
      setRolePermissions((prev) => prev.map((r) => (r.role === role ? { ...r, [key]: current[key] } : r)));
    }
  };

  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", role: "User", full_name: "" });
  const [creating, setCreating] = useState(false);
  const [approvingUser, setApprovingUser] = useState<UserProfile | null>(null);
  const [approveRole, setApproveRole] = useState("User");
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    fetchUsers();
    fetchRolePermissions();
  }, []);

  const handleCreateUser = async () => {
    if (!newUser.email) {
      alert("Email is required");
      return;
    }
    setCreating(true);
    try {
      // Hardcoded same-origin path, deliberately NOT NEXT_PUBLIC_API_URL: that
      // env var points at a stale API deployment lacking newer endpoints (see
      // the Templates editor's identical fix).
      const response = await fetch(`/api/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser)
      });
      const result = await response.json();
      if (result.status === "success") {
        setShowCreateModal(false);
        setNewUser({ email: "", role: "User", full_name: "" });
        fetchUsers();
        if (!result.email_sent) {
          alert(
            `User created, but the welcome email failed to send: ${result.email_error || "unknown error"}. ` +
            `Please share the password with them directly.`
          );
        }
      } else {
        alert("Error: " + (result.detail || result.message));
      }
    } catch (err: any) {
      alert("Failed to connect to backend");
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    if (!editingUser) return;

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: editingUser.full_name,
        role: editingUser.role,
        status: editingUser.status
      })
      .eq("id", editingUser.id);

    if (error) {
      alert("Error updating profile: " + error.message);
    } else {
      setUsers(users.map(u => u.id === editingUser.id ? editingUser : u));
      setEditingUser(null);
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm("Are you sure you want to delete this account? This action cannot be undone.")) return;

    const { error } = await supabase
      .from("profiles")
      .delete()
      .eq("id", userId);

    if (error) {
      alert("Error deleting user: " + error.message);
    } else {
      setUsers(users.filter(u => u.id !== userId));
    }
  };

  const handleApprove = async () => {
    if (!approvingUser) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/admin/users/${approvingUser.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: approveRole }),
      });
      const result = await res.json();
      if (result.status === "success") {
        setApprovingUser(null);
        fetchUsers();
      } else {
        alert("Error approving user: " + (result.detail || result.message));
      }
    } catch (err: any) {
      alert("Failed to connect to backend");
    } finally {
      setApproving(false);
    }
  };

  const filteredUsers = users.filter(u =>
    u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6 bg-white min-h-screen text-slate-900 font-sans relative">
      <PageHeader
        title="User Management"
        description="Welcome back, Managing system as Super_admin."
      >
        <div className="flex items-center gap-4">
          <div className="flex items-end gap-1 border-b border-slate-200">
            <button
              onClick={() => setActiveTab("users")}
              className={`px-5 py-2.5 -mb-px text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${activeTab === "users" ? "border-[#AAA024] text-[#AAA024]" : "border-transparent text-slate-400 hover:text-slate-700"}`}
            >
              Users
            </button>
            <button
              onClick={() => setActiveTab("roles")}
              className={`px-5 py-2.5 -mb-px text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${activeTab === "roles" ? "border-[#AAA024] text-[#AAA024]" : "border-transparent text-slate-400 hover:text-slate-700"}`}
            >
              Role Settings
            </button>
          </div>
          {activeTab === "users" && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-2.5 bg-[#AAA024] text-white rounded-xl text-sm font-bold shadow-lg shadow-[#AAA024]/20 hover:bg-[#8f871e] transition-all flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
              Create New User
            </button>
          )}
        </div>
      </PageHeader>

      {activeTab === "users" && (
      <>
      {/* Search & Toolbar */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-6">
        <div className="p-4 flex flex-col md:flex-row gap-4 items-center justify-between border-b border-slate-100">
           <div className="relative w-full md:w-96">
              <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input 
                type="text"
                placeholder="Search users..."
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/10 transition-all font-medium text-slate-900"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
           </div>
           <div className="flex gap-2">
              <button 
                onClick={fetchUsers}
                className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                Refresh
              </button>
           </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Name</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Role</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Last Log-in</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Joined</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="py-20 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#AAA024] mx-auto"></div></td></tr>
              ) : filteredUsers.map((user) => (
                <tr key={user.id} className={`hover:bg-slate-50/50 transition-colors group ${user.status === 'Pending' ? 'bg-amber-50/50' : ''}`}>
                  <td className="px-6 py-5 text-sm font-bold text-slate-700">{user.full_name}</td>
                  <td className="px-6 py-5 text-sm text-[#AAA024] font-medium">{user.email}</td>
                  <td className="px-6 py-5">
                     <span className={`px-3 py-1 rounded-full text-[11px] font-bold border ${
                       user.role === 'Super Admin'
                       ? 'bg-[#AAA024]/10 text-[#AAA024] border-[#AAA024]/20'
                       : 'bg-slate-100 text-slate-600 border-slate-200'
                     }`}>
                       {user.role}
                     </span>
                  </td>
                  <td className="px-6 py-5">
                     <div className="flex items-center gap-1.5">
                       <div className={`w-1.5 h-1.5 rounded-full ${user.status === 'Active' ? 'bg-emerald-500' : user.status === 'Pending' ? 'bg-amber-500' : 'bg-slate-300'}`}></div>
                       <span className={`${user.status === 'Active' ? 'text-emerald-600' : user.status === 'Pending' ? 'text-amber-600' : 'text-slate-500'} text-[11px] font-bold`}>
                         {user.status === 'Pending' ? 'Waiting for approve' : user.status}
                       </span>
                     </div>
                  </td>
                  <td className="px-6 py-5 text-xs text-slate-500 font-medium">
                    {user.last_login ? new Date(user.last_login).toLocaleString() : "Never"}
                  </td>
                  <td className="px-6 py-5 text-xs text-slate-500 font-medium">
                    {new Date(user.created_at || user.joined_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-5 text-center relative overflow-visible group/actions">
                     {user.status === 'Pending' && (
                       <button
                         onClick={() => { setApprovingUser(user); setApproveRole("User"); }}
                         className="px-4 py-1.5 mr-2 bg-[#AAA024] text-white rounded-lg text-xs font-bold hover:bg-[#8f871e] transition-all"
                       >
                         Approve
                       </button>
                     )}
                     <button className="text-slate-300 hover:text-slate-600 transition-colors p-2 rounded-lg hover:bg-slate-100">
                       <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM18 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                     </button>

                     {/* Action Dropdown Menu */}
                     <div className="absolute right-0 top-12 w-48 bg-white border border-slate-200 rounded-2xl shadow-xl z-[100] hidden group-hover/actions:block animate-in fade-in zoom-in-95 duration-100 p-1.5">
                        <button 
                          onClick={() => setEditingUser(user)}
                          className="w-full text-left px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 rounded-xl transition-colors flex items-center gap-2"
                        >
                          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          Edit Profile
                        </button>
                        <button 
                          onClick={() => handleDelete(user.id)}
                          className="w-full text-left px-3 py-2 text-xs font-bold text-red-500 hover:bg-red-50 rounded-xl transition-colors flex items-center gap-2"
                        >
                          <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          Delete Account
                        </button>
                     </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {activeTab === "roles" && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-6">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-700">Role × Menu Access</h3>
              <p className="text-xs text-slate-500 mt-1">Controls which sidebar menu items each role can see. Super Admin always has full access and can&apos;t be edited here.</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddRole(); }}
                placeholder="New role name..."
                className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 w-48"
              />
              <button
                onClick={handleAddRole}
                disabled={addingRole || !newRoleName.trim()}
                className="px-4 py-2 bg-[#AAA024] text-white rounded-xl text-xs font-bold hover:bg-[#8f871e] transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {addingRole ? "Adding..." : "+ Add Role"}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Role</th>
                  {MENU_ITEMS.map((item) => (
                    <th key={item.key} className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">{item.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingRoles ? (
                  <tr><td colSpan={MENU_ITEMS.length + 1} className="py-20 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#AAA024] mx-auto"></div></td></tr>
                ) : rolePermissions.map((row) => {
                  const isLocked = row.role === "Super Admin";
                  return (
                    <tr key={row.role} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-5">
                        <span className={`px-3 py-1 rounded-full text-[11px] font-bold border ${
                          row.role === 'Super Admin'
                          ? 'bg-[#AAA024]/10 text-[#AAA024] border-[#AAA024]/20'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          {row.role}
                        </span>
                      </td>
                      {MENU_ITEMS.map((item) => (
                        <td key={item.key} className="px-6 py-5 text-center">
                          <input
                            type="checkbox"
                            checked={isLocked ? true : row[item.key]}
                            disabled={isLocked}
                            onChange={() => handleTogglePermission(row.role, item.key)}
                            className={`w-4 h-4 accent-[#AAA024] ${isLocked ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
           <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-slate-200">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                 <h2 className="text-xl font-bold text-slate-800">Edit User Profile</h2>
                 <button onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-slate-600">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
              </div>
              
              <div className="p-6 space-y-6">
                 <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Full Name</label>
                    <input 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                      value={editingUser.full_name}
                      onChange={(e) => setEditingUser({...editingUser, full_name: e.target.value})}
                    />
                 </div>

                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                       <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Role</label>
                       <select 
                         className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                         value={editingUser.role}
                         onChange={(e) => setEditingUser({...editingUser, role: e.target.value})}
                       >
                          {rolePermissions.map((r) => (
                            <option key={r.role} value={r.role}>{r.role}</option>
                          ))}
                       </select>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Status</label>
                       <select 
                         className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                         value={editingUser.status}
                         onChange={(e) => setEditingUser({...editingUser, status: e.target.value as any})}
                       >
                          <option value="Active">Active</option>
                          <option value="Inactive">Inactive</option>
                       </select>
                    </div>
                 </div>

                 <div className="pt-4 flex gap-3">
                    <button 
                      onClick={handleSave}
                      className="flex-1 bg-[#AAA024] text-white rounded-xl py-2.5 text-sm font-bold shadow-lg shadow-[#AAA024]/20 hover:bg-[#8f871e] transition-all"
                    >
                      Save Changes
                    </button>
                    <button 
                      onClick={() => setEditingUser(null)}
                      className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5 text-sm font-bold hover:bg-slate-200 transition-all"
                    >
                      Cancel
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Approve Modal - pending self-registered user gets a real role + Active status */}
      {approvingUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
           <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-slate-200">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                 <h2 className="text-xl font-bold text-slate-800">Approve User</h2>
                 <button onClick={() => setApprovingUser(null)} className="text-slate-400 hover:text-slate-600">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
              </div>

              <div className="p-6 space-y-6">
                 <p className="text-sm text-slate-500">
                   Assign a role for <span className="font-bold text-slate-700">{approvingUser.email}</span> to activate their account.
                 </p>
                 <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Role</label>
                    <select
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                      value={approveRole}
                      onChange={(e) => setApproveRole(e.target.value)}
                    >
                       {rolePermissions.map((r) => (
                         <option key={r.role} value={r.role}>{r.role}</option>
                       ))}
                    </select>
                 </div>

                 <div className="pt-4 flex gap-3">
                    <button
                      onClick={handleApprove}
                      disabled={approving}
                      className="flex-1 bg-[#AAA024] text-white rounded-xl py-2.5 text-sm font-bold shadow-lg shadow-[#AAA024]/20 hover:bg-[#8f871e] transition-all disabled:opacity-50"
                    >
                      {approving ? "Approving..." : "Approve"}
                    </button>
                    <button
                      onClick={() => setApprovingUser(null)}
                      className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5 text-sm font-bold hover:bg-slate-200 transition-all"
                    >
                      Cancel
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Create User Modal - Designed as per photo but integrated with Role */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
           <div className="bg-[#1a1a1a] rounded-[24px] w-full max-w-[440px] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-white/10 p-8">
              <div className="flex justify-between items-center mb-8">
                 <h2 className="text-xl font-bold text-white">Create a new user</h2>
                 <button onClick={() => setShowCreateModal(false)} className="text-white/40 hover:text-white transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
              </div>
              
              <div className="space-y-6">
                  <div className="space-y-2">
                     <label className="text-xs font-bold text-white/60 ml-1">Full Name</label>
                     <div className="relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                        </div>
                        <input 
                          type="text"
                          placeholder="Full Name"
                          className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#AAA024]/40 placeholder:text-white/20 transition-all"
                          value={newUser.full_name}
                          onChange={(e) => setNewUser({...newUser, full_name: e.target.value})}
                        />
                     </div>
                  </div>
                 <div className="space-y-2">
                    <label className="text-xs font-bold text-white/60 ml-1">Email address</label>
                    <div className="relative">
                       <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                       </div>
                       <input 
                         type="email"
                         placeholder="user@gmail.com"
                         className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#AAA024]/40 placeholder:text-white/20 transition-all"
                         value={newUser.email}
                         onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                       />
                    </div>
                 </div>

                 <div className="space-y-2">
                    <label className="text-xs font-bold text-white/60 ml-1">Assigned Role</label>
                    <select 
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#AAA024]/40 appearance-none cursor-pointer transition-all"
                      value={newUser.role}
                      onChange={(e) => setNewUser({...newUser, role: e.target.value})}
                    >
                       {rolePermissions.map((r) => (
                         <option key={r.role} value={r.role} className="bg-[#1a1a1a]">{r.role}</option>
                       ))}
                    </select>
                 </div>

                  <div className="flex items-center gap-3 ml-1 p-3 bg-white/5 rounded-xl border border-white/10">
                     <svg className="w-5 h-5 text-[#AAA024] shrink-0" viewBox="0 0 18 18" fill="currentColor"><path d="M17.64 9.20455C17.64 8.56636 17.5827 7.95273 17.4764 7.36364H9V10.845H13.8436C13.635 11.97 13.0009 12.9232 12.0477 13.5614V15.8195H14.9564C16.6582 14.2527 17.64 11.9455 17.64 9.20455Z" /><path d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.8195L12.0477 13.5614C11.2418 14.1014 10.2109 14.4205 9 14.4205C6.65591 14.4205 4.67182 12.8373 3.96409 10.71H0.957273V13.0418C2.43818 15.9832 5.48182 18 9 18Z" /><path d="M3.96409 10.71C3.78409 10.1741 3.68182 9.60136 3.68182 9C3.68182 8.39864 3.78409 7.82591 3.96409 7.29V4.95818H0.957273C0.347727 6.17318 0 7.54773 0 9C0 10.4523 0.347727 11.8268 0.957273 13.0418L3.96409 10.71Z" /><path d="M9 3.57955C10.3214 3.57955 11.5077 4.03364 12.4405 4.92545L15.0218 2.34409C13.4632 0.891818 11.4259 0 9 0C5.48182 0 2.43818 2.01682 0.957273 4.95818L3.96409 7.29C4.67182 5.16273 6.65591 3.57955 9 3.57955Z" /></svg>
                     <p className="text-xs text-white/60 leading-relaxed">User จะ login ด้วย <span className="text-white font-bold">Google</span> โดยใช้ email ที่ลงทะเบียนนี้</p>
                  </div>

                 <button 
                   onClick={handleCreateUser}
                   disabled={creating}
                   className="w-full bg-[#059669] hover:bg-[#047857] text-white rounded-xl py-3.5 text-sm font-extrabold shadow-xl shadow-emerald-900/20 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                 >
                   {creating ? "Creating user..." : "Create user"}
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
