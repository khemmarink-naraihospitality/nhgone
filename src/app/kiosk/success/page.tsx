"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CheckCircle, ExternalLink, Phone } from "lucide-react";
import { kioskText, useKioskConfig } from "../kioskConfig";

/**
 * The end of the check-in flow. Three of the texts here are the property's
 * own, set at Admin Console > Kiosks: the thank-you line, how to collect a
 * key, and who to find if something went wrong. Each falls back to the
 * prototype's wording when the kiosk hasn't been configured.
 *
 * The room number is still mock - nothing behind these screens talks to
 * MEWS yet.
 */
export default function SuccessPage() {
  const router = useRouter();
  const { config } = useKioskConfig();

  const thankYou = kioskText(config?.thank_you_message, "Your check-in is complete. Enjoy your stay!");
  const takeKey = kioskText(config?.take_key_instructions, "Please take your room key from the dispenser below.");
  const contact = kioskText(config?.contact_instructions, "Your receipt has been sent to your email.");

  // Reset to idle screen after 30 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      router.push("/kiosk");
    }, 30000);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
      className="w-full h-full flex flex-col items-center justify-center pt-4"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.5 }}
        className="mb-10 relative"
      >
        <div className="absolute inset-0 bg-[var(--color-brand)] blur-3xl opacity-20 rounded-full" />
        <CheckCircle size={160} className="text-[var(--color-brand)] relative z-10 drop-shadow-[0_0_20px_rgba(212,175,55,0.5)]" />
      </motion.div>

      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.6 }}
        className="text-center mb-12 max-w-3xl px-4"
      >
        <h1 className="text-5xl md:text-6xl font-bold text-white mb-6 drop-shadow-lg">You&apos;re All Set!</h1>
        <p className="text-2xl text-gray-300 leading-relaxed">{thankYou}</p>
      </motion.div>

      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.6 }}
        className="glass p-12 rounded-3xl max-w-2xl w-full text-center border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/5"
      >
        <h3 className="text-2xl font-bold text-[var(--color-brand)] uppercase tracking-widest mb-6">Room Number</h3>
        <div className="text-8xl font-black text-white mb-8 drop-shadow-2xl font-mono">1405</div>

        <div className="flex flex-col items-start gap-4 text-lg text-gray-300 text-left">
          <div className="flex items-start gap-3">
            <ExternalLink size={24} className="text-[var(--color-brand)] shrink-0 mt-1" />
            <span>{takeKey}</span>
          </div>
          <div className="flex items-start gap-3">
            <Phone size={24} className="text-[var(--color-brand)] shrink-0 mt-1" />
            <span>{contact}</span>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 3, duration: 1 }}
        className="mt-16"
      >
        <button
          onClick={() => router.push("/kiosk")}
          className="px-10 py-4 glass bg-white/10 hover:bg-white/20 text-white font-semibold rounded-full uppercase tracking-wider transition-colors"
        >
          Finish &amp; Return to Home
        </button>
      </motion.div>
    </motion.div>
  );
}
