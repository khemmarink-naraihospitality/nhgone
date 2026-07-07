"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
}

export default function ProfilePage() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchProfile = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);
    if (user) {
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (data) {
        setProfile(data);
        setNameInput(data.full_name || "");
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleSaveName = async () => {
    if (!user || !nameInput.trim()) return;
    setSavingName(true);
    try {
      const { error } = await supabase.from("profiles").update({ full_name: nameInput.trim() }).eq("id", user.id);
      if (error) throw error;
      setProfile((p) => (p ? { ...p, full_name: nameInput.trim() } : p));
      setEditingName(false);
    } catch (err: any) {
      alert("Error saving name: " + err.message);
    } finally {
      setSavingName(false);
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file");
      return;
    }
    setUploadingPhoto(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${user.id}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_url: publicUrl } });
      if (updateError) throw updateError;

      const { data: { user: refreshedUser } } = await supabase.auth.getUser();
      setUser(refreshedUser);
    } catch (err: any) {
      alert("Error uploading photo: " + err.message);
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#AAA024]"></div>
      </div>
    );
  }

  const avatarUrl = user?.user_metadata?.avatar_url;
  const initials = (profile?.full_name || user?.email || "U")
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight mb-2">
            Your Profile
          </h1>
          <p className="text-slate-500 font-medium">Manage your account settings</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-8 max-w-2xl">
        <div className="flex items-center gap-6 mb-8 pb-8 border-b border-slate-100">
          <div className="relative group">
            <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-blue-500 to-emerald-500 flex items-center justify-center text-2xl font-bold text-white uppercase shadow-inner overflow-hidden">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#AAA024] text-white flex items-center justify-center shadow-md hover:bg-[#8f871e] transition-all disabled:opacity-50"
              title="Change photo"
            >
              {uploadingPhoto ? (
                <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
          </div>
          <div className="flex-1">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="text-xl font-semibold text-slate-800 border border-slate-200 rounded-lg px-3 py-1 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                />
                <button onClick={handleSaveName} disabled={savingName} className="px-3 py-1.5 bg-[#AAA024] text-white rounded-lg text-sm font-bold disabled:opacity-50">
                  {savingName ? "..." : "Save"}
                </button>
                <button
                  onClick={() => { setEditingName(false); setNameInput(profile?.full_name || ""); }}
                  className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-sm font-bold"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-slate-800">{profile?.full_name || "Unnamed User"}</h2>
                <button onClick={() => setEditingName(true)} className="text-slate-400 hover:text-[#AAA024] transition-colors" title="Edit name">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              </div>
            )}
            <p className="text-slate-500">{profile?.email || user?.email}</p>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Account Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-xs text-slate-500 font-medium mb-1">Role</p>
                <p className="text-sm font-semibold text-slate-800">{profile?.role || "-"}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-xs text-slate-500 font-medium mb-1">Status</p>
                <p className={`text-sm font-semibold ${profile?.status === "Active" ? "text-emerald-600" : "text-slate-500"}`}>
                  {profile?.status || "-"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
