import { leerSesion } from "@/lib/auth";
import { obtenerKpis } from "@/lib/consultas";
import { iaDisponible } from "@/lib/ia";
import { MapaCimba } from "@/components/mapa/mapa-cimba";

export const dynamic = "force-dynamic";

export default async function PaginaMapa({
  searchParams,
}: {
  searchParams: Promise<{ lat?: string; lon?: string; z?: string; vista?: string; brecha?: string; fuente?: string; tipo?: string }>;
}) {
  const sesion = (await leerSesion())!;
  const kpis = await obtenerKpis(sesion);

  // Deep-link desde cualquier lista: /mapa?lat=&lon=&z= abre centrado y marcado.
  const sp = await searchParams;
  const lat = Number(sp.lat);
  const lon = Number(sp.lon);
  const foco =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon, zoom: Math.min(19, Math.max(11, Number(sp.z) || 16.5)) }
      : null;

  const inicial = {
    vista: ["operativo", "historico", "analisis", "brecha", "completo"].includes(sp.vista ?? "")
      ? (sp.vista as "operativo" | "historico" | "analisis" | "brecha" | "completo")
      : undefined,
    brecha: ["sin_atencion", "en_cola", "posible_resuelta"].includes(sp.brecha ?? "") ? sp.brecha : undefined,
    fuente: sp.fuente,
    tipo: sp.tipo,
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
