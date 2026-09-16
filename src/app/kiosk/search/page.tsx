"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { QrCode, Search, Keyboard } from "lucide-react";

export default function SearchReservationPage() {
  const router = useRouter();
  const [confNumber, setConfNumber] = useState("");
  const [lastName, setLastName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // TODO: Connect to Supabase
    setTimeout(() => {
      setIsLoading(false);
      router.push("/kiosk/registration");
    }, 1500);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="w-full h-full flex items-center justify-center pt-6"
    >
      <div className="flex flex-col md:flex-row gap-8 max-w-6xl w-full px-4">
        {/* Left Column: Manual Entry */}
        <div className="flex-1 glass p-10 md:p-12 rounded-[40px] relative overflow-hidden group border-white/5 hover:border-white/10 transition-colors duration-500">
           {/* Subtle Light Effect */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 blur-[120px] -translate-y-1/2 translate-x-1/2 group-hover:bg-white/10 transition-colors duration-700" />
          
          <div className="relative z-10 flex flex-col h-full">
            <div className="mb-12">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/5 border border-white/10 mb-8 shadow-xl">
                <Keyboard className="text-[var(--color-brand)]" size={32} />
              </div>
              <h2 className="text-4xl font-bold text-white mb-4 tracking-tight">Manual Check-in</h2>
              <p className="text-gray-400 text-lg font-medium">Please enter your booking information.</p>
            </div>

            <form onSubmit={handleSearch} className="flex flex-col gap-8 flex-1">
              <div className="space-y-3">
                <label className="text-xs font-bold text-white/40 uppercase tracking-[0.2em] pl-1">Booking Confirmation</label>
                <div className="relative group/input">
                    <input
                      type="text"
                      value={confNumber}
                      onChange={(e) => setConfNumber(e.target.value.toUpperCase())}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl p-6 text-2xl text-white outline-none focus:border-white/20 focus:bg-white/[0.08] transition-all placeholder:text-white/10 uppercase tracking-widest font-mono"
                      placeholder="CONF-XXXXXX"
                      required
                    />
                    <div className="absolute inset-0 rounded-2xl border border-[var(--color-brand)]/0 group-focus-within/input:border-[var(--color-brand)]/20 transition-all pointer-events-none" />
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-bold text-white/40 uppercase tracking-[0.2em] pl-1">Last Name</label>
                <div className="relative group/input">
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl p-6 text-2xl text-white outline-none focus:border-white/20 focus:bg-white/[0.08] transition-all placeholder:text-white/10 capitalize font-medium"
                      placeholder="Enter surname"
                      required
                    />
                    <div className="absolute inset-0 rounded-2xl border border-[var(--color-brand)]/0 group-focus-within/input:border-[var(--color-brand)]/20 transition-all pointer-events-none" />
                </div>
              </div>

              <div className="mt-auto pt-8">
                <motion.button
                  type="submit"
                  disabled={isLoading}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full py-6 bg-white text-[#0a0f18] rounded-2xl text-2xl font-bold transition-all shadow-2xl shadow-white/5 hover:bg-gray-100 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  {isLoading ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                      className="w-8 h-8 border-3 border-[#0a0f18]/20 border-t-[#0a0f18] rounded-full"
                    />
                  ) : (
                    <>
                      <Search size={28} className="group-hover:scale-110 transition-transform duration-300" />
                      Find My Booking
                    </>
                  )}
                </motion.button>
              </div>
            </form>
          </div>
        </div>

        {/* Divider: OR Section */}
        <div className="flex flex-col items-center justify-center px-2">
          <div className="w-px h-32 bg-gradient-to-b from-transparent via-white/10 to-transparent" />
          <div className="my-6 w-12 h-12 rounded-full border border-white/10 flex items-center justify-center">
             <span className="text-[10px] text-white/30 font-black tracking-widest uppercase">OR</span>
          </div>
          <div className="w-px h-32 bg-gradient-to-b from-transparent via-white/10 to-transparent" />
        </div>

        {/* Right Column: QR Code Scanner */}
        <div className="flex-1 glass p-10 md:p-12 rounded-[40px] flex flex-col items-center justify-center text-center cursor-pointer hover:bg-white/[0.04] transition-all duration-500 border border-white/5 group relative overflow-hidden">
           {/* Subtle Animation Effect */}
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-brand)]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
          
          <motion.div
            className="w-64 h-64 rounded-[40px] border-2 border-dashed border-white/10 flex flex-col items-center justify-center mb-10 bg-white/5 relative overflow-hidden group-hover:border-[var(--color-brand)]/30 transition-colors duration-500"
          >
            {/* High-Tech Scan Line */}
            <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden rounded-[38px]">
                <motion.div 
                   animate={{ top: ['-10%', '110%', '-10%'] }}
                   transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                   className="absolute left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[var(--color-brand)]/80 to-transparent opacity-60 shadow-[0_0_20px_var(--color-brand)]"
                />
            </div>

            <QrCode size={110} className="text-white/20 group-hover:text-[var(--color-brand)]/60 transition-colors duration-500 relative z-10" />
          </motion.div>
          
          <div className="relative z-10">
            <h2 className="text-4xl font-bold text-white mb-4 tracking-tight">Express QR Check-in</h2>
            <p className="text-gray-400 text-lg font-medium max-w-sm mx-auto leading-relaxed">
              Simply scan your confirmation QR code to retrieve your booking instantly.
            </p>
          </div>

          <div className="absolute bottom-10 flex flex-col items-center gap-2 opacity-40 group-hover:opacity-80 transition-opacity">
             <div className="w-1 h-1 rounded-full bg-white animate-ping" />
             <span className="text-[10px] font-bold tracking-[0.3em] uppercase">Scanning Active</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

