"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, CheckCircle2, UserCircle2, ArrowRight, ShieldCheck, Sun, Eye, X } from "lucide-react";

export default function EKYCPage() {
  const router = useRouter();
  const [photoMocked, setPhotoMocked] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  const handleCapture = () => {
    setIsCapturing(true);
    setTimeout(() => {
      setIsCapturing(false);
      setPhotoMocked(true);
    }, 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="w-full h-full flex flex-col pt-2"
    >
      <div className="mb-10 text-center px-4">
        <h1 className="text-4xl font-black text-white mb-3 tracking-tight">Identity Verification</h1>
        <p className="text-gray-400 text-lg font-medium max-w-2xl mx-auto leading-relaxed">
          For your security and according to local regulations, we require a quick facial recognition check.
        </p>
      </div>

      <div className="flex-1 max-w-6xl mx-auto w-full flex flex-col lg:flex-row gap-10 pb-8 px-4 overflow-hidden">
        {/* Main Capture Area */}
        <div className="flex-1 glass p-10 rounded-[40px] flex flex-col items-center justify-center relative overflow-hidden border-white/5 active:border-[var(--color-brand)]/20 transition-all duration-700 min-h-[450px]">
           {/* Technical Grid Overlay */}
           <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:20px_20px]" />
           
          <AnimatePresence mode="wait">
            {!photoMocked ? (
              <motion.div 
                key="capture"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full flex flex-col items-center gap-10 relative z-10"
              >
                {isCapturing ? (
                  <div className="flex flex-col items-center gap-10">
                    <div className="relative w-72 h-72">
                         <motion.div 
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
                            className="absolute inset-0 border-4 border-dashed border-[var(--color-brand)]/30 rounded-full"
                         />
                         <div className="absolute inset-4 rounded-full border-2 border-white/5 flex items-center justify-center">
                             <div className="w-12 h-12 border-4 border-t-white border-white/10 rounded-full animate-spin" />
                         </div>
                    </div>
                    <div className="text-center">
                        <p className="text-2xl font-bold text-white mb-2 tracking-tight">Capturing Geometry...</p>
                        <p className="text-[var(--color-brand)] font-black text-xs uppercase tracking-[0.5em] animate-pulse">Bio-metrics Processing</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-12 w-full max-w-sm">
                    <div className="relative w-80 h-80 flex items-center justify-center">
                        {/* High-Tech Frame */}
                        <div className="absolute inset-0 border-[1px] border-white/10 rounded-full" />
                        <div className="absolute inset-4 border-[1px] border-white/5 rounded-full" />
                        
                        {/* Animated Corners/Guides */}
                        <motion.div 
                           animate={{ opacity: [0.3, 0.6, 0.3] }}
                           transition={{ repeat: Infinity, duration: 4 }}
                           className="absolute inset-0 flex items-center justify-center"
                        >
                            <div className="w-full h-1 bg-[var(--color-brand)]/30 blur-[2px] shadow-[0_0_15px_var(--color-brand)] animate-pulse" style={{ width: '10%' }} />
                        </motion.div>

                        <div className="relative z-10">
                           <UserCircle2 size={160} className="text-white/10" />
                        </div>

                        {/* Scanner Bar */}
                        <motion.div 
                           animate={{ top: ['10%', '90%', '10%'] }}
                           transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                           className="absolute left-[10%] right-[10%] h-[1px] bg-[var(--color-brand)]/60 shadow-[0_0_10px_var(--color-brand)]"
                        />
                    </div>

                    <motion.button 
                      onClick={handleCapture}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="w-full py-6 bg-white text-[#0a0f18] rounded-[30px] font-black text-2xl flex items-center justify-center gap-4 transition-all shadow-2xl shadow-white/5 hover:bg-gray-100 group"
                    >
                      <Camera size={32} className="group-hover:rotate-12 transition-transform duration-500" />
                      Begin Face Capture
                    </motion.button>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div 
                key="success"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex flex-col items-center gap-8 text-center"
              >
                <div className="relative mb-4">
                    <div className="w-56 h-56 bg-[var(--color-brand)]/5 rounded-full flex items-center justify-center border border-[var(--color-brand)]/20">
                        <CheckCircle2 size={100} className="text-[var(--color-brand)] drop-shadow-[0_0_15px_rgba(212,175,55,0.4)]" />
                    </div>
                    {/* Floating Success Particles Mockup */}
                    <motion.div 
                       animate={{ y: [-10, 10, -10], opacity: [0.3, 0.7, 0.3] }}
                       transition={{ repeat: Infinity, duration: 3 }}
                       className="absolute -top-4 -right-4 w-4 h-4 bg-[var(--color-brand)] rounded-full blur-sm"
                    />
                </div>
                
                <div className="space-y-2">
                    <h3 className="text-4xl font-black text-white tracking-tight">Identity Confirmed</h3>
                    <p className="text-gray-400 text-lg font-medium">Your profile has been successfully validated.</p>
                </div>
                
                <button 
                  onClick={() => setPhotoMocked(false)}
                  className="mt-6 text-white/20 hover:text-white transition-all uppercase text-[10px] font-black tracking-[0.4em] border-b border-white/5 pb-1"
                >
                  Reset & Retry Capture
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Requirements & Navigation */}
        <div className="w-full lg:w-[400px] flex flex-col gap-6">
          <div className="glass p-10 rounded-[40px] flex-1 flex flex-col border border-white/5 relative overflow-hidden">
             <div className="flex items-center gap-3 mb-8">
                <ShieldCheck size={20} className="text-[var(--color-brand)]" />
                <h3 className="text-xs font-black text-white/40 uppercase tracking-[0.3em]">Capture Protocols</h3>
             </div>
            
            <ul className="space-y-10">
              <li className="flex gap-6 items-start group">
                <div className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 group-hover:border-[var(--color-brand)]/40 transition-colors">
                    <Eye size={20} className="text-white/40 group-hover:text-white transition-colors" />
                </div>
                <div className="space-y-1">
                    <p className="text-white font-bold text-lg">Direct Eye Contact</p>
                    <p className="text-white/40 text-sm font-medium leading-relaxed">Look straight into the lens without tilting your head.</p>
                </div>
              </li>
              
              <li className="flex gap-6 items-start group">
                <div className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 group-hover:border-[var(--color-brand)]/40 transition-colors">
                    <Sun size={20} className="text-white/40 group-hover:text-white transition-colors" />
                </div>
                <div className="space-y-1">
                    <p className="text-white font-bold text-lg">Optimal Lighting</p>
                    <p className="text-white/40 text-sm font-medium leading-relaxed">Avoid heavy shadows or strong backlighting behind you.</p>
                </div>
              </li>
              
              <li className="flex gap-6 items-start group">
                <div className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 group-hover:border-[var(--color-brand)]/40 transition-colors">
                    <X size={20} className="text-white/40 group-hover:text-white transition-colors" />
                </div>
                <div className="space-y-1">
                    <p className="text-white font-bold text-lg">Clear Visibility</p>
                    <p className="text-white/40 text-sm font-medium leading-relaxed">Please remove accessories like hats, masks, or tinted glass.</p>
                </div>
              </li>
            </ul>

            <div className="mt-auto pt-10 border-t border-white/5">
                <p className="text-[10px] font-bold text-white/20 uppercase tracking-[0.2em] leading-relaxed">
                   Encrypted under Narai Hospitality security standards.
                </p>
            </div>
          </div>

          <motion.button
            onClick={() => router.push("/kiosk/upsell")}
            disabled={!photoMocked}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full h-24 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white rounded-[30px] font-black text-2xl flex items-center justify-center gap-4 transition-all disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed group"
          >
            Finalize Room
            <ArrowRight size={32} className="group-hover:translate-x-3 transition-transform duration-500" />
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

