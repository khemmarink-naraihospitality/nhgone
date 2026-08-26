import { supabase } from "@/lib/supabase";

export interface MenuPermissions {
  dashboard: boolean;
  data_mart: boolean;
  bills: boolean;
  rr3: boolean;
  st_files: boolean;
  revenue: boolean;
  rv: boolean;
  bcp: boolean;
  rr4_tm30: boolean;
  reconciliation: boolean;
  users_report: boolean;
  admin: boolean;
}

/**
 * Resolves the signed-in user's menu permissions from role_permissions,
 * mirroring Navigation.tsx's sidebar resolution exactly - including its
 * "Finance = Bills only, everyone else = full menu" fallback for a
 * missing/unloaded row - so any page reading this sees the same set of
 * modules the sidebar itself would show for that role.
 */
export async function getMenuPermissions(): Promise<MenuPermissions> {
  const financeFallback = (isFinance: boolean): MenuPermissions => ({
    dashboard: !isFinance,
    data_mart: !isFinance,
    bills: true,
    rr3: !isFinance,
    st_files: !isFinance,
    revenue: !isFinance,
    rv: !isFinance,
    bcp: !isFinance,
    rr4_tm30: !isFinance,
    reconciliation: !isFinance,
    // Deliberately NOT !isFinance like the rest: the fallback exists so a
    // missing role_permissions row can't strand someone with an empty
    // sidebar, and a directory of every account's email and sign-in history
    // is not what anyone needs to be un-stranded. It appears only when the
    // role's real row says so.
    users_report: false,
    admin: false,
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return financeFallback(false);

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const role = profile?.role;
  if (!role) return financeFallback(false);

  const { data: permRow } = await supabase.from("role_permissions").select("*").eq("role", role).single();
  return (permRow as MenuPermissions | null) || financeFallback(role.toLowerCase() === "finance");
}
