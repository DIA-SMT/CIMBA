import { leerSesion } from "@/lib/auth";
import { obtenerKpis } from "@/lib/consultas";
import { MapaCimba } from "@/components/mapa/mapa-cimba";

export const dynamic = "force-dynamic";

export default async function PaginaMapa() {
  const sesion = (await leerSesion())!;
  const kpis = await obtenerKpis(sesion);
  return <MapaCimba kpisIniciales={kpis} rol={sesion.rol_cimba} />;
}
