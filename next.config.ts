import type { NextConfig } from "next";

// Connect-src needs the Supabase project's own origin (Auth + REST calls go
// straight there from the browser, not through /api) - falls back to Google's
// OAuth-safe wildcard-free default of just 'self' + the known API host if the
// env var isn't set at build time.
const supabaseOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : "";
  } catch {
    return "";
  }
})();

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js inlines hydration/streaming payloads as <script> tags with no
  // external src - there's no per-request nonce wired up here, so this
  // can't be tightened further without a bigger App Router CSP-nonce setup.
  // 'unsafe-eval' is added in dev only - the webpack dev server's HMR runtime
  // relies on eval() for source maps, which production's build doesn't use.
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  // Admin-editable Bill/RR3 templates embed their own <style> blocks
  // (rendered via dangerouslySetInnerHTML after the app's own HTML-escaping
  // - see invoiceTemplate.ts/rr3Template.ts) alongside Tailwind's own
  // inline styles.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  /* config options here */
  allowedDevOrigins: ['172.20.10.4'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  async rewrites() {
    if (process.env.NODE_ENV === 'production') return [];
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:8000/:path*',
      },
    ];
  },
};

export default nextConfig;
