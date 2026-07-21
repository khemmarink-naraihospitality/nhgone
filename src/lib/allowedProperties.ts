import { supabase } from "@/lib/supabase";

/**
 * Resolves which properties the signed-in user is allowed to see in a
 * "Select Property" dropdown, and whether that list is locked down.
 *
 * Super Admin (or any role with no restricted_properties set on
 * role_permissions - the default, unrestricted case) sees every property.
 * A role with restricted_properties set only ever sees that subset -
 * used for property-level staff (e.g. "Lub d Bangkok Siam Front Office")
 * who should never be able to pick another hotel's data out of the dropdown.
 */
export async function getAllowedProperties(): Promise<{ properties: string[]; restricted: boolean }> {
  const all = async (): Promise<{ properties: string[]; restricted: boolean }> => {
    const { data } = await supabase.from("property_api_settings").select("property_name").order("property_name");
    return { properties: (data || []).map((p) => p.property_name), restricted: false };
  };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return all();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const role = profile?.role;
  if (!role || role === "Super Admin" || role === "super_admin") return all();

  const { data: permRow } = await supabase
    .from("role_permissions")
    .select("restricted_properties")
    .eq("role", role)
    .single();

  const restrictedProperties: string[] = permRow?.restricted_properties || [];
  if (restrictedProperties.length === 0) return all();

  return { properties: restrictedProperties, restricted: true };
}
