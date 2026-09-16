"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { HelpCircle, ChevronDown } from "lucide-react";
import { useSelectedProperty } from "@/lib/propertyContext";
import { useKioskConfig } from "./kioskConfig";

/**
 * The kiosk welcome screen - ported from the NHGKiosk prototype's own root
 * page. Two things it used to hardcode now follow configuration: the
 * property name (the prototype said "Lub d Chinatown" for every property),
 * and the hero photo, which comes from the kiosk's own Images at
 * Admin Console > Kiosks and falls back to the bundled entrance shot.
 *
 * The prototype's vertical "LUB D" brand label was removed rather than made
 * dynamic: it is one brand's wordmark, and this kiosk also runs at Marasca
 * Samui, where it would simply have been wrong.
 *
 * Still a prototype: "Check out" does nothing yet, and the language and
 * currency pickers are deliberately inert, exactly as they arrived.
 */

const FALLBACK_IMAGE = "/images/lub_d_chinatown_entrance.png";

export default function KioskWelcomePage() {
  const router = useRouter();
  const { selectedProperty } = useSelectedProperty();
  const { config } = useKioskConfig();
  const propertyName = selectedProperty || "NHG";
  const heroImage = config?.images?.[0]?.url || FALLBACK_IMAGE;

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden text-white">
      {/* Header */}
      <header className="absolute top-0 left-0 right-0 z-50 flex items-center justify-end p-8 gap-4">
        {/* Language Selector */}
        <div className="flex items-center gap-3 px-4 py-2 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl cursor-not-allowed">
          <div className="w-6 h-4 bg-blue-900 flex items-center justify-center text-[10px] text-white font-bold rounded-sm relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-1/2 bg-red-600" />
             <div className="absolute top-0 left-0 w-1/3 h-full bg-blue-800" />
          </div>
          <span className="text-sm font-medium">{config?.default_language || "English (United States)"}</span>
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </div>

        {/* Currency Selector */}
        <div className="flex items-center gap-3 px-4 py-2 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl cursor-not-allowed">
          <span className="text-sm font-medium">THB</span>
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </div>

        {/* Help Icon */}
        <div className="p-2 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl cursor-not-allowed">
          <HelpCircle className="w-6 h-6 text-gray-400" />
        </div>
      </header>

      {/* Main Content (Split Screen) */}
      <main className="flex-1 flex w-full">
        {/* Left Section (60%) */}
        <div className="w-[60%] flex flex-col justify-center px-16 relative">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="space-y-12 max-w-2xl"
          >
            {/* Logo Branding */}
            <div className="inline-block px-4 py-2 bg-white/5 border border-white/10 rounded-xl">
              <span className="text-sm font-semibold tracking-wider uppercase text-gray-400">{propertyName}</span>
            </div>

            {/* Welcome Text */}
            <div className="space-y-4">
              <h1 className="text-6xl font-bold leading-tight tracking-tight">
                Welcome to <br />
                <span className="text-white">{propertyName}</span>
              </h1>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-6 pt-8 w-full max-w-md">
              <motion.button
                onClick={() => router.push("/kiosk/search")}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-6 bg-white text-[#0a0f18] rounded-2xl text-2xl font-bold transition-all shadow-2xl shadow-white/5 hover:bg-gray-100"
              >
                Check in
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-6 bg-transparent border-2 border-white/20 text-white rounded-2xl text-2xl font-bold transition-all hover:bg-white/5"
              >
                Check out
              </motion.button>
            </div>
          </motion.div>
        </div>

        {/* Right Section (40%) */}
        <div className="w-[40%] relative">
          <div className="absolute inset-0 overflow-hidden rounded-l-[40px] m-4">
            {/* Plain <img>: the configured photo is a remote Supabase Storage
                URL, and next/image would need that host whitelisted in
                next.config for no benefit on a fixed-size kiosk panel. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
            {/* Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-l from-black/20 to-transparent" />
          </div>
        </div>
      </main>
    </div>
  );
}
