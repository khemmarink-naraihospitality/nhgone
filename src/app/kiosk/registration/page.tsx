"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, FileText, User, PenTool } from "lucide-react";

export default function RegistrationPage() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);

  const handleClearSignature = () => {
    setSignatureData(null);
  };

  const handleNext = () => {
    if (agreed) {
      router.push("/kiosk/ekyc");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="w-full h-full flex flex-col pt-2"
    >
      <div className="mb-8 flex justify-between items-end px-2">
        <div>
          <h1 className="text-4xl font-black text-white mb-3 tracking-tight">Review & Signing</h1>
          <p className="text-gray-400 text-lg font-medium leading-relaxed">Verify your reservation details and complete the digital signature.</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 flex-1 overflow-hidden pb-4">
        {/* Left Column: Comprehensive Details */}
        <div className="flex-1 glass p-10 rounded-[40px] flex flex-col gap-8 overflow-y-auto border-white/5 relative group">
           {/* Subtle Glow Effect */}
           <div className="absolute -top-32 -left-32 w-64 h-64 bg-[var(--color-brand)]/5 blur-[100px] pointer-events-none" />
           
          <section className="space-y-6">
            <div className="flex items-center gap-4 mb-4">
               <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-[var(--color-brand)]">
                  <User size={20} />
               </div>
               <h3 className="text-xs font-black text-white/40 uppercase tracking-[0.3em]">Guest Information</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8 bg-white/5 rounded-3xl p-8 border border-white/5">
              <div className="space-y-1">
                <span className="block text-white/30 text-[10px] font-bold uppercase tracking-widest leading-none">Full Guest Name</span>
                <span className="text-2xl font-bold text-white tracking-tight">John Smith</span>
              </div>
              <div className="space-y-1">
                <span className="block text-white/30 text-[10px] font-bold uppercase tracking-widest leading-none">Email Address</span>
                <span className="text-2xl font-bold text-white tracking-tight">john.smith@domain.com</span>
              </div>
              <div className="space-y-1">
                <span className="block text-white/30 text-[10px] font-bold uppercase tracking-widest leading-none">Contact Number</span>
                <span className="text-2xl font-bold text-white tracking-tight">+66 81 234 5678</span>
              </div>
            </div>
          </section>

          <section className="space-y-6">
             <div className="flex items-center gap-4 mb-4">
               <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-[var(--color-brand)]">
                  <FileText size={20} />
               </div>
               <h3 className="text-xs font-black text-white/40 uppercase tracking-[0.3em]">Booking Details</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10 bg-white/5 rounded-3xl p-8 border border-white/5 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                   <h1 className="text-[140px] font-black italic tracking-tighter leading-none select-none">LUBD</h1>
                </div>
                
              <div className="space-y-1 relative z-10">
                <span className="block text-white/30 text-[10px] font-bold uppercase tracking-widest leading-none">Check-in</span>
                <span className="text-2xl font-bold text-white tracking-tight">10 Apr 2026</span>
              </div>
              <div className="space-y-1 relative z-10">
                <span className="block text-white/30 text-[10px] font-bold uppercase tracking-widest leading-none">Check-out</span>
                <span className="text-2xl font-bold text-white tracking-tight">15 Apr 2026</span>
              </div>
              <div className="space-y-1 relative z-10">
                <span className="block text-white/30 text-[10px] font-bold uppercase tracking-widest leading-none">Room Selected</span>
                <span className="text-2xl font-bold text-white tracking-tight">Executive Suite</span>
              </div>
              <div className="space-y-1 relative z-10">
                <span className="block text-white/30 text-[10px] font-bold uppercase tracking-widest leading-none">Durations</span>
                <span className="text-2xl font-bold text-white tracking-tight">5 Nights / 1 Room</span>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: PDPA & High-End Signature */}
        <div className="w-full lg:w-[480px] flex flex-col gap-8">
          <div className="glass p-10 rounded-[40px] flex-1 flex flex-col border border-white/5 relative overflow-hidden group/signing">
             {/* Subtle Inner Glow */}
             <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
             
            <h3 className="text-[10px] font-black text-white/40 mb-6 uppercase tracking-[0.4em]">PDPA & Digital Consent</h3>
            
            <div className="bg-black/60 rounded-2xl p-6 text-[13px] text-gray-400 relative mb-10 border border-white/10 leading-relaxed font-medium">
               <div className="absolute top-4 right-4 text-white/10 select-none">
                  <FileText size={40} />
               </div>
              I hereby authorize Narai Hospitality Group to collect, process, and securely store my personal identifiers for the sole purpose of check-in services, hospitality management, and security protocols as mandated by the Personal Data Protection Act (PDPA).
            </div>

            <div className="flex items-center gap-3 mb-4 pl-1">
               <PenTool size={16} className="text-[var(--color-brand)]" />
               <h3 className="text-xs font-black text-white/60 uppercase tracking-[0.3em]">Signature Required</h3>
            </div>
            
            {/* High-End Signature Pad Visual */}
            <div className="flex-1 min-h-[200px] bg-[#f8fafc] rounded-3xl relative mb-4 flex items-center justify-center cursor-crosshair border-4 border-transparent shadow-[inset_0_4px_12px_rgba(0,0,0,0.1)] overflow-hidden group-focus-within/signing:border-[var(--color-brand)]/20 transition-all">
              <span className="text-black/10 text-xl font-bold z-0 select-none tracking-widest uppercase italic">Digital Signature</span>
              
              <div 
                className="absolute inset-0 z-10 h-full w-full"
                onClick={() => setSignatureData("signed_mock")}
              >
                {signatureData && (
                  <svg className="w-full h-full drop-shadow-md" viewBox="0 0 400 200">
                    <path d="M 50 100 Q 150 20 200 100 T 350 100" fill="none" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            </div>
            
            <div className="flex justify-start mb-10 pl-2">
              <button 
                onClick={handleClearSignature}
                className="text-white/20 hover:text-white transition-all uppercase text-[8px] font-black tracking-[0.4em] border-b border-white/10 pb-0.5"
              >
                Reset Signature Pad
              </button>
            </div>

            <label className="flex items-start gap-4 cursor-pointer group mt-auto select-none">
              <div className="relative flex items-center justify-center pt-0.5">
                <input 
                  type="checkbox" 
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="w-7 h-7 peer appearance-none border border-white/20 rounded-xl bg-white/5 checked:bg-[var(--color-brand)] checked:border-[var(--color-brand)] transition-all duration-300"
                />
                <CheckCircle2 size={18} className="absolute text-white opacity-0 peer-checked:opacity-100 transition-all duration-300 pointer-events-none" />
              </div>
              <span className="text-sm font-bold text-white/60 group-hover:text-white transition-all leading-tight">
                I confirm the accuracy of information provided and solemnly agree to the PDPA terms.
              </span>
            </label>
          </div>

          <motion.button
            onClick={handleNext}
            disabled={!agreed}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-6 bg-white text-[#0a0f18] rounded-[30px] text-2xl font-black transition-all shadow-2xl shadow-white/5 hover:bg-gray-100 flex items-center justify-center gap-4 disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed group h-24"
          >
            Authenticate Identity
            <ArrowRight size={32} className="group-hover:translate-x-3 transition-transform duration-500" />
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

