import { notFound } from "next/navigation";
import Link from "next/link";
import { BellRing, Users } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { listarAvisosConfig, listarUsuarios } from "@/lib/acciones-usuarios";
import { Panel, TituloPagina } from "@/components/ui";
import { PanelTabla } from "@/components/tabla-deslizable";
import { fechaCorta } from "@/lib/formato";
import { FormularioUsuario } from "../actividad/formulario-usuario";
import { BotonClaveUsuario } from "../actividad/boton-clave-usuario";
import { FilaUsuario } from "./fila-usuario";
import { InterruptorAviso } from "./interruptor-aviso";

export const dynamic = "force-dynamic";

/**
 * CONFIGURACIÓN — quién entra y qué avisa el sistema.
 *
 * Las dos cosas estaban, pero repartidas y escondidas: dar de alta a alguien
 * vivía en una tarjeta al pie de "Actividad" (una pantalla de auditoría), y
 * prender o apagar un aviso en "Órdenes → Avisos". Para cambiarle el rol a
 * alguien, directamente había que entrar a la base.
 *
 * Es la pantalla del superadmin y de nadie más: quien puede crear usuarios
 * puede crear otro administrador, y quien puede resetear claves puede entrar
 * como cualquiera. Por eso el guard está acá en el servidor y no solamente en
 * el menú — esconder un link nunca fue un control de acceso.
 */

const ETIQUETA_ROL: Record<string, string> = {
  admin: "Administrador",
  planificacion: "Planificación (Bacheo)",
  supervision: "Supervisión",
  atencion_ciudadana: "Atención Ciudadana",
  informacion_estrategica: "Información Estratégica",
  hcd: "Concejo Deliberante",
  funcionario: "Funcionario",
  cuadrilla: "Cuadrilla",
  lectura: "Solo lectura",
  empresa: "Empresa contratista",
};

/** Qué es cada aviso, en una línea, para poder decidir si se apaga. */
const QUE_AVISA: Record<string, string> = {
  orden_vencida: "Una orden activa pasó su fecha de vencimiento",
  orden_emitida: "Se emitió una orden nueva a una empresa",
  item_propuesto: "Una empresa cargó un bache que no estaba en la orden y espera validación",
  cierres_pendientes: "Hay trabajos terminados esperando que se le responda al vecino",
  pulso_diario: "El parte de las 7:00 con lo que pasó ayer",
};

export default async function PaginaConfiguracion() {
  const sesion = (await leerSesion())!;
  // El guard real: sin esto, cualquiera con la URL entra a crear un admin.
  if (sesion.rol_cimba !== "admin") notFound();

  const [usuarios, avisos] = await Promise.all([listarUsuarios(), listarAvisosConfig()]);
  const conClave = usuarios.filter((u) => u.tieneClave);
  const porSso = usuarios.filter((u) => !u.tieneClave);
  const porEvento = new Map<string, typeof avisos>();
  for (const a of avisos) {
    porEvento.set(a.evento, [...(porEvento.get(a.evento) ?? []), a]);
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <TituloPagina
        titulo="Configuración"
        sub="Quién entra al sistema, con qué permiso, y qué avisa CIMBA a cada área."
      />

      {/* ── Usuarios ───────────────────────────────────────────────────── */}
      <h2 className="mt-6 mb-3 flex items-center gap-2 text-sm font-bold tracking-wide uppercase">
        <Users size={15} className="text-celeste" />
        Usuarios
        <span className="font-normal text-texto-3 normal-case">
          — {conClave.length} con usuario y clave propios
        </span>
      </h2>

      <Panel className="mb-4 p-4">
        <FormularioUsuario />
      </Panel>

      <PanelTabla>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
              <th className="px-4 py-3">Usuario</th>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Rol</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Último ingreso</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {conClave.map((u) => (
              <FilaUsuario
                key={u.id}
                usuario={u}
                etiquetaRol={ETIQUETA_ROL}
                esUnoMismo={u.id === sesion.sub}
                accionClave={<BotonClaveUsuario perfilId={u.id} />}
              />
            ))}
          </tbody>
        </table>
      </PanelTabla>

      {porSso.length > 0 && (
        <details className="mt-3 rounded-xl border border-borde bg-panel px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-texto-2">
            {porSso.length} perfiles sin clave propia
            <span className="ml-1 font-normal text-texto-3">
              — entran por Ciudad Digital o son accesos de sistema; se les puede cambiar el rol
            </span>
          </summary>
          <PanelTabla className="mt-3">
            <table className="w-full text-sm">
              <tbody>
                {porSso.map((u) => (
                  <FilaUsuario
                    key={u.id}
                    usuario={u}
                    etiquetaRol={ETIQUETA_ROL}
                    esUnoMismo={u.id === sesion.sub}
                    accionClave={null}
                  />
                ))}
              </tbody>
            </table>
          </PanelTabla>
        </details>
      )}

      {/* ── Avisos ─────────────────────────────────────────────────────── */}
      <h2 className="mt-8 mb-1 flex items-center gap-2 text-sm font-bold tracking-wide uppercase">
        <BellRing size={15} className="text-celeste" />
        Avisos
      </h2>
      <p className="mb-3 text-[12px] leading-relaxed text-texto-3">
        Cada renglón es un aviso que CIMBA manda a un área. Apagarlo no lo borra: se puede volver a
        prender cuando haga falta. Para elegir a QUIÉN le llega cada uno —o agregar un destinatario
        nuevo— está{" "}
        <Link href="/ordenes/avisos" className="font-semibold text-celeste hover:underline">
          el tablero de avisos
        </Link>
        .
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {[...porEvento.entries()].map(([evento, filas]) => (
          <Panel key={evento} className="p-4">
            <p className="text-sm font-bold">{evento.replaceAll("_", " ")}</p>
            <p className="mt-0.5 mb-2 text-[12px] leading-snug text-texto-3">
              {QUE_AVISA[evento] ?? "Aviso del sistema"}
            </p>
            <div className="space-y-1.5">
              {filas.map((a) => (
                <InterruptorAviso key={a.id} aviso={a} />
              ))}
            </div>
          </Panel>
        ))}
        {avisos.length === 0 && (
          <p className="rounded-xl border border-borde bg-panel px-4 py-6 text-sm text-texto-3">
            Todavía no hay avisos configurados.
          </p>
        )}
      </div>

      <p className="mt-6 text-[11px] text-texto-3">
        Cada acceso queda registrado en{" "}
        <Link href="/actividad" className="font-semibold text-celeste hover:underline">
          Actividad
        </Link>
        {usuarios.some((u) => u.ultimoIngreso) && (
          <>
            {" "}· último ingreso registrado:{" "}
            {fechaCorta(
              usuarios
                .map((u) => u.ultimoIngreso)
                .filter((x): x is string => x != null)
                .sort()
                .at(-1) ?? null,
            )}
          </>
        )}
        .
      </p>
    </div>
  );
}
