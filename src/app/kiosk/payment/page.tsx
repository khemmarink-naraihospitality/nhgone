"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, CreditCard, QrCode, Smartphone, ShieldCheck, CheckCircle2, ChevronRight, Lock } from "lucide-react";

export default function PaymentPage() {
  const router = useRouter();
  const [method, setMethod] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handlePayment = () => {
    if (!method) return;
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setIsSuccess(true);
    }, 4000);
  };

  const paymentMethods = [
    { id: "card", title: "Credit / Debit Card", icon: CreditCard, subtitle: "All major networks supported" },
    { id: "qr", title: "PromptPay QR", icon: QrCode, subtitle: "Instant scan and pay" },
    { id: "nfc", title: "Apple / Google Pay", icon: Smartphone, subtitle: "Contactless NFC payment" }
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -30 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="w-full h-full flex flex-col pt-2"
    >
      <AnimatePresence mode="wait">
        {!isSuccess ? (
          <motion.div 
            key="payment_form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center"
          >
            <div className="mb-10 text-center px-4 w-full">
              <h1 className="text-5xl font-black text-white mb-4 tracking-tighter">Settlement</h1>
              <p className="text-gray-400 text-xl font-medium max-w-2xl mx-auto leading-relaxed">
                Complete your check-in by selecting your preferred payment method.
              </p>
            </div>

            <div className="flex-1 max-w-6xl w-full flex flex-col lg:flex-row gap-10 pb-8 px-4 overflow-hidden">
              {/* Payment Methods */}
              <div className="flex-1 flex flex-col gap-5">
                <h3 className="text-[10px] font-black text-white/30 mb-2 uppercase tracking-[0.4em] pl-6">Secure Payment Methods</h3>
                {paymentMethods.map((m) => {
                  const isSelected = method === m.id;
                  return (
                    <motion.div
                      key={m.id}
                      onClick={() => setMethod(m.id)}
                      whileHover={{ x: isProcessing ? 0 : 8 }}
                      className={`relative glass p-8 rounded-[36px] flex items-center gap-8 cursor-pointer transition-all duration-500 border-2 ${
                        isSelected ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10" : "border-white/5 hover:border-white/10"
                      } ${isProcessing ? "opacity-30 grayscale pointer-events-none" : "opacity-100"}`}
                    >
                      <div className={`w-16 h-16 rounded-[22px] flex items-center justify-center transition-all ${
                         isSelected ? "bg-[var(--color-brand)] text-black" : "bg-white/5 text-white/30"
                      }`}>
                        <m.icon size={32} />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-2xl font-bold text-white tracking-tight leading-none mb-2">{m.title}</h4>
                        <p className="text-white/30 text-sm font-medium uppercase tracking-widest">{m.subtitle}</p>
                      </div>
                      <ChevronRight size={24} className={`transition-transform duration-500 ${isSelected ? "text-[var(--color-brand)]" : "text-white/10"}`} />
                    </motion.div>
                  );
                })}
                
                <div className="mt-auto flex items-center gap-4 bg-white/5 p-6 rounded-[28px] border border-white/5 opacity-50">
                   <Lock size={20} className="text-white/40" />
                   <p className="text-xs font-bold text-white/40 uppercase tracking-widest leading-relaxed">
                      All transactions are 256-bit encrypted and PCI-DSS compliant.
                   </p>
                </div>
              </div>

              {/* Final Invoice Summary */}
              <div className="w-full lg:w-[440px] flex flex-col gap-6">
                <div className="glass p-12 rounded-[48px] flex flex-col border border-white/10 relative overflow-hidden h-full shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
                   <div className="absolute top-0 right-0 w-40 h-40 bg-[var(--color-brand)]/10 blur-[80px]" />
                   
                   <div className="mb-10 flex justify-between items-start">
                       <div>
                          <h3 className="text-xs font-black text-white/40 uppercase tracking-[0.4em] mb-2">Final Invoice</h3>
                          <p className="text-white/60 font-medium text-sm">Booking ID: NHG-48229</p>
                       </div>
                       <ShieldCheck size={32} className="text-[var(--color-brand)] opacity-50" />
                   </div>

                   <div className="flex-1 space-y-8">
                       <div className="flex justify-between items-center group">
                          <span className="text-white/40 font-bold uppercase text-[10px] tracking-widest">Base Stay (5 nights)</span>
                          <span className="text-xl font-bold text-white tracking-tight">฿4,200</span>
                       </div>
                       <div className="flex justify-between items-center group">
                          <span className="text-white/40 font-bold uppercase text-[10px] tracking-widest">Selected Services</span>
                          <span className="text-xl font-bold text-white tracking-tight">฿1,550</span>
                       </div>
                       <div className="flex justify-between items-center group">
                          <span className="text-white/40 font-bold uppercase text-[10px] tracking-widest">Tourism Levy</span>
                          <span className="text-xl font-bold text-white tracking-tight">฿150</span>
                       </div>
                   </div>

                   <div className="pt-10 border-t border-white/10 mt-10">
                       <div className="flex justify-between items-end">
                          <span className="text-xs font-black text-white/40 uppercase tracking-[0.5em] mb-3">Total Due</span>
                          <div className="text-right">
                             <p className="text-[52px] font-black text-[var(--color-brand)] tracking-tighter leading-none mb-1">฿5,900</p>
                             <p className="text-[10px] text-white/20 font-bold uppercase tracking-[0.3em]">Thai Baht (Inclusive of all taxes)</p>
                          </div>
                       </div>
                   </div>
                </div>

                <div className="relative group">
                   {isProcessing && (
                      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-20 rounded-[36px] flex flex-col items-center justify-center gap-6">
                         <div className="w-12 h-12 border-4 border-t-[var(--color-brand)] border-white/10 rounded-full animate-spin" />
                         <p className="text-[var(--color-brand)] font-black uppercase text-[10px] tracking-[0.4em] animate-pulse">Processing Payment</p>
                      </div>
                   )}
                   
                   <motion.button
                    onClick={handlePayment}
                    disabled={!method || isProcessing}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="w-full h-24 bg-white text-[#0a0f18] rounded-[36px] font-black text-2xl flex items-center justify-center gap-5 transition-all shadow-2xl shadow-white/5 hover:bg-gray-100 disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed group active:scale-95"
                  >
                    Confirm & Settle
                    <ArrowRight size={32} className="group-hover:translate-x-3 transition-transform duration-500" />
                  </motion.button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex-1 flex flex-col items-center justify-center py-20 px-4"
          >
            <div className="relative mb-12">
               <motion.div 
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                  className="w-72 h-72 bg-[var(--color-brand)] rounded-full flex items-center justify-center shadow-[0_0_80px_rgba(212,175,55,0.4)]"
               >
                  <CheckCircle2 size={140} className="text-[#0a0f18]" />
               </motion.div>
               
               {/* Decorative rays */}
               <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 40, ease: "linear" }}
                  className="absolute inset-[-40px] border-4 border-dashed border-[var(--color-brand)]/20 rounded-full opacity-50"
               />
            </div>

            <div className="text-center space-y-4 mb-20 max-w-xl">
               <h1 className="text-6xl font-black text-white tracking-tighter">Check-in Complete</h1>
               <p className="text-gray-400 text-xl font-medium leading-relaxed">
                  Your reservation is confirmed. Your digital key is ready, and a physical key will be issued shortly.
               </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
               <div className="glass p-10 rounded-[40px] border-white/5 flex flex-col text-center items-center">
                  <h4 className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em] mb-6">Your Room</h4>
                  <p className="text-5xl font-black text-white tracking-tight mb-2">402</p>
                  <p className="text-[var(--color-brand)] font-black text-[10px] uppercase tracking-widest">Executive Suite</p>
               </div>
               <div className="glass p-10 rounded-[40px] border-white/5 flex flex-col text-center items-center">
                  <h4 className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em] mb-6">Wifi Access</h4>
                  <p className="text-3xl font-black text-white tracking-tight mb-2">LUBD_GUEST</p>
                  <p className="text-[var(--color-brand)] font-black text-[10px] uppercase tracking-widest">PASS: chinatown2024</p>
               </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => router.push("/kiosk")}
              className="mt-16 w-full max-w-md h-20 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white rounded-[30px] font-black text-xl flex items-center justify-center gap-4 transition-all"
            >
              Finish Process
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
