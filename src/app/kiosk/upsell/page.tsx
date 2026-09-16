"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Coffee, Clock, Sparkles, Check, Plus, Minus } from "lucide-react";
import { useSelectedProperty } from "@/lib/propertyContext";

const UPSELL_ITEMS = [
  {
    id: "breakfast",
    title: "Artisanal Breakfast",
    description: "Daily gourmet buffet with fresh local Chinatown delicacies & premium coffee.",
    price: 350,
    unit: "per person/day",
    icon: Coffee,
    image: "https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?auto=format&fit=crop&q=80&w=800",
  },
  {
    id: "late_checkout",
    title: "Extended Stay",
    description: "Relax longer with a 4:00 PM late check-out on your departure day.",
    price: 800,
    unit: "one-time fee",
    icon: Clock,
    image: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=800",
  },
  {
    id: "upgrade",
    title: "Premium View Upgrade",
    description: "Elevate your experience with a guaranteed high-floor room overlooking Chinatown.",
    price: 1200,
    unit: "per night",
    icon: Sparkles,
    image: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&q=80&w=800",
  }
];

export default function UpsellPage() {
  const router = useRouter();
  const { selectedProperty } = useSelectedProperty();
  const propertyName = selectedProperty || "our hotel";
  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  const toggleItem = (id: string) => {
    setSelectedItems(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const totalPrice = UPSELL_ITEMS
    .filter(item => selectedItems.includes(item.id))
    .reduce((sum, item) => sum + item.price, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="w-full h-full flex flex-col pt-2"
    >
      <div className="mb-10 text-center px-4">
        <h1 className="text-4xl font-black text-white mb-3 tracking-tight">Enhance Your Stay</h1>
        <p className="text-gray-400 text-lg font-medium max-w-2xl mx-auto">
          Tailor your experience at {propertyName} with these exclusive additions.
        </p>
      </div>

      <div className="flex-1 max-w-7xl mx-auto w-full flex flex-col lg:flex-row gap-10 pb-8 px-4 overflow-hidden">
        {/* Upsell Options Grid */}
        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
            {UPSELL_ITEMS.map((item) => {
              const isSelected = selectedItems.includes(item.id);
              return (
                <motion.div
                  key={item.id}
                  onClick={() => toggleItem(item.id)}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className={`relative flex flex-col md:flex-row glass rounded-[32px] overflow-hidden cursor-pointer transition-all duration-500 border-2 ${
                    isSelected ? "border-[var(--color-brand)] bg-[var(--color-brand)]/5" : "border-white/5 hover:border-white/10"
                  }`}
                >
                  {/* Image Section */}
                  <div className="w-full md:w-64 h-48 md:h-auto relative overflow-hidden">
                    <img 
                      src={item.image} 
                      alt={item.title} 
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 hover:scale-110" 
                    />
                    <div className="absolute inset-0 bg-black/20" />
                    <div className="absolute top-4 left-4">
                       <div className="w-10 h-10 rounded-xl bg-black/40 backdrop-blur-md border border-white/10 flex items-center justify-center text-[var(--color-brand)]">
                          <item.icon size={20} />
                       </div>
                    </div>
                  </div>

                  {/* Content Section */}
                  <div className="flex-1 p-8 flex flex-col justify-center">
                    <div className="flex justify-between items-start mb-2">
                       <h3 className="text-2xl font-bold text-white tracking-tight">{item.title}</h3>
                       <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${
                         isSelected ? "bg-[var(--color-brand)] border-[var(--color-brand)]" : "border-white/20"
                       }`}>
                          {isSelected ? <Check size={18} className="text-white" /> : <Plus size={18} className="text-white/20" />}
                       </div>
                    </div>
                    <p className="text-gray-400 text-base font-medium mb-6 max-w-lg leading-relaxed">
                      {item.description}
                    </p>
                    <div className="flex items-baseline gap-2">
                       <span className="text-2xl font-black text-white">฿{item.price}</span>
                       <span className="text-xs font-bold text-white/30 uppercase tracking-widest">{item.unit}</span>
                    </div>
                  </div>

                  {/* Selected Overlay Label */}
                  {isSelected && (
                    <motion.div 
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="absolute top-0 right-0 p-4"
                    >
                       <span className="bg-[var(--color-brand)] text-black text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">Added to stay</span>
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Summary Card & Navigation */}
        <div className="w-full lg:w-[420px] flex flex-col gap-6">
          <div className="glass p-10 rounded-[40px] flex flex-col border border-white/10 relative overflow-hidden">
             {/* Gradient Accent */}
             <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--color-brand)]/5 blur-[50px]" />
             
             <h3 className="text-[10px] font-black text-white/40 mb-8 uppercase tracking-[0.4em]">Order Summary</h3>
             
             <div className="space-y-6 mb-10 flex-1">
                <AnimatePresence mode="popLayout">
                  {selectedItems.length === 0 ? (
                    <motion.p 
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-white/30 italic text-sm py-4"
                    >
                      No additions selected yet.
                    </motion.p>
                  ) : (
                    UPSELL_ITEMS.filter(item => selectedItems.includes(item.id)).map(item => (
                      <motion.div 
                        key={item.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        className="flex justify-between items-center group"
                      >
                         <div className="space-y-1">
                            <p className="text-white font-bold">{item.title}</p>
                            <button 
                               onClick={() => toggleItem(item.id)}
                               className="text-[10px] text-[var(--color-brand)]/50 hover:text-[var(--color-brand)] font-black uppercase tracking-widest transition-colors flex items-center gap-1"
                            >
                               <Minus size={10} /> Remove
                            </button>
                         </div>
                         <p className="text-lg font-bold text-white">฿{item.price}</p>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>
             </div>

             <div className="pt-8 border-t border-white/5 space-y-4">
                <div className="flex justify-between items-center text-white/40 text-sm font-bold uppercase tracking-widest">
                   <span>Base Booking</span>
                   <span>฿4,200</span>
                </div>
                <div className="flex justify-between items-center">
                   <span className="text-white/60 font-bold">Additional Services</span>
                   <span className="text-white font-bold">฿{totalPrice}</span>
                </div>
                <div className="flex justify-between items-end pt-4">
                   <span className="text-xs font-black text-white/40 uppercase tracking-[0.3em]">Total Amount</span>
                   <div className="text-right">
                      <p className="text-4xl font-black text-white tracking-tighter">฿{4200 + totalPrice}</p>
                      <p className="text-[10px] text-white/20 font-bold uppercase tracking-widest mt-1">Tax included</p>
                   </div>
                </div>
             </div>
          </div>

          <div className="flex flex-col gap-4">
            <motion.button
              onClick={() => router.push("/kiosk/payment")}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full h-24 bg-white text-[#0a0f18] rounded-[30px] font-black text-2xl flex items-center justify-center gap-4 transition-all shadow-2xl shadow-white/5 hover:bg-gray-100 group"
            >
              Proceed to Payment
              <ArrowRight size={32} className="group-hover:translate-x-3 transition-transform duration-500" />
            </motion.button>
            
            <button 
              onClick={() => router.push("/kiosk/payment")}
              className="w-full py-4 text-white/20 hover:text-white transition-all uppercase text-[10px] font-black tracking-[0.4em]"
            >
              Skip & Complete Check-in
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
