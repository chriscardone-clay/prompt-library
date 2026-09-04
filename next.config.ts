import type { NextConfig } from "next";

/**
 * Sites allowed to embed this app in an iframe (Notion by default). Override
 * with a space-separated list in EMBED_FRAME_ANCESTORS, e.g.
 *   EMBED_FRAME_ANCESTORS="https://*.notion.so https://*.notion.site https://intranet.example.com"
 * Use "*" to allow any site.
 */
const FRAME_ANCESTORS =
  process.env.EMBED_FRAME_ANCESTORS?.trim() ||
  [
    "'self'",
    "https://*.notion.so",
    "https://notion.so",
    "https://*.notion.site",
    "https://*.notion.com",
    "https://notion.com",
  ].join(" ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // Avatars come from Google; we render them with a plain <img> so no loader config is needed.
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      // Inline skill text is capped at 1.5 MB server-side (binaries go to
      // Storage directly from the browser); give the action headroom so an
      // oversize draft gets a friendly error rather than a transport failure.
      bodySizeLimit: "4mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Embedding: no X-Frame-Options (it can't express an allow-list); CSP does the job.
          { key: "Content-Security-Policy", value: `frame-ancestors ${FRAME_ANCESTORS}` },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/fonts/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
