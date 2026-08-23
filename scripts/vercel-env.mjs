/**
 * Sube las variables de entorno del .env raíz al proyecto de Vercel.
 * Requiere VERCEL_TOKEN en el .env o en el entorno (vercel.com → Settings → Tokens).
 * No imprime valores, solo nombres y estados.
 *
 *   node scripts/vercel-env.mjs
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const envPath = path.join(import.meta.dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const linea of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const TOKEN = process.env.VERCEL_TOKEN;
if (!TOKEN) {
  console.error("Falta VERCEL_TOKEN (creá uno en vercel.com → Account Settings → Tokens y agregalo al .env)");
  process.exit(1);
}

const PROYECTO = "prj_GJaCKTIBJZIcAuA9hbxh2VMFgq9q";
const TEAM = "team_pDGsND9gxPBILfnkRxIdVSlE";

const VARIABLES = [
  "DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CIMBA_JWT_SECRET",
  "DEV_FAKE_SSO",
  "ADMIN_USUARIO",
  "ADMIN_PASSWORD",
  "CRON_SECRET",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "CIMBA_FUENTE_AC",
  "NEXT_PUBLIC_MAP_STYLE_DARK",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "CONTACTOS_WHATSAPP",
];

const cuerpo = VARIABLES.filter((k) => process.env[k]).map((key) => ({
  key,
  value: process.env[key],
  type: key.startsWith("NEXT_PUBLIC_") ? "plain" : "encrypted",
  target: ["production", "preview"],
}));

const res = await fetch(
  `https://api.vercel.com/v10/projects/${PROYECTO}/env?teamId=${TEAM}&upsert=true`,
  {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  },
);
const json = await res.json();
if (!res.ok) {
  console.error("Error", res.status, JSON.stringify(json.error ?? json).slice(0, 300));
  process.exit(1);
}
console.log(`✔ ${cuerpo.length} variables configuradas en Vercel (production + preview):`);
for (const v of cuerpo) console.log(`   ${v.key}`);
const faltantes = VARIABLES.filter((k) => !process.env[k]);
if (faltantes.length) console.log(`⚠ sin valor local (no subidas): ${faltantes.join(", ")}`);
console.log("\nAhora hay que redeployar para que tomen efecto (git push o desde el dashboard).");
