import { NextResponse, type NextRequest } from "next/server";
import type { TipoIntervencion } from "@cimba/domain";
import { leerSesion } from "@/lib/auth";
import { csv, respuestaCsv } from "@/lib/csv";
import { fechaCorta } from "@/lib/formato";
import { urlFoto } from "@/lib/fotos";
import { toneladasDe, volumenDe } from "@/lib/medicion";
import { documentoOrden } from "@/lib/nombre-archivo";
import { obtenerOrden } from "@/lib/ordenes";
import { ETIQUETA_ESTADO_ITEM, ETIQUETA_TIPO_TRABAJO } from "@/app/(app)/ordenes/etiquetas";
import { ETIQUETA_TIPO_INTERVENCION } from "@/app/(app)/ordenes/[id]/tipos-intervencion";

export const maxDuration = 60;

/**
 * LA ORDEN EN CSV, CON LAS COORDENADAS EXACTAS. Al lado de "Imprimir": la
 * planilla impresa sirve para firmar, pero para cruzarla en QGIS o en una
 * planilla hacen falta los puntos (pedido del usuario, 14/10). Cada bache con
 * su ticket (el número del bache, el mismo que ve la empresa y busca el
 * inspector), el del 147 si lo tiene, la fecha del trabajo y la latitud y
 * longitud sin redondear.
 *
 * Para el personal que arma y controla órdenes; la empresa tiene su propia
 * exportación en el portal (/api/empresa/exportar).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  if (!["admin", "planificacion", "supervision"].includes(sesion.rol_cimba)) {
    return NextResponse.json({ error: "sin permiso" }, { status: 403 });
  }
  const { id } = await params;
  const ordenId = Number(id);
  if (!Number.isInteger(ordenId) || ordenId <= 0) return NextResponse.json({ error: "orden inválida" }, { status: 400 });

  const orden = await obtenerOrden(sesion, ordenId);
  if (!orden) return NextResponse.json({ error: "no existe" }, { status: 404 });

  return respuestaCsv(
    documentoOrden(orden.numero),
    csv(
      [
        "Ticket",
        "Ticket Atención Ciudadana",
        "Orden",
        "Dirección",
        "Estado",
        "Tipo de trabajo",
        "Intervención",
        "Fecha del trabajo",
        "Latitud",
        "Longitud",
        "Ancho (m)",
        "Largo (m)",
        "Espesor (cm)",
        "Superficie (m2)",
        "Toneladas",
        "Reclamos",
        "Observaciones",
        "Foto antes",
        "Foto después",
      ],
      orden.itemsDetalle.map((it) => {
        const foto = (momento: string) => {
          const f = it.fotos.find((x) => x.momento === momento);
          return f ? urlFoto(f) : null;
        };
        const toneladas =
          it.superficieM2 != null && it.espesorCm != null
            ? Math.round(toneladasDe(volumenDe(it.superficieM2, it.espesorCm)) * 100) / 100
            : null;
        return [
          it.id,
          it.tickets147,
          orden.numero,
          it.direccion,
          ETIQUETA_ESTADO_ITEM[it.estado] ?? it.estado,
          ETIQUETA_TIPO_TRABAJO[it.tipoTrabajo] ?? it.tipoTrabajo,
          it.tipoIntervencion
            ? (ETIQUETA_TIPO_INTERVENCION[it.tipoIntervencion as TipoIntervencion] ?? it.tipoIntervencion)
            : null,
          it.fechaTrabajo ? fechaCorta(it.fechaTrabajo) : null,
          it.lat,
          it.lon,
          it.anchoM,
          it.largoM,
          it.espesorCm,
          it.superficieM2,
          toneladas,
          it.reclamos,
          it.observaciones,
          foto("antes"),
          foto("despues"),
        ];
      }),
    ),
  );
}
