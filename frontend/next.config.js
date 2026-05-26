/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Strip source maps in prod so the unminified player + crypto plumbing
  // isn't trivially readable. Cuts another minute off the casual reverser.
  productionBrowserSourceMaps: false,
  // Drop console.* in client bundles (server logs unaffected). Strips
  // accidental token/ID leaks and removes obvious grep anchors.
  compiler: isProd
    ? { removeConsole: { exclude: ["error"] } }
    : undefined,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next needs inline for hydration; hls.js fallback path needs eval.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "media-src 'self' blob: https://*.r2.cloudflarestorage.com",
              "connect-src 'self' https: wss:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
  webpack: (config, { dev }) => {
    if (!dev) {
      const TerserPlugin = require("terser-webpack-plugin");
      config.optimization.minimizer = [
        new TerserPlugin({
          terserOptions: {
            compress: { drop_console: true, drop_debugger: true, passes: 2 },
            mangle: {
              // Don't mangle names other libs / DOM use at runtime.
              reserved: ["loadSource", "attachMedia", "destroy"],
            },
            format: { comments: false },
          },
          extractComments: false,
        }),
      ];
    }
    return config;
  },
};

module.exports = nextConfig;
