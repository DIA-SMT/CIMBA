import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// En desarrollo el .env vive en la raíz del monorepo (../../.env), que Next no
// lee por sí solo. En Vercel no existe el archivo y las env vienen de la
// plataforma: este bloque es un no-op.
const envRaiz = path.join(__dirname, "..", "..", ".env");
if (fs.existsSync(envRaiz)) {
  for (const linea of fs.readFileSync(envRaiz, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea.trim());
    if (m && m[1] && process.env[m[1]] === undefined) {
      process.env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
    }
  }
}

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
