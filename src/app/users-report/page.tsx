"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";

// Read-only twin of Admin > User Management's Users tab, as its own main
// menu (role_permissions.users_report) so it can be granted to roles that
// must not have the Admin menu - which would otherwise hand them create,
// edit, delete, approve, and every other admin page along with it.
//
// Same columns, same styling, same search/sort/export. What is deliberately
// absent: "+ Create New User", the per-row Action menu (Approve / Edit
// Profile / Delete Account), and every modal behind them. Nothing on this
// page writes.

interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  role: string;
  status: "Active" | "Inactive" | "Pending";
  // Same two corrections Admin > User Management applies on read, kept
  // identical here so the two screens can never disagree about a user:
  // last_login comes from Supabase Auth's real last_sign_in_at (the profiles
  // column of that name only ever holds account-creation time), and is
  // blanked back to "Never" when the only sign-in on record predates
  // approved_at - a self-registered user's first Google handshake is a real
  // Auth sign-in even though the Pending gate blocked them from the app.
  last_login: string;
  // Shows approved_at when present, so "Create Time" is when the account
  // actually became usable rather than when a Pending signup was attempted.
  created_at?: string;
  approved_at?: string | null;
  auth_method?: "google" | "internal";
  must_change_password?: boolean;
  created_by?: string | null;
}

type SortKey = "full_name" | "email" | "role" | "auth_method" | "status" | "last_login" | "created_at" | "created_by";

const USER_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "full_name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "role", label: "Role" },
  { key: "auth_method", label: "User Authentication" },
  { key: "status", label: "Status" },
  { key: "last_login", label: "Last Log-in" },
  { key: "created_at", label: "Create Time" },
  { key: "created_by", label: "Created By" },
];

export default function UsersReportPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // Which properties the VIEWER is limited to, and role -> properties for
  // everyone else. profiles has no property column at all - a user's
  // property is only ever implied by their role - so the whole filter is
  // resolved through role_permissions.restricted_properties.
  const [myProperties, setMyProperties] = useState<string[]>([]);
  const [propertiesByRole, setPropertiesByRole] = useState<Record<string, string[]>>({});

  // showSpinner=false on first mount: `loading` already starts true, so
  // setting it again would be a synchronous setState inside the effect (the
  // body of an async function runs synchronously up to its first await) for
  // no visible change. Refresh passes the default and does want the spinner.
  const fetchUsers = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    const [{ data, error }, lastLoginsRes] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      // Best-effort - a failed fetch here just means Last Log-in falls back
      // to profiles.last_login (creation time) for this load, not a broken page.
      fetch("/api/admin/users/last-logins").then((r) => r.json()).catch(() => null),
    ]);

    if (error) {
      console.error("Failed to fetch profiles:", error.message);
      alert("Error fetching users: " + error.message);
    } else {
      const lastLogins: Record<string, string | null> = lastLoginsRes?.status === "success" ? lastLoginsRes.data : {};
      setUsers(
        (data as UserProfile[]).map((u) => {
          const rawLastLogin = u.id in lastLogins ? (lastLogins[u.id] || "") : u.last_login;
          const approvedAt = u.approved_at || null;
          const preApproval = !!(approvedAt && rawLastLogin && new Date(rawLastLogin).getTime() < new Date(approvedAt).getTime());
          return { ...u, last_login: preApproval ? "" : rawLastLogin, created_at: approvedAt || u.created_at };
        })
      );
    }
    setLoading(false);
  };

  // Resolved once on mount, alongside the user list. Super Admin - and any
  // role with no restricted_properties - stays unrestricted, matching
  // src/lib/allowedProperties.ts exactly so the property dropdowns elsewhere
  // and this list can never disagree about who is scoped to what.
  const fetchScope = async () => {
    const { data: roleRows } = await supabase
      .from("role_permissions")
      .select("role, restricted_properties");
    const map: Record<string, string[]> = {};
    for (const r of roleRows || []) map[r.role] = r.restricted_properties || [];
    setPropertiesByRole(map);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    const role = profile?.role;
    if (!role || role === "Super Admin" || role === "super_admin") return;
    setMyProperties(map[role] || []);
  };

  useEffect(() => {
    // The rule can't see that fetchUsers(false) reaches no setState before
    // its first await, so it flags the call itself. Nothing here renders
    // twice: `loading` already starts true, which is exactly why the initial
    // load passes false.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchUsers(false);
    fetchScope();
  }, []);

  const isRestricted = myProperties.length > 0;

  // A restricted viewer sees only users whose own role is scoped to at least
  // one of the same properties. A role with NO restriction (Super Admin, and
  // head-office roles like IT BO / Revenue BO) has an empty list, so `.some`
  // is false and they stay hidden - deliberate: those accounts belong to
  // no single property, and a property-level viewer has no reason to see them.
  const visibleUsers = isRestricted
    ? users.filter((u) => (propertiesByRole[u.role] || []).some((p) => myProperties.includes(p)))
    : users;

  const filteredUsers = visibleUsers.filter(
    (u) =>
      u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Narrow first, then order what's left - and the export reads from this,
  // so an active search and sort order both carry into the download.
  const sortedUsers = sortKey
    ? [...filteredUsers].sort((a, b) => {
        let cmp: number;
        if (sortKey === "last_login" || sortKey === "created_at") {
          const av = a[sortKey] ? new Date(a[sortKey] as string).getTime() : 0;
          const bv = b[sortKey] ? new Date(b[sortKey] as string).getTime() : 0;
          cmp = av - bv;
        } else {
          cmp = (a[sortKey] || "").toString().localeCompare((b[sortKey] || "").toString());
        }
        return sortDir === "asc" ? cmp : -cmp;
      })
    : filteredUsers;

  // Auth method and status are written as their display labels rather than
  // the raw enum, to match what is actually on screen.
  const handleExportUsers = () => {
    const rows = sortedUsers.map((u) => ({
      [USER_COLUMNS[0].label]: u.full_name,
      [USER_COLUMNS[1].label]: u.email,
      [USER_COLUMNS[2].label]: u.role,
      [USER_COLUMNS[3].label]: (u.auth_method || "google") === "internal" ? "Internal" : "Google",
      [USER_COLUMNS[4].label]: u.status === "Pending" ? "Waiting for approve" : u.status,
      [USER_COLUMNS[5].label]: u.last_login ? new Date(u.last_login).toLocaleString() : "Never",
      [USER_COLUMNS[6].label]: u.created_at ? new Date(u.created_at).toLocaleString() : "",
      [USER_COLUMNS[7].label]: u.created_by || "",
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Users");
    XLSX.writeFile(workbook, `NHGOne_Users_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="p-6 bg-white min-h-screen text-slate-900 font-sans">
      <PageHeader
        title="Users Report"
        description="Every NHGOne account, its role and its sign-in history. View only - changes are made in Admin > User Management."
      />

      {isRestricted && (
        // Without this, a colleague who is simply out of scope reads as a
        // missing account rather than a filtered one.
        <div className="mt-6 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-600">
          Showing accounts for <span className="font-bold text-slate-800">{myProperties.join(", ")}</span> only.
          Users from other properties, and head-office accounts that belong to no single property, are not listed.
        </div>
      )}

      <div className="mt-6 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-6">
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
              onClick={() => fetchUsers()}
              className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              Refresh
            </button>
            <button
              onClick={handleExportUsers}
              disabled={sortedUsers.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
              Export Users
            </button>
          </div>
        </div>

        <div className="max-h-[65vh] overflow-y-auto overflow-x-auto overscroll-contain">
          <table className="w-full text-left border-separate border-spacing-0">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                {USER_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="group sticky top-0 z-10 bg-slate-50 px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest cursor-pointer select-none hover:text-slate-600 transition-colors"
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      <svg
                        className={`w-3 h-3 shrink-0 transition-all ${sortKey === col.key ? "opacity-100 text-[#AAA024]" : "opacity-0 group-hover:opacity-30"} ${sortKey === col.key && sortDir === "desc" ? "rotate-180" : ""}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                      </svg>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={USER_COLUMNS.length} className="py-20 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#AAA024] mx-auto"></div></td></tr>
              ) : sortedUsers.length === 0 ? (
                <tr><td colSpan={USER_COLUMNS.length} className="py-20 text-center text-slate-400 text-sm">
                  {searchQuery ? `No user matches "${searchQuery}".` : "No users yet."}
                </td></tr>
              ) : sortedUsers.map((user) => (
                <tr key={user.id} className={`hover:bg-slate-50/50 transition-colors ${user.status === "Pending" ? "bg-amber-50/50" : ""}`}>
                  <td className="px-6 py-5 text-sm font-bold text-slate-700">{user.full_name}</td>
                  <td className="px-6 py-5 text-sm text-[#AAA024] font-medium">{user.email}</td>
                  <td className="px-6 py-5">
                    <span className={`px-3 py-1 rounded-full text-[11px] font-bold border ${
                      user.role === "Super Admin"
                        ? "bg-[#AAA024]/10 text-[#AAA024] border-[#AAA024]/20"
                        : "bg-slate-100 text-slate-600 border-slate-200"
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-5">
                    {(user.auth_method || "google") === "internal" ? (
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                          <svg className="w-3 h-3 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                          Internal
                        </span>
                        {user.must_change_password && (
                          <span
                            title="Still signing in with the emailed password - hasn't set their own yet"
                            className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                          />
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                        <svg className="w-3 h-3 shrink-0" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.20455C17.64 8.56636 17.5827 7.95273 17.4764 7.36364H9V10.845H13.8436C13.635 11.97 13.0009 12.9232 12.0477 13.5614V15.8195H14.9564C16.6582 14.2527 17.64 11.9455 17.64 9.20455Z" /><path fill="#34A853" d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.8195L12.0477 13.5614C11.2418 14.1014 10.2109 14.4205 9 14.4205C6.65591 14.4205 4.67182 12.8373 3.96409 10.71H0.957273V13.0418C2.43818 15.9832 5.48182 18 9 18Z" /><path fill="#FBBC05" d="M3.96409 10.71C3.78409 10.1741 3.68182 9.60136 3.68182 9C3.68182 8.39864 3.78409 7.82591 3.96409 7.29V4.95818H0.957273C0.347727 6.17318 0 7.54773 0 9C0 10.4523 0.347727 11.8268 0.957273 13.0418L3.96409 10.71Z" /><path fill="#EA4335" d="M9 3.57955C10.3214 3.57955 11.5077 4.03364 12.4405 4.92545L15.0218 2.34409C13.4632 0.891818 11.4259 0 9 0C5.48182 0 2.43818 2.01682 0.957273 4.95818L3.96409 7.29C4.67182 5.16273 6.65591 3.57955 9 3.57955Z" /></svg>
                        Google
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${user.status === "Active" ? "bg-emerald-500" : user.status === "Pending" ? "bg-amber-500" : "bg-slate-300"}`}></div>
                      <span className={`${user.status === "Active" ? "text-emerald-600" : user.status === "Pending" ? "text-amber-600" : "text-slate-500"} text-[11px] font-bold`}>
                        {user.status === "Pending" ? "Waiting for approve" : user.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-5 text-xs text-slate-500 font-medium">
                    {user.last_login ? new Date(user.last_login).toLocaleString() : "Never"}
                  </td>
                  <td className="px-6 py-5 text-xs text-slate-500 font-medium">
                    {user.created_at ? new Date(user.created_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-6 py-5 text-xs text-slate-500 font-medium">
                    {user.created_by || <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && (
          <div className="p-4 border-t border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            {sortedUsers.length} of {visibleUsers.length} user{visibleUsers.length === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </div>
  );
}
