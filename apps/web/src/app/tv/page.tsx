import { redirect } from "next/navigation";
import { leerSesion } from "@/lib/auth";
import { obtenerKpis } from "@/lib/consultas";
import { iaDisponible } from "@/lib/ia";
import { MapaCimba } from "@/components/mapa/mapa-cimba";
import { PanelTv } from "./panel-tv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * CIMBA EN LA PANTALLA GRANDE: el modo pantalla de comando para la oficina de
 * la Dirección (y para cuando entra una visita). Vive FUERA del route group
 * (app) a propósito: sin menú, sin encabezado — solo el mapa vivo en Brecha y
 * la columna de datos que se refresca sola cada minuto. La página entera se
 * recarga cada 10 minutos para traer el geojson fresco del mapa.
 */
export default async function PaginaTv() {
  const sesion = await leerSesion();
  if (!sesion) redirect("/acceso");
  // La pantalla es del personal: el rol empresa tiene su portal.
  if (sesion.rol_cimba === "empresa") redirect("/empresa");

  const kpis = await obtenerKpis(sesion);

  return (
    <div className="flex h-screen overflow-hidden bg-fondo">
      <div className="relative min-w-0 flex-1">
        <MapaCimba
          kpisIniciales={kpis}
          rol={sesion.rol_cimba}
          iaHabilitada={iaDisponible()}
          inicial={{ vista: "brecha" }}
          pantalla
        />
      </div>
      <PanelTv conFeed={["admin", "planificacion"].includes(sesion.rol_cimba)} />
    </div>
  );
}
