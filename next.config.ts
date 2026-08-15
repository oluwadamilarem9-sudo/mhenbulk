import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Keep resolution rooted in this app (avoids parent-directory lockfile confusion).
    root: path.join(__dirname),
  },
};

export default nextConfig;
