import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
  async rewrites() {
    // afterFiles (el valor por defecto): si existe una ruta de Next.js, gana
    // ella. Así /api/climate/series se queda en este proceso y el resto de
    // /api va a FastAPI.
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
