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
    <div className="flex-1 p-12 bg-[#FFEFD2] text-[#152A00] font-sans transition-colors duration-300">
      <div className="max-w-7xl mx-auto">
        <div className="mb-14">
          <PageHeader 
            title="Overview" 
            description="Operational synchronization status for Narai Hospitality Group."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-1px bg-[#152A00]/10 border border-[#152A00]/10 mb-14">
          <StatCard title="Total Reservations" value={stats?.reservations ?? 0} label="Database" href="/data-mart" />
          <StatCard title="Registered Members" value={stats?.members ?? 0} label="Chinatown" href="/data-mart" />
          <StatCard title="Payments Processed" value={stats?.payments ?? 0} label="Synced" href="/data-mart" />
        </div>

        <section className="bg-[#fffaf0] border border-[#152A00]/14 p-12 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-5 font-display text-8xl pointer-events-none">NHG</div>
          
          <h2 className="text-[10px] font-bold text-[#152A00]/60 mb-6 tracked-caps">Operational Health</h2>
          
          <div className="flex items-center gap-4 mb-10">
            <div className="h-2 w-2 rounded-full bg-emerald-600"></div>
            <span className="text-emerald-700 font-bold text-[13px] tracked-caps">FastAPI Backend: Synchronized</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 border-t border-[#152A00]/10 pt-10">
             <div>
                <h3 className="font-display text-2xl mb-4 text-[#152A00]">Strategic integration</h3>
                <p className="text-[13px] leading-relaxed opacity-80 max-w-sm">Secure server-side token injection with POST-only pattern. No MEWS credentials are exposed to the browser, ensuring absolute security for the Narai portfolio.</p>
             </div>
             <div>
                <h3 className="font-display text-2xl mb-4 text-[#152A00]">Synchronization pattern</h3>
                <p className="text-[13px] leading-relaxed opacity-80 max-w-sm">Local-first management layer in Supabase with RLS. Preserves enriched data while staying synced with PMS, building a lasting digital legacy.</p>
             </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ title, value, label, href }: { title: string, value: number, label: string, href: string }) {
  return (
    <Link href={href} className="bg-[#fffaf0] p-10 flex flex-col gap-2 transition-colors hover:bg-white group relative">
      <div className="text-[9px] font-bold text-[#152A00]/50 tracked-caps">{label}</div>
      <h3 className="font-display text-xl text-[#152A00] mb-6">{title}</h3>
      <div className="text-7xl font-display text-[#152A00] leading-none tracking-tighter">{value}</div>
      <div className="mt-8 text-[10px] font-bold tracked-caps text-[#152A00]/40 group-hover:text-[#152A00] transition-colors flex items-center gap-2">
        Manage <span className="text-[14px]">→</span>
      </div>
    </Link>
  );
}
