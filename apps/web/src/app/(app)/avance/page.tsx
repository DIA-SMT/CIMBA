import { leerSesion } from "@/lib/auth";
import { datosAvance, ventanaValida } from "@/lib/avance";
import { PantallaAvance } from "./pantalla-avance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * AVANCE: la portada de CIMBA. La ciudad contada desde lo hecho —el trabajo
 * del mes, quién lo hizo, qué se está haciendo ahora— con lo pendiente de
 * fondo, sin apagarlo.
 *
 * Los datos vienen renderizados desde el servidor: la primera pintura ya
 * tiene el mapa lleno y las cifras puestas, sin spinner. Después la pantalla
 * se mantiene sola, pidiendo /api/avance cada minuto.
 *
 * `?dias=` abre en otra ventana (1, 7, 30, 90, 0 = todo). El default es el mes.
 */
export default async function PaginaAvance({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  // El layout ya redirigió a quien no tiene sesión y al rol empresa.
  const sesion = (await leerSesion())!;
  const sp = await searchParams;
  const dias = ventanaValida(sp.dias);
  const datos = await datosAvance(sesion, dias);

  return (
    <div className="h-full">
      <PantallaAvance inicial={datos} rol={sesion.rol_cimba} />
    </div>
  );
}
