/**
 * KML "Bacheo integral" (Google My Maps del Director) → GeoJSON estático para
 * la capa del mapa. Sin dependencias: el KML de My Maps es regular y con
 * regex alcanza — si algún día viene uno raro, acá va a fallar ruidosamente.
 *
 *   node scripts/convertir-bacheo-integral.mjs "C:\ruta\al\archivo.kml"
 */
import fs from "node:fs";
import path from "node:path";

const origen = process.argv[2];
if (!origen) {
  console.error("Falta la ruta del .kml");
  process.exit(1);
}
const kml = fs.readFileSync(origen, "utf8");

const features = [];
const placemarks = kml.match(/<Placemark>[\s\S]*?<\/Placemark>/g) ?? [];
for (const pm of placemarks) {
  const nombre = /<name>([\s\S]*?)<\/name>/.exec(pm)?.[1]?.trim() ?? "Sin nombre";
  const descCruda = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(pm)?.[1] ?? "";
  // La descripción viene con <br> de My Maps: la primera línea es la obra
  // ("Obra 82060-C"), el resto es el detalle (monto, plazo, objetivo).
  const lineas = descCruda.split(/<br\s*\/?>/i).map((l) => l.trim()).filter(Boolean);
  const obra = lineas[0]?.replace(/^Obra\s+/i, "") ?? null;
  const detalle = lineas.slice(1).join(" · ") || null;

  const anillos = [];
  for (const m of pm.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)) {
    const puntos = m[1]
      .trim()
      .split(/\s+/)
      .map((c) => c.split(",").slice(0, 2).map(Number))
      .filter((p) => p.length === 2 && p.every(Number.isFinite));
    if (puntos.length >= 4) anillos.push(puntos);
  }
  if (anillos.length === 0) continue;

  features.push({
    type: "Feature",
    geometry: { type: "MultiPolygon", coordinates: anillos.map((a) => [a]) },
    properties: { nombre, obra, detalle },
  });
}

const destino = path.join(import.meta.dirname, "..", "apps", "web", "public", "data", "bacheo-integral.json");
fs.writeFileSync(destino, JSON.stringify({ type: "FeatureCollection", features }));
console.log(`${features.length} zonas → ${destino}`);
for (const f of features) console.log(` · ${f.properties.nombre}: obra ${f.properties.obra} — ${f.properties.detalle}`);
