import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  /* config options here */
  allowedDevOrigins: ['172.20.10.4'],
  // playwright-core's coreBundle.js requires browsers.json (a non-JS data
  // file) at runtime; Next's static import-tracing doesn't catch it, so the
  // serverless bundle for this route is missing it unless explicitly included.
  // @sparticuz/chromium's compressed binary is the same story.
  outputFileTracingIncludes: {
    '/api/print-bill/pdf': [
      './node_modules/playwright-core/**/*',
      './node_modules/@sparticuz/chromium/**/*',
    ],
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
