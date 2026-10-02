import { leerSesion } from "@/lib/auth";
import { datosAvance, leerCamara, leerTerritorio, listarTerritorios, ventanaValida } from "@/lib/avance";
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
 * La URL describe la vista entera, así que se puede compartir:
 *   ?dias=30            la ventana (1, 7, 30, 90, 0 = todo; default el mes)
 *   ?distrito=9 / ?barrio=79   el recorte territorial
 *   ?empresa=Calleri    una sola empresa
 *   ?c=lat,lon,zoom     la cámara
 */
export default async function PaginaAvance({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; distrito?: string; barrio?: string; empresa?: string; c?: string }>;
}) {
  // El layout ya redirigió a quien no tiene sesión y al rol empresa.
  const sesion = (await leerSesion())!;
  const sp = await searchParams;
  const territorio = leerTerritorio(sp);
  const [datos, territorios] = await Promise.all([
    datosAvance(sesion, { dias: ventanaValida(sp.dias), territorio }),
    listarTerritorios(),
  ]);

  return (
    <div className="h-full">
      <PantallaAvance
        inicial={datos}
        rol={sesion.rol_cimba}
        territorios={territorios}
        empresaInicial={sp.empresa?.trim().slice(0, 40) || null}
        camaraInicial={leerCamara(sp.c)}
      />
    </div>
  );
}
