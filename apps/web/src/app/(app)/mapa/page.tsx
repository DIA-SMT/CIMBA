import { leerSesion } from "@/lib/auth";
import { obtenerKpis } from "@/lib/consultas";
import { iaDisponible } from "@/lib/ia";
import { MapaCimba } from "@/components/mapa/mapa-cimba";

export const dynamic = "force-dynamic";

export default async function PaginaMapa({
  searchParams,
}: {
  searchParams: Promise<{
    lat?: string; lon?: string; z?: string;
    clat?: string; clon?: string; cz?: string;
    vista?: string; brecha?: string; modoBrecha?: string; fuente?: string; tipo?: string;
    dias?: string; calor?: string; hex?: string; sat?: string; top?: string;
    zlat?: string; zlon?: string; zr?: string;
    buscar?: string;
  }>;
}) {
  const sesion = (await leerSesion())!;
  const kpis = await obtenerKpis(sesion);

  // Deep-link desde cualquier lista: /mapa?lat=&lon=&z= abre centrado y marcado.
  const sp = await searchParams;
  const lat = Number(sp.lat);
  const lon = Number(sp.lon);
  const foco =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon, zoom: Math.min(19.5, Math.max(11, Number(sp.z) || 16.5)) }
      : null;

  // Cámara de una vista compartida (Exportar → Copiar link): sin marcador,
  // a diferencia de foco arriba, que es "centrame en este punto puntual".
  const clat = Number(sp.clat);
  const clon = Number(sp.clon);
  const camara =
    !foco && Number.isFinite(clat) && Number.isFinite(clon)
      ? { lat: clat, lon: clon, zoom: Math.min(19.5, Math.max(1, Number(sp.cz) || 12.6)) }
      : undefined;

  // calor es tri-estado: "1"/"0" explícitos pisan el default de la vista;
  // ausente (link viejo) deja que cada vista use el suyo.
  const calor = sp.calor === "1" ? true : sp.calor === "0" ? false : undefined;

  const inicial = {
    vista: ["operativo", "historico", "analisis", "brecha", "completo"].includes(sp.vista ?? "")
      ? (sp.vista as "operativo" | "historico" | "analisis" | "brecha" | "completo")
      : undefined,
    brecha: ["sin_atencion", "en_cola", "posible_resuelta"].includes(sp.brecha ?? "") ? sp.brecha : undefined,
    modoBrecha: sp.modoBrecha === "antiguedad" ? ("antiguedad" as const) : undefined,
    fuente: sp.fuente,
    tipo: sp.tipo,
    dias: sp.dias && [30, 90, 180].includes(Number(sp.dias)) ? Number(sp.dias) : undefined,
    calor,
    hex: sp.hex === "1" || undefined,
    sat: sp.sat === "1" || undefined,
    top: sp.top === "1" || undefined,
    camara,
    // Migue (u otro link) puede mandar una acción en lenguaje natural:
    // /mapa?buscar=baches sin atender en Belgrano
    buscar: sp.buscar?.trim().slice(0, 200) || undefined,
    zona:
      sp.zlat && sp.zlon && sp.zr && Number.isFinite(Number(sp.zlat)) && Number.isFinite(Number(sp.zlon))
        ? {
            lat: Number(sp.zlat),
            lon: Number(sp.zlon),
            radio: Math.min(2000, Math.max(60, Number(sp.zr) || 250)),
          }
        : undefined,
  };

  return (
    <MapaCimba
      kpisIniciales={kpis}
      rol={sesion.rol_cimba}
      iaHabilitada={iaDisponible()}
      foco={foco}
      inicial={inicial}
    />
  );
}
