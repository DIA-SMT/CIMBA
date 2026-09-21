import Link from "next/link";
import { redirect } from "next/navigation";
import { leerSesion } from "@/lib/auth";
import { ordenesDeEmpresa } from "@/lib/ordenes";
import { resolverVistaPortal } from "../vista";
import { ElegirOrden } from "./elegir-orden";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * CARGAR UN BACHE, empezando por la pregunta correcta: ¿de qué orden es?
 *
 * Esta pantalla era "Cargar un trabajo sin orden" y era la puerta más grande
 * de la portada. Calleri entró por acá 90 veces mientras trabajaba una orden,
 * y los 90 baches quedaron fuera de su orden y de su certificación.
 *
 * Ahora primero se elige la orden (el bache entra como propuesto y Bacheo lo
 * valida); cargar por fuera de toda orden es la última opción, explicada, y
 * pide un motivo. Ver elegir-orden.tsx.
 */
export default async function PaginaCargar({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  const sesion = (await leerSesion())!;
  const vista = await resolverVistaPortal(sesion, await searchParams);
  // Staff sin empresa elegida: no hay a nombre de quién cargar.
  if (!vista.empresaId) redirect("/empresa");
  const sufijoEspejo = vista.esVistaEspejo ? `?empresa=${vista.empresaId}` : "";

  const ordenes = await ordenesDeEmpresa(sesion, vista.empresaId ?? undefined);
  const activas = ordenes.filter((o) => o.estado === "emitida" || o.estado === "en_ejecucion");

  return (
    <div className="mx-auto max-w-xl p-4 pb-16">
      <Link
        href={`/empresa${sufijoEspejo}`}
        className="inline-flex min-h-12 items-center text-sm font-medium text-texto-2 hover:text-texto"
      >
        ← Mis órdenes
      </Link>

      <h1 className="mb-1 text-2xl font-bold tracking-tight">Cargar un bache</h1>
      <p className="mb-4 text-sm leading-relaxed text-texto-2">
        {activas.length > 0
          ? "Todo lo que tapan mientras trabajan una orden se carga EN esa orden: así se certifica."
          : "No tenés órdenes activas: lo que cargues queda marcado como trabajo sin orden."}
      </p>

      <ElegirOrden
        activas={activas}
        empresaId={vista.esVistaEspejo ? vista.empresaId : null}
        sufijoEspejo={sufijoEspejo}
      />
    </div>
  );
}
