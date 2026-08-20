import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@cimba/domain", "@cimba/db", "@cimba/integrations"],
  serverExternalPackages: ["postgres"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb", // fotos antes/después desde /campo
    },
  },
};

export default nextConfig;
