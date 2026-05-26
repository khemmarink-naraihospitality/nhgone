"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

interface Stats {
  reservations: number;
  members: number;
  payments: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const apiUrl = "/api";
        const response = await fetch(`${apiUrl}/stats`);
        const result = await response.json();
        if (result.status === "success") {
          setStats(result.data);
        }
      } catch (err: any) {
        console.warn("Could not fetch dashboard stats. Backend might be offline:", err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  return (
    <div className="flex-1 p-8 bg-background text-foreground font-sans transition-colors duration-300">
      <div className="max-w-7xl mx-auto">
        <PageHeader 
          title={
            <>
              Welcome to <span className="text-narai-green font-display">NHGOne</span>
            </>
          } 
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          <StatCard title="Managed Reservations" value={stats?.reservations ?? 0} color="green" href="/data-mart" />
          <StatCard title="Chinatown Members" value={stats?.members ?? 0} color="lemongrass" href="/data-mart" />
          <StatCard title="Processed Payments" value={stats?.payments ?? 0} color="aubergine" href="/data-mart" />
        </div>

        <section className="bg-white/5 border border-white/10 rounded-sm p-8 backdrop-blur-xl transition-colors">
          <h2 className="text-2xl font-bold text-foreground mb-6 font-display">System Health</h2>
          <div className="flex items-center gap-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-sm w-fit">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-emerald-400 font-bold text-[10px] tracked-caps">FastAPI Backend: Online</span>
          </div>
          <div className="mt-8 text-slate-400 grid grid-cols-1 md:grid-cols-2 gap-8">
             <div>
                <h3 className="text-foreground font-bold mb-2 text-[11px] tracked-caps">Integration Strategy</h3>
                <p className="text-sm leading-relaxed opacity-80">Secure server-side token injection with POST-only pattern. No MEWS credentials are exposed to the browser.</p>
             </div>
             <div>
                <h3 className="text-foreground font-bold mb-2 text-[11px] tracked-caps">Sync Pattern</h3>
                <p className="text-sm leading-relaxed opacity-80">Local-first management layer in Supabase with RLS. Preserves enriched data while staying synced with PMS.</p>
             </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ title, value, color, href }: { title: string, value: number, color: string, href: string }) {
  const themes: Record<string, string> = {
    green: "bg-[#152A00] text-galangal border-white/5",
    lemongrass: "bg-[#AAA024] text-white border-white/5",
    aubergine: "bg-[#250719] text-galangal border-white/5"
  };

  return (
    <Link href={href} className={`block p-8 rounded-sm ${themes[color]} border transition-all h-full group hover:opacity-90 active:scale-[0.985]`}>
      <h3 className="font-bold mb-10 text-[11px] tracked-caps opacity-80">{title}</h3>
      <div className="text-6xl font-black mb-4 font-display leading-none">{value}</div>
      <div className="mt-4 text-[10px] tracked-caps opacity-60 group-hover:opacity-100 transition-opacity flex items-center gap-2">
        Manage Records 
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
      </div>
    </Link>
  );
}
