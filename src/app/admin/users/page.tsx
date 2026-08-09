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
  st_files: boolean;
  rv: boolean;
  bcp: boolean;
  admin: boolean;
  restricted_properties: string[] | null;
}

const MENU_ITEMS: { key: keyof Omit<RolePermissionRow, "role" | "restricted_properties">; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "data_mart", label: "Data Mart" },
  { key: "bills", label: "Bills" },
  { key: "rr3", label: "RR3" },
  { key: "st_files", label: "Statistic Files" },
  { key: "rv", label: "Revenue Files" },
  { key: "bcp", label: "BCP" },
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
  const [roleSearchQuery, setRoleSearchQuery] = useState("");
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false);
  const [renamingRole, setRenamingRole] = useState<RolePermissionRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deletingRole, setDeletingRole] = useState<RolePermissionRow | null>(null);
  const [deletingRoleBusy, setDeletingRoleBusy] = useState(false);
  const [properties, setProperties] = useState<string[]>([]);
  const [openPropertyMenu, setOpenPropertyMenu] = useState<string | null>(null);
  const [openRoleActionMenu, setOpenRoleActionMenu] = useState<string | null>(null);


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
        role: name, dashboard: true, data_mart: false, bills: false, rr3: false, st_files: false, rv: false, bcp: false, admin: false, restricted_properties: null,
      };
      const { error } = await supabase.from("role_permissions").insert(newRow);
      if (error) {
        alert("Error creating role: " + error.message);
      } else {
        setNewRoleName("");
        setShowCreateRoleModal(false);
        fetchRolePermissions();
      }
    } finally {
      setAddingRole(false);
    }
  };

  const handleTogglePermission = async (role: string, key: keyof Omit<RolePermissionRow, "role" | "restricted_property">) => {
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

  const saveRestrictedProperties = async (role: string, nextValue: string[] | null) => {
    const current = rolePermissions.find((r) => r.role === role);
    if (!current) return;
    const previous = current.restricted_properties;

    // Optimistic update
    setRolePermissions((prev) => prev.map((r) => (r.role === role ? { ...r, restricted_properties: nextValue } : r)));

    const { error } = await supabase
      .from("role_permissions")
      .upsert({ ...current, restricted_properties: nextValue }, { onConflict: "role" });

    if (error) {
      console.error("Failed to update restricted_properties:", error.message);
      alert("Error saving property restriction: " + error.message);
      setRolePermissions((prev) => prev.map((r) => (r.role === role ? { ...r, restricted_properties: previous } : r)));
    }
  };

  const handleTogglePropertyRestriction = (role: string, propertyName: string) => {
    if (role === "Super Admin") return; // locked - always unrestricted
    const current = rolePermissions.find((r) => r.role === role);
    if (!current) return;
    const existing = current.restricted_properties || [];
    const nextList = existing.includes(propertyName)
      ? existing.filter((p) => p !== propertyName)
      : [...existing, propertyName];
    saveRestrictedProperties(role, nextList.length > 0 ? nextList : null);
  };

  const handleClearPropertyRestriction = (role: string) => {
    if (role === "Super Admin") return;
    saveRestrictedProperties(role, null);
  };

  const handleRenameRole = async () => {
    if (!renamingRole) return;
    const newName = renameValue.trim();
    if (!newName) return;
    if (newName === renamingRole.role) {
      setRenamingRole(null);
      return;
    }
    if (rolePermissions.some((r) => r.role.toLowerCase() === newName.toLowerCase())) {
      alert(`Role "${newName}" already exists`);
      return;
    }
    setRenaming(true);
    try {
      // role is the primary key on role_permissions - update it in place, then
      // cascade the rename to every profiles row still carrying the old name
      // so those users' access keeps resolving correctly under the new label.
      const { error: permError } = await supabase
        .from("role_permissions")
        .update({ role: newName })
        .eq("role", renamingRole.role);
      if (permError) {
        alert("Error renaming role: " + permError.message);
        return;
      }
      const { error: usersError } = await supabase
        .from("profiles")
        .update({ role: newName })
        .eq("role", renamingRole.role);
      if (usersError) {
        alert(`Role renamed, but failed to update assigned users: ${usersError.message}`);
      }
      setRenamingRole(null);
      fetchRolePermissions();
      fetchUsers();
    } finally {
      setRenaming(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!deletingRole) return;
    const assignedCount = users.filter((u) => u.role === deletingRole.role).length;
    if (assignedCount > 0) {
      alert(`Cannot delete "${deletingRole.role}" - ${assignedCount} user(s) are still assigned to this role. Reassign them first.`);
      setDeletingRole(null);
      return;
    }
    setDeletingRoleBusy(true);
    try {
      const { error } = await supabase.from("role_permissions").delete().eq("role", deletingRole.role);
      if (error) {
        alert("Error deleting role: " + error.message);
      } else {
        setDeletingRole(null);
        fetchRolePermissions();
      }
    } finally {
      setDeletingRoleBusy(false);
    }
  };

  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserProfile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", role: "User", full_name: "", auth_method: "google" });
  const [creating, setCreating] = useState(false);
  const [approvingUser, setApprovingUser] = useState<UserProfile | null>(null);
  const [approveRole, setApproveRole] = useState("User");
  const [approving, setApproving] = useState(false);
  const [openUserMenuId, setOpenUserMenuId] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
    fetchRolePermissions();
    supabase.from("property_api_settings").select("property_name").order("property_name").then(({ data }) => {
      if (data) setProperties(data.map((p) => p.property_name));
    });
  }, []);

  useEffect(() => {
    if (!openUserMenuId) return;
    const closeMenu = () => setOpenUserMenuId(null);
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, [openUserMenuId]);

  useEffect(() => {
    if (!openPropertyMenu) return;
    const closeMenu = () => setOpenPropertyMenu(null);
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, [openPropertyMenu]);

  useEffect(() => {
    if (!openRoleActionMenu) return;
    const closeMenu = () => setOpenRoleActionMenu(null);
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, [openRoleActionMenu]);

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
        setNewUser({ email: "", role: "User", full_name: "", auth_method: "google" });
        fetchUsers();
        if (!result.email_sent) {
          alert(
            `User created, but the welcome email failed to send: ${result.email_error || "unknown error"}. ` +
            (result.password
              ? `Share this password with them directly: ${result.password}`
              : `Please share the password with them directly.`)
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

  const handleDelete = async () => {
    if (!deletingUser) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${deletingUser.id}`, { method: "DELETE" });
      const result = await res.json();
      if (result.status === "success") {
        setUsers(users.filter(u => u.id !== deletingUser.id));
        setDeletingUser(null);
      } else {
        alert("Error deleting user: " + (result.detail || result.message));
      }
    } catch (err: any) {
      alert("Failed to connect to backend");
    }
    setDeleting(false);
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

  const filteredRolePermissions = rolePermissions.filter(r =>
    r.role.toLowerCase().includes(roleSearchQuery.toLowerCase())
  );

  return (
    <div className="p-6 bg-white min-h-screen text-slate-900 font-sans relative">
      <PageHeader
        title="User Management"
        description="Welcome back, Managing system as Super_admin."
      >
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
            Role
          </button>
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
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-[#AAA024] text-white rounded-xl text-xs font-bold hover:bg-[#8f871e] transition-all whitespace-nowrap"
              >
                + Create New User
              </button>
           </div>
        </div>

        {/* Table */}
        <div className="max-h-[65vh] overflow-y-auto overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="sticky top-0 z-10 bg-slate-50 px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Name</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Role</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Last Log-in</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="py-20 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#AAA024] mx-auto"></div></td></tr>
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
                  <td className="px-6 py-5 text-center relative overflow-visible">
                     <button
                       onClick={(e) => { e.stopPropagation(); setOpenUserMenuId(openUserMenuId === user.id ? null : user.id); }}
                       className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-all"
                     >
                       Action
                       <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                     </button>

                     {/* Action Dropdown Menu */}
                     {openUserMenuId === user.id && (
                       <div
                         onClick={(e) => e.stopPropagation()}
                         className="absolute right-0 top-12 w-48 bg-white border border-slate-200 rounded-2xl shadow-xl z-[100] animate-in fade-in zoom-in-95 duration-100 p-1.5"
                       >
                          {user.status === 'Pending' && (
                            <button
                              onClick={() => { setApprovingUser(user); setApproveRole("User"); setOpenUserMenuId(null); }}
                              className="w-full text-left px-3 py-2 text-xs font-bold text-[#AAA024] hover:bg-[#AAA024]/10 rounded-xl transition-colors flex items-center gap-2"
                            >
                              <svg className="w-4 h-4 text-[#AAA024]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              Approve
                            </button>
                          )}
                          <button
                            onClick={() => { setEditingUser(user); setOpenUserMenuId(null); }}
                            className="w-full text-left px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 rounded-xl transition-colors flex items-center gap-2"
                          >
                            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            Edit Profile
                          </button>
                          <button
                            onClick={() => { setDeletingUser(user); setOpenUserMenuId(null); }}
                            className="w-full text-left px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 rounded-xl transition-colors flex items-center gap-2"
                          >
                            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            Delete Account
                          </button>
                       </div>
                     )}
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
          <div className="p-4 flex flex-col md:flex-row gap-4 items-center justify-between border-b border-slate-100">
             <div className="relative w-full md:w-96">
                <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input
                  type="text"
                  placeholder="Search roles..."
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/10 transition-all font-medium text-slate-900"
                  value={roleSearchQuery}
                  onChange={(e) => setRoleSearchQuery(e.target.value)}
                />
             </div>
             <div className="flex gap-2">
                <button
                  onClick={fetchRolePermissions}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  Refresh
                </button>
                <button
                  onClick={() => setShowCreateRoleModal(true)}
                  className="px-4 py-2 bg-[#AAA024] text-white rounded-xl text-xs font-bold hover:bg-[#8f871e] transition-all whitespace-nowrap"
                >
                  + Create Role
                </button>
             </div>
          </div>
          <div className="max-h-[65vh] overflow-y-auto overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="sticky top-0 z-10 bg-slate-50 px-4 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest min-w-[200px]">Role</th>
                  {MENU_ITEMS.map((item) => (
                    <th key={item.key} className="sticky top-0 z-10 bg-slate-50 px-2 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">{item.label}</th>
                  ))}
                  <th className="sticky top-0 z-10 bg-slate-50 px-3 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Property</th>
                  <th className="sticky top-0 z-10 bg-slate-50 px-3 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingRoles ? (
                  <tr><td colSpan={MENU_ITEMS.length + 3} className="py-20 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#AAA024] mx-auto"></div></td></tr>
                ) : filteredRolePermissions.length === 0 ? (
                  <tr><td colSpan={MENU_ITEMS.length + 3} className="py-20 text-center text-slate-400 text-sm">No roles match &quot;{roleSearchQuery}&quot;.</td></tr>
                ) : filteredRolePermissions.map((row) => {
                  const isLocked = row.role === "Super Admin";
                  return (
                    <tr key={row.role} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-5 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-2 pl-2.5 pr-3.5 py-1.5 rounded-full text-[11px] font-bold border shadow-sm whitespace-nowrap ${
                          row.role === 'Super Admin'
                          ? 'bg-[#AAA024]/10 text-[#AAA024] border-[#AAA024]/20'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.role === 'Super Admin' ? 'bg-[#AAA024]' : 'bg-slate-400'}`} />
                          {row.role}
                        </span>
                      </td>
                      {MENU_ITEMS.map((item) => (
                        <td key={item.key} className="px-2 py-5 text-center">
                          <input
                            type="checkbox"
                            checked={isLocked ? true : row[item.key]}
                            disabled={isLocked}
                            onChange={() => handleTogglePermission(row.role, item.key)}
                            className={`w-4 h-4 accent-[#AAA024] ${isLocked ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                          />
                        </td>
                      ))}
                      <td className="px-3 py-5 relative overflow-visible">
                        {(() => {
                          const selected = row.restricted_properties || [];
                          const summary =
                            selected.length === 0 ? "All Properties" :
                            selected.length === 1 ? selected[0] :
                            `${selected.length} Properties`;
                          return (
                            <div className="relative inline-block">
                              <button
                                type="button"
                                disabled={isLocked}
                                onClick={(e) => { e.stopPropagation(); setOpenPropertyMenu(openPropertyMenu === row.role ? null : row.role); }}
                                className={`flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 outline-none min-w-[140px] justify-between ${isLocked ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-slate-100"}`}
                              >
                                <span className="truncate">{summary}</span>
                                <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                              </button>
                              {!isLocked && openPropertyMenu === row.role && (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute left-0 top-9 w-56 bg-white border border-slate-200 rounded-2xl shadow-xl z-[100] p-2 animate-in fade-in zoom-in-95 duration-100"
                                >
                                  <button
                                    onClick={() => handleClearPropertyRestriction(row.role)}
                                    className="w-full text-left px-3 py-2 text-xs font-bold text-[#AAA024] hover:bg-[#AAA024]/10 rounded-xl transition-colors mb-1"
                                  >
                                    All Properties (clear)
                                  </button>
                                  <div className="max-h-56 overflow-y-auto">
                                    {properties.map((p) => (
                                      <label key={p} className="flex items-center gap-2 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 rounded-xl cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={selected.includes(p)}
                                          onChange={() => handleTogglePropertyRestriction(row.role, p)}
                                          className="w-3.5 h-3.5 accent-[#AAA024] cursor-pointer"
                                        />
                                        <span className="truncate">{p}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-5 text-center relative overflow-visible">
                        {isLocked ? (
                          <span className="text-slate-300 text-xs">—</span>
                        ) : (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); setOpenRoleActionMenu(openRoleActionMenu === row.role ? null : row.role); }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-all"
                            >
                              Action
                              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </button>
                            {openRoleActionMenu === row.role && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 top-12 w-40 bg-white border border-slate-200 rounded-2xl shadow-xl z-[100] animate-in fade-in zoom-in-95 duration-100 p-1.5"
                              >
                                <button
                                  onClick={() => { setRenamingRole(row); setRenameValue(row.role); setOpenRoleActionMenu(null); }}
                                  className="w-full text-left px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 rounded-xl transition-colors flex items-center gap-2"
                                >
                                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                  Rename
                                </button>
                                <button
                                  onClick={() => { setDeletingRole(row); setOpenRoleActionMenu(null); }}
                                  className="w-full text-left px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 rounded-xl transition-colors flex items-center gap-2"
                                >
                                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                  Delete
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </td>
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
                 <h2 className="text-xl font-bold text-slate-800">Detail Profile</h2>
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

                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                       <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Join Date</label>
                       <div className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-500">
                         {new Date(editingUser.created_at || editingUser.joined_at).toLocaleDateString()}
                       </div>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Last Login</label>
                       <div className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-500">
                         {editingUser.last_login ? new Date(editingUser.last_login).toLocaleString() : "Never"}
                       </div>
                    </div>
                 </div>

                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                          <option value="Pending">Pending</option>
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

      {/* Delete Confirmation Modal */}
      {deletingUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
           <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-slate-200">
              <div className="p-6">
                 <div className="w-12 h-12 rounded-full bg-[#AAA024]/10 flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-[#AAA024]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                 </div>
                 <h2 className="text-xl font-bold text-slate-800 mb-2">Delete Account</h2>
                 <p className="text-sm text-slate-500 mb-6">
                   Are you sure you want to delete <span className="font-bold text-slate-700">{deletingUser.email}</span>? This action cannot be undone.
                 </p>
                 <div className="flex gap-3">
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex-1 bg-[#AAA024] text-white rounded-xl py-2.5 text-sm font-bold shadow-lg shadow-[#AAA024]/20 hover:bg-[#8f871e] transition-all disabled:opacity-50"
                    >
                      {deleting ? "Deleting..." : "Delete"}
                    </button>
                    <button
                      onClick={() => setDeletingUser(null)}
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

      {/* Create Role Modal */}
      {showCreateRoleModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
           <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-slate-200">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                 <h2 className="text-xl font-bold text-slate-800">Create Role</h2>
                 <button onClick={() => { setShowCreateRoleModal(false); setNewRoleName(""); }} className="text-slate-400 hover:text-slate-600">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
              </div>

              <div className="p-6 space-y-6">
                 <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Role Name</label>
                    <input
                      type="text"
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddRole(); }}
                      placeholder="e.g. Housekeeping"
                      autoFocus
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                    />
                 </div>

                 <div className="pt-4 flex gap-3">
                    <button
                      onClick={handleAddRole}
                      disabled={addingRole || !newRoleName.trim()}
                      className="flex-1 bg-[#AAA024] text-white rounded-xl py-2.5 text-sm font-bold shadow-lg shadow-[#AAA024]/20 hover:bg-[#8f871e] transition-all disabled:opacity-50"
                    >
                      {addingRole ? "Creating..." : "Create Role"}
                    </button>
                    <button
                      onClick={() => { setShowCreateRoleModal(false); setNewRoleName(""); }}
                      className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5 text-sm font-bold hover:bg-slate-200 transition-all"
                    >
                      Cancel
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Rename Role Modal */}
      {renamingRole && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
           <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-slate-200">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                 <h2 className="text-xl font-bold text-slate-800">Rename Role</h2>
                 <button onClick={() => setRenamingRole(null)} className="text-slate-400 hover:text-slate-600">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
              </div>

              <div className="p-6 space-y-6">
                 <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Role Name</label>
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleRenameRole(); }}
                      autoFocus
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                    />
                    <p className="text-xs text-slate-400 px-1 pt-1">Users currently assigned &quot;{renamingRole.role}&quot; will be updated to the new name automatically.</p>
                 </div>

                 <div className="pt-4 flex gap-3">
                    <button
                      onClick={handleRenameRole}
                      disabled={renaming || !renameValue.trim()}
                      className="flex-1 bg-[#AAA024] text-white rounded-xl py-2.5 text-sm font-bold shadow-lg shadow-[#AAA024]/20 hover:bg-[#8f871e] transition-all disabled:opacity-50"
                    >
                      {renaming ? "Renaming..." : "Rename Role"}
                    </button>
                    <button
                      onClick={() => setRenamingRole(null)}
                      className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5 text-sm font-bold hover:bg-slate-200 transition-all"
                    >
                      Cancel
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Delete Role Confirmation Modal */}
      {deletingRole && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
           <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-slate-200">
              <div className="p-6">
                 <div className="w-12 h-12 rounded-full bg-[#AAA024]/10 flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-[#AAA024]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                 </div>
                 <h2 className="text-xl font-bold text-slate-800 mb-2">Delete Role</h2>
                 <p className="text-sm text-slate-500 mb-6">
                   Are you sure you want to delete <span className="font-bold text-slate-700">{deletingRole.role}</span>? This action cannot be undone. Roles still assigned to users can&apos;t be deleted.
                 </p>
                 <div className="flex gap-3">
                    <button
                      onClick={handleDeleteRole}
                      disabled={deletingRoleBusy}
                      className="flex-1 bg-[#AAA024] text-white rounded-xl py-2.5 text-sm font-bold shadow-lg shadow-[#AAA024]/20 hover:bg-[#8f871e] transition-all disabled:opacity-50"
                    >
                      {deletingRoleBusy ? "Deleting..." : "Delete"}
                    </button>
                    <button
                      onClick={() => setDeletingRole(null)}
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
                    <div className="relative">
                      <select
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 pr-10 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#AAA024]/40 appearance-none cursor-pointer transition-all"
                        value={newUser.role}
                        onChange={(e) => setNewUser({...newUser, role: e.target.value})}
                      >
                         {rolePermissions.map((r) => (
                           <option key={r.role} value={r.role} className="bg-[#1a1a1a]">{r.role}</option>
                         ))}
                      </select>
                      <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </div>
                 </div>

                  <div className="space-y-2">
                     <label className="text-xs font-bold text-white/60 ml-1">User Authentication</label>
                     <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setNewUser({ ...newUser, auth_method: "google" })}
                          className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${
                            newUser.auth_method === "google"
                              ? "bg-[#AAA024]/10 border-[#AAA024]/50 ring-1 ring-[#AAA024]/40"
                              : "bg-white/5 border-white/10 hover:border-white/20"
                          }`}
                        >
                           <svg className="w-4 h-4 shrink-0" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.20455C17.64 8.56636 17.5827 7.95273 17.4764 7.36364H9V10.845H13.8436C13.635 11.97 13.0009 12.9232 12.0477 13.5614V15.8195H14.9564C16.6582 14.2527 17.64 11.9455 17.64 9.20455Z" /><path fill="#34A853" d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.8195L12.0477 13.5614C11.2418 14.1014 10.2109 14.4205 9 14.4205C6.65591 14.4205 4.67182 12.8373 3.96409 10.71H0.957273V13.0418C2.43818 15.9832 5.48182 18 9 18Z" /><path fill="#FBBC05" d="M3.96409 10.71C3.78409 10.1741 3.68182 9.60136 3.68182 9C3.68182 8.39864 3.78409 7.82591 3.96409 7.29V4.95818H0.957273C0.347727 6.17318 0 7.54773 0 9C0 10.4523 0.347727 11.8268 0.957273 13.0418L3.96409 10.71Z" /><path fill="#EA4335" d="M9 3.57955C10.3214 3.57955 11.5077 4.03364 12.4405 4.92545L15.0218 2.34409C13.4632 0.891818 11.4259 0 9 0C5.48182 0 2.43818 2.01682 0.957273 4.95818L3.96409 7.29C4.67182 5.16273 6.65591 3.57955 9 3.57955Z" /></svg>
                           <div>
                              <p className="text-xs font-bold text-white leading-tight">Google</p>
                              <p className="text-[10px] text-white/40 leading-tight">Authentication</p>
                           </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewUser({ ...newUser, auth_method: "internal" })}
                          className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${
                            newUser.auth_method === "internal"
                              ? "bg-[#AAA024]/10 border-[#AAA024]/50 ring-1 ring-[#AAA024]/40"
                              : "bg-white/5 border-white/10 hover:border-white/20"
                          }`}
                        >
                           <svg className="w-4 h-4 shrink-0 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                           <div>
                              <p className="text-xs font-bold text-white leading-tight">Internal</p>
                              <p className="text-[10px] text-white/40 leading-tight">Users</p>
                           </div>
                        </button>
                     </div>
                     <p className="text-[11px] text-white/40 leading-relaxed px-1">
                        {newUser.auth_method === "google"
                          ? <>User signs in with <span className="text-white/70 font-bold">Continue with Google</span> using this email address.</>
                          : <>A password is generated and emailed to this address. User signs in via <span className="text-white/70 font-bold">Internal Users</span> on the login page.</>}
                     </p>
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
