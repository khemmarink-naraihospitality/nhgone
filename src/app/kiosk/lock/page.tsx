"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lock,
  QrCode,
  ShieldCheck,
  KeyRound,
  MonitorCheck,
  AlertCircle,
  Camera,
  CameraOff,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
import { useSelectedProperty } from "@/lib/propertyContext";

/**
 * Kiosk device pairing, ported from the NHGKiosk prototype. Changed on the
 * way in: pairing used to look a scanned slug up in that project's own
 * `properties` table and redirect to /kiosk/<slug>. Here it matches against
 * the properties the signed-in user may see (useSelectedProperty), sets that
 * as the app-wide selected property, and lands on /kiosk - the per-slug
 * routes were not ported.
 *
 * Be clear about what this is: a demo gate. The PIN below is a constant in
 * client-side code and the "paired" flag is localStorage, so this stops
 * nobody who opens devtools. The real boundary is that /kiosk/* sits behind
 * NHGOne's own sign-in and the Kiosk menu permission.
 */
const DEMO_PAIRING_PIN = "1234";

const slugify = (name: string) =>
  name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");

export default function KioskLockPage() {
  const { properties, setSelectedProperty } = useSelectedProperty();
  const [step, setStep] = useState<"scan" | "pin">("scan");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [isAuthorized, setIsAuthorized] = useState(false);

  // Camera scanning state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const qrScannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    try {
      // localStorage is a browser-only external system - it cannot be read
      // during the server pass, so the paired flag can only reach state
      // here. Same reason the clock in the kiosk layout starts null.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem("kiosk_authorized") === "true") setIsAuthorized(true);
    } catch {
      // Blocked storage: the terminal simply stays on the lock screen.
    }
  }, []);

  const stopCamera = async () => {
    if (qrScannerRef.current) {
      try {
        if (qrScannerRef.current.isScanning) {
          await qrScannerRef.current.stop();
        }
      } catch (err) {
        console.error("Error stopping scanner:", err);
      }
      qrScannerRef.current = null;
    }
    setIsCameraActive(false);
  };

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      void stopCamera();
    };
  }, []);

  const pairWith = (propertyName: string) => {
    setSelectedProperty(propertyName);
    try {
      localStorage.setItem("kiosk_authorized", "true");
    } catch {
      // Blocked storage: pairing lasts for this page load only.
    }
    // The layout listens for this to swap "Device Secured" for the property.
    window.dispatchEvent(new Event("storage"));
    setSuccessMsg(`Paired successfully with ${propertyName}!`);
    setTimeout(() => {
      setIsAuthorized(true);
      window.location.href = "/kiosk";
    }, 1500);
  };

  const failWith = (message: string) => {
    setError(message);
    setTimeout(() => setError(""), 4000);
  };

  const startCamera = async () => {
    setCameraError(null);
    setIsCameraActive(true);

    // Slight timeout to ensure container #reader is mounted
    setTimeout(async () => {
      try {
        const html5QrCode = new Html5Qrcode("reader");
        qrScannerRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: (width: number, height: number) => {
              const size = Math.min(width, height) * 0.7;
              return { width: size, height: size };
            },
          },
          async (qrCodeMessage: string) => {
            await handleQrScanSuccess(qrCodeMessage);
          },
          () => {
            // Keep scanning - per-frame parse failures are normal, not errors.
          }
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Camera start error:", message);
        setCameraError(message || "Could not access system camera. Please check permissions.");
        setIsCameraActive(false);
      }
    }, 100);
  };

  const handleQrScanSuccess = async (scannedText: string) => {
    await stopCamera();

    // The QR may hold a full kiosk URL or just the property slug.
    let slug = "";
    try {
      const urlObj = new URL(scannedText);
      const pathParts = urlObj.pathname.split("/").filter(Boolean);
      const kioskIndex = pathParts.indexOf("kiosk");
      if (kioskIndex !== -1 && pathParts[kioskIndex + 1]) slug = pathParts[kioskIndex + 1];
    } catch {
      slug = scannedText.trim();
    }

    if (!slug) {
      failWith("Invalid Kiosk QR Code format.");
      return;
    }

    const matched = properties.find((p) => slugify(p.name) === slug);
    if (!matched) {
      failWith("Property not found, or you don't have access to it.");
      return;
    }
    pairWith(matched.name);
  };

  // Fallback for a terminal with no camera (and for testing the flow).
  const triggerMockPairing = () => {
    if (properties.length === 0) {
      failWith("No property available to pair with.");
      return;
    }
    pairWith(properties[0].name);
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin !== DEMO_PAIRING_PIN) {
      setError("Invalid security code. Access denied.");
      setPin("");
      setTimeout(() => setError(""), 3000);
      return;
    }
    if (properties.length === 0) {
      failWith("No property available to pair with.");
      return;
    }
    pairWith(properties[0].name);
  };

  if (isAuthorized) {
    return (
      <div className="fixed inset-0 bg-[#0a0f18] flex items-center justify-center z-[99999]">
         <div className="text-center space-y-6">
            <div className="w-24 h-24 bg-green-500/10 border border-green-500/30 rounded-full flex items-center justify-center mx-auto shadow-[0_0_50px_rgba(34,197,94,0.2)] animate-pulse">
               <MonitorCheck size={48} className="text-green-400" />
            </div>
            <div className="space-y-2">
               <h2 className="text-3xl font-extrabold text-white tracking-tight">Kiosk Paired</h2>
               <p className="text-slate-400 text-sm font-medium">Entering secure check-in environment...</p>
            </div>
         </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-[#0a0f18] text-white flex flex-col items-center justify-center p-6">
      {/* Background patterns */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,#3b82f6_0%,transparent_50%)]" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-blue-600/20 blur-[150px]" />
      </div>

      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md glass p-8 rounded-[40px] border-white/10 relative z-10 shadow-2xl"
      >
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mb-4 border border-blue-500/20">
            <Lock size={32} className="text-blue-400" />
          </div>
          <h1 className="text-2xl font-black tracking-tight mb-1">Kiosk Secured</h1>
          <p className="text-white/40 text-xs font-semibold">This device requires authentication before use.</p>
        </div>

        {error && (
          <motion.div
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="mb-6 flex items-center gap-3 text-rose-400 bg-rose-500/10 p-4 rounded-2xl border border-rose-500/20"
          >
            <AlertCircle size={18} className="shrink-0" />
            <p className="text-[11px] font-black uppercase tracking-wider">{error}</p>
          </motion.div>
        )}

        {successMsg && (
          <motion.div
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="mb-6 flex items-center gap-3 text-emerald-400 bg-emerald-500/10 p-4 rounded-2xl border border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]"
          >
            <Sparkles size={18} className="shrink-0" />
            <p className="text-[11px] font-black uppercase tracking-wider">{successMsg}</p>
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {step === "scan" ? (
            <motion.div
              key="scan"
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 20, opacity: 0 }}
              className="space-y-6"
            >
              {isCameraActive ? (
                // Camera Scanner Active
                <div className="space-y-4">
                  <div className="relative w-full aspect-square rounded-3xl overflow-hidden border-2 border-sky-500/40 bg-black shadow-[0_0_30px_rgba(56,189,248,0.15)]">
                     {/* html5-qrcode standard reader target */}
                     <div id="reader" className="w-full h-full object-cover"></div>

                     {/* Scanning laser line glow */}
                     <motion.div
                       animate={{ top: ["0%", "100%", "0%"] }}
                       transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
                       className="absolute left-0 w-full h-0.5 bg-sky-500 shadow-[0_0_15px_rgba(56,189,248,0.8)] z-10 pointer-events-none"
                     />
                  </div>

                  <button
                    onClick={stopCamera}
                    className="w-full py-4 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
                  >
                     <CameraOff size={16} />
                     Close Camera
                  </button>
                </div>
              ) : (
                // Camera Scanner Inactive / Placeholder
                <div className="space-y-4">
                  <div
                    onClick={startCamera}
                    className="w-full aspect-square rounded-3xl border-2 border-dashed border-white/10 bg-white/5 flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 hover:border-blue-500/30 transition-all group relative"
                  >
                    <div className="relative flex flex-col items-center justify-center text-center p-6">
                      <QrCode size={80} className="text-white/20 group-hover:text-blue-400/40 transition-colors mb-4" />
                      <span className="px-4 py-2 bg-blue-500/10 text-blue-400 rounded-xl text-[10px] font-black uppercase tracking-widest border border-blue-500/20 flex items-center gap-1.5 shadow-sm group-hover:scale-105 transition-transform">
                        <Camera size={12} /> Click to Open Camera
                      </span>
                    </div>
                  </div>

                  {cameraError && (
                    <p className="text-[10px] text-rose-400 font-bold text-center leading-relaxed">
                      {cameraError}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                     <button
                       onClick={triggerMockPairing}
                       className="py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all"
                     >
                        <RefreshCw size={12} /> Pair With Current
                     </button>
                     <button
                       onClick={() => setStep("pin")}
                       className="py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all"
                     >
                        <KeyRound size={12} /> Security Pin
                     </button>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3 p-4 bg-white/5 rounded-2xl border border-white/5">
                <ShieldCheck size={20} className="text-blue-400 shrink-0" />
                <p className="text-[10px] text-white/50 leading-relaxed uppercase tracking-wider font-extrabold text-left">
                  Scan a kiosk pairing QR code, or pair this terminal with the property currently selected in NHGOne.
                </p>
              </div>
            </motion.div>
          ) : (
            // Security PIN Step
            <motion.div
              key="pin"
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 20, opacity: 0 }}
            >
              <form onSubmit={handlePinSubmit} className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[9px] font-black uppercase tracking-[0.4em] text-white/40 pl-1">Security Pin Code</label>
                  <input
                    type="password"
                    maxLength={4}
                    value={pin}
                    autoFocus
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    className="w-full bg-white/10 border border-white/10 rounded-2xl p-5 text-center text-3xl tracking-[1em] font-black focus:border-blue-500/50 outline-none transition-all"
                    placeholder="****"
                  />
                </div>

                <button
                  type="submit"
                  disabled={pin.length < 4}
                  className="w-full py-5 bg-white text-[#0a0f18] rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all hover:bg-gray-100 disabled:opacity-20 shadow-xl shadow-white/5"
                >
                  <MonitorCheck size={18} />
                  Authorize Device
                </button>

                <button
                  type="button"
                  onClick={() => setStep("scan")}
                  className="w-full text-[9px] font-black uppercase tracking-[0.4em] text-white/20 hover:text-white/40 transition-all text-center"
                >
                  Back to Scanner
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="mt-10 flex items-center gap-3 opacity-20">
        <KeyRound size={14} />
        <p className="text-[9px] font-black uppercase tracking-[0.5em]">Terminal Encryption Active</p>
      </div>
    </div>
  );
}
