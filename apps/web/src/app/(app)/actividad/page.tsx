import Link from "next/link";
import { redirect } from "next/navigation";
import { leerSesion } from "@/lib/auth";
import { feedActividad, usoPorPersona, type EventoActividad } from "@/lib/actividad";
import { fechaCorta, numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Actividad: quién usa el sistema, quién no, y qué hizo cada uno — la
 * pantalla para "trazar cualquier anomalía o mal uso". Solo la ven admin
 * (Dirección de IA) y planificación (el Director de Bacheo).
 *
 * Todo sale de la auditoría que la base escribe sola: acá no hay nada que
 * borrar ni editar — por diseño.
 */

/** La frase legible de cada evento: entidad+acción+fragmentos → castellano. */
function describir(e: EventoActividad): { texto: string; href: string | null } {
  const id = e.entidadId;
  switch (e.entidad) {
    case "sesion":
      return { texto: `entró al sistema${e.via ? ` (${e.via})` : ""}`, href: null };
    case "demandas": {
      const href = `/demandas/${id}`;
      if (e.accion === "insert") return { texto: `cargó el pedido #${id}`, href };
      if (e.accion === "delete") return { texto: `borró el pedido #${id}`, href: null };
      if (e.marca === "cierre") return { texto: `cerró el reclamo #${id} y dejó la respuesta al vecino`, href };
      if (e.marca === "derivada") return { texto: `derivó el reclamo #${id} (salió de la cola de bacheo)`, href };
      if (e.marca === "duplicada") return { texto: `descartó el reclamo #${id} como duplicado`, href };
      if (e.marca === "tipo_corregido") return { texto: `corrigió el tipo del reclamo #${id}`, href };
      if (e.estadoAntes && e.estadoDespues && e.estadoAntes !== e.estadoDespues)
        return { texto: `pasó el reclamo #${id} de ${e.estadoAntes.replaceAll("_", " ")} a ${e.estadoDespues.replaceAll("_", " ")}`, href };
      return { texto: `actualizó el reclamo #${id}`, href };
    }
    case "incidentes": {
      const href = `/incidentes/${id}`;
      if (e.accion === "insert") return { texto: `creó el incidente #${id}`, href };
      if (e.accion === "delete") return { texto: `borró el incidente #${id}`, href: null };
      if (e.estadoDespues === "verificado") return { texto: `verificó la reparación del incidente #${id}`, href };
      if (e.estadoAntes && e.estadoDespues && e.estadoAntes !== e.estadoDespues)
        return { texto: `pasó el incidente #${id} de ${e.estadoAntes.replaceAll("_", " ")} a ${e.estadoDespues.replaceAll("_", " ")}`, href };
      return { texto: `actualizó el incidente #${id}`, href };
    }
    case "intervenciones": {
      if (e.accion === "insert")
        return { texto: `reportó un trabajo hecho${e.m2 != null ? ` (${numero(e.m2)} m²)` : ""}`, href: "/intervenciones" };
      return { texto: `actualizó una intervención`, href: "/intervenciones" };
    }
    case "ordenes_trabajo": {
      const href = `/ordenes/${id}`;
      const n = e.numero ? ` ${e.numero}` : ` #${id}`;
      if (e.accion === "insert") return { texto: `creó la orden${n}`, href };
      if (e.estadoDespues === "emitida") return { texto: `emitió la orden${n}`, href };
      if (e.estadoDespues === "anulada") return { texto: `anuló la orden${n}`, href };
      if (e.estadoDespues === "completada") return { texto: `se completó la orden${n}`, href };
      return { texto: `actualizó la orden${n}`, href };
    }
    case "orden_items": {
      if (e.estadoDespues === "hecho") return { texto: `reportó hecho un bache de orden`, href: null };
      if (e.estadoDespues === "propuesto") return { texto: `propuso un bache desde la calle`, href: "/ordenes" };
      if (e.estadoDespues === "no_encontrado") return { texto: `marcó un bache como no encontrado`, href: null };
      if (e.accion === "insert") return { texto: `sumó un bache a una orden`, href: null };
      return { texto: `actualizó un bache de orden`, href: null };
    }
    case "expedientes":
      return { texto: `registró la nota ${e.numero ?? `#${id}`}`, href: `/expedientes/${id}` };
    case "avisos_destinatarios":
      return { texto: `cambió la configuración de avisos`, href: "/ordenes/avisos" };
    default:
      return { texto: `${e.accion} en ${e.entidad} #${id}`, href: null };
  }
}

const hace = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso.replace(" ", "T"))) / 60000);
  if (!Number.isFinite(min) || min < 0) return fechaCorta(iso);
  if (min < 60) return `hace ${min} min`;
  if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`;
  return fechaCorta(iso);
};

export default async function PaginaActividad({
  searchParams,
}: {
  searchParams: Promise<{ usuario?: string; sistema?: string }>;
}) {
  const sesion = (await leerSesion())!;
  // Trazar personas es cosa de la conducción: admin (Dirección de IA) y
  // planificación (el Director). Nadie más — ni siquiera en modo lectura.
  if (!["admin", "planificacion"].includes(sesion.rol_cimba)) redirect("/mapa");

  const sp = await searchParams;
  const incluirSistema = sp.sistema === "1";
  const [personas, feed] = await Promise.all([
    usoPorPersona(sesion),
    feedActividad(sesion, { actor: sp.usuario, incluirSistema }),
  ]);

  const sinUso = personas.filter((p) => p.activo && p.ingresos30 === 0 && p.acciones30 === 0);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <TituloPagina
        titulo="Actividad"
        sub="Quién usa el sistema, quién no, y qué hizo cada uno. Sale de la auditoría automática de la base: acá nada se puede editar ni borrar."
      />

      {/* Quién usa y quién no */}
      <Panel className="mb-6 overflow-x-auto p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-2">
          <p className="text-sm font-bold">Personas — últimos 30 días</p>
          {sinUso.length > 0 && (
            <p className="text-xs text-texto-3">
              <b className="text-encurso">{sinUso.length}</b> acceso(s) activos sin uso en 30 días
            </p>
          )}
        </div>
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-[10px] font-bold tracking-wider text-texto-3 uppercase">
              <th className="px-5 py-2">Persona</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2 text-right">Ingresos (30d)</th>
              <th className="px-3 py-2 text-right">Acciones (30d)</th>
              <th className="px-3 py-2">Última actividad</th>
              <th className="px-5 py-2 text-right">Ver</th>
            </tr>
          </thead>
          <tbody>
            {personas.map((p) => {
              const dormida = p.activo && p.ingresos30 === 0 && p.acciones30 === 0;
              return (
                <tr key={p.id} className={`border-b border-borde/60 ${p.activo ? "" : "opacity-45"}`}>
                  <td className="px-5 py-2.5 font-semibold">
                    {p.nombre}
                    {p.usuario && <span className="text-[11px] font-normal text-texto-3"> · {p.usuario}</span>}
                    {!p.activo && <span className="text-[10px] font-bold text-texto-3"> · SUSPENDIDO</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] tracking-wide text-texto-2 uppercase">{p.rol.replaceAll("_", " ")}</td>
                  <td className="num px-3 py-2.5 text-right">{numero(p.ingresos30)}</td>
                  <td className="num px-3 py-2.5 text-right font-bold">{numero(p.acciones30)}</td>
                  <td className="px-3 py-2.5 text-texto-2">
                    {p.ultimaAccion ? hace(p.ultimaAccion) : p.ultimoIngreso ? hace(p.ultimoIngreso) : (
                      <span className={dormida ? "font-semibold text-encurso" : "text-texto-3"}>nunca entró</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <Link href={`/actividad?usuario=${p.id}`} className="text-xs font-semibold text-celeste hover:underline">
                      sus movimientos →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {/* El feed */}
      <Panel className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-2">
          <p className="text-sm font-bold">
            Últimos movimientos
            {sp.usuario && (
              <>
                {" "}· filtrado{" "}
                <Link href={incluirSistema ? "/actividad?sistema=1" : "/actividad"} className="text-xs font-semibold text-celeste hover:underline">
                  (quitar filtro ✕)
                </Link>
              </>
            )}
          </p>
          <Link
            href={`/actividad?${new URLSearchParams({ ...(sp.usuario ? { usuario: sp.usuario } : {}), ...(incluirSistema ? {} : { sistema: "1" }) })}`}
            className="text-xs font-semibold text-texto-3 hover:text-texto"
            title="La sincronización automática (reclamos del 147, SIGOV) también escribe: mostrarla u ocultarla"
          >
            {incluirSistema ? "ocultar lo automático" : "mostrar también lo automático"}
          </Link>
        </div>
        {feed.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-texto-3">Sin movimientos registrados con este filtro.</p>
        ) : (
          <ul className="divide-y divide-borde/60">
            {feed.map((e) => {
              const d = describir(e);
              return (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-5 py-2 text-[13px]">
                  <span className="num shrink-0 text-[11px] text-texto-3" title={fechaCorta(e.en)}>{hace(e.en)}</span>
                  <b>{e.actor}</b>
                  {e.rol && <span className="text-[10px] tracking-wide text-texto-3 uppercase">{e.rol.replaceAll("_", " ")}</span>}
                  <span className="text-texto-2">{d.texto}</span>
                  {d.href && (
                    <Link href={d.href} className="text-xs font-semibold text-celeste hover:underline">
                      ver →
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="px-5 py-3 text-[11px] leading-relaxed text-texto-3">
          La auditoría la escribe la base de datos sola en cada cambio, con la persona de la sesión — no hay
          forma de operar sin dejar rastro, ni de borrar el rastro desde la aplicación.
        </p>
      </Panel>
    </div>
  );
}
