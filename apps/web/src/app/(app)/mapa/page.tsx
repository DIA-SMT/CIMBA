import { leerSesion } from "@/lib/auth";
import { obtenerKpis } from "@/lib/consultas";
import { iaDisponible } from "@/lib/ia";
import { MapaCimba } from "@/components/mapa/mapa-cimba";

export const dynamic = "force-dynamic";

export default async function PaginaMapa({
  searchParams,
}: {
  searchParams: Promise<{ lat?: string; lon?: string; z?: string }>;
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

  return <MapaCimba kpisIniciales={kpis} rol={sesion.rol_cimba} iaHabilitada={iaDisponible()} foco={foco} />;
}
