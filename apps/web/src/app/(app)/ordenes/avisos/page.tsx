import Link from "next/link";
import { ArrowLeft, BellRing, Mail, Megaphone } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { listarDestinatarios } from "@/lib/acciones-avisos";
import { Panel, TituloPagina } from "@/components/ui";
import { EVENTOS } from "./constantes";
import { GestorEvento } from "./gestor-evento";
import { AvisoGeneral } from "./aviso-general";

export const dynamic = "force-dynamic";

/**
 * El tablero de avisos del Director: qué evento le avisa a quién y por dónde.
 * Server component: lee la configuración y el estado real de los canales;
 * las islas cliente (una por tarjeta + el megáfono) hacen el resto.
 */
export default async function PaginaAvisos() {
  const sesion = (await leerSesion())!;
  const puedeGestionar = sesion.rol_cimba === "admin" || sesion.rol_cimba === "planificacion";
  const destinatarios = await listarDestinatarios();

  // Server-side, y solo el booleano: la key jamás baja al cliente.
  const emailActivo = Boolean(process.env.RESEND_API_KEY);

  const hayAvisoGeneralActivo = destinatarios.some(
    (d) => d.evento === "aviso_general" && d.activo && (d.canal === "push" || emailActivo),
  );

  return (
    <div className="mx-auto max-w-6xl p-6">
      <Link
        href="/ordenes"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-texto-2 transition hover:text-texto"
      >
        <ArrowLeft size={15} /> Órdenes
      </Link>

      <TituloPagina
        titulo="Avisos — quién se entera de qué"
        sub="Cada evento del bacheo le avisa a las áreas que definas acá: por push al celular o por email."
      />

      {/* Estado real de los canales */}
      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-celeste/40 bg-celeste/10 px-2.5 py-1 font-medium text-celeste">
          <BellRing size={12} /> Push: siempre disponible — el personal activa la campanita en su dispositivo
        </span>
        {emailActivo && (
          <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-medium text-ok" style={{ borderColor: "color-mix(in srgb, var(--color-ok) 40%, transparent)", background: "color-mix(in srgb, var(--color-ok) 10%, transparent)" }}>
            <Mail size={12} /> Email: encendido
          </span>
        )}
      </div>

      {!emailActivo && (
        <div className="mb-5 rounded-lg border border-amarillo/50 bg-amarillo/10 px-4 py-3 text-sm text-amarillo">
          <b>El canal de email está apagado: falta RESEND_API_KEY.</b> Los push andan igual. Los emails
          que configures quedan guardados y arrancan solos cuando el canal se encienda.
        </div>
      )}

      {!puedeGestionar && (
        <Panel className="mb-5 px-4 py-3 text-sm text-texto-2">
          Estás viendo la configuración en modo lectura: la gestionan Planificación y Administración.
        </Panel>
      )}

      {/* Las cuatro tarjetas de evento */}
      <div className="grid gap-4 md:grid-cols-2">
        {EVENTOS.map(({ evento, titulo, dispara }) => (
          <Panel key={evento} className="p-4">
            <h2 className="text-sm font-bold tracking-wide uppercase">{titulo}</h2>
            <p className="mt-0.5 mb-3 text-xs leading-relaxed text-texto-3">{dispara}</p>
            <GestorEvento
              evento={evento}
              destinatarios={destinatarios.filter((d) => d.evento === evento)}
              puedeGestionar={puedeGestionar}
              emailActivo={emailActivo}
            />
          </Panel>
        ))}
      </div>

      {/* El megáfono */}
      <h2 className="mt-8 mb-3 flex items-center gap-2 text-sm font-bold tracking-wide uppercase">
        <Megaphone size={15} className="text-azul" /> Mandar un aviso general ahora
      </h2>
      <Panel className="max-w-3xl p-4">
        {puedeGestionar ? (
          <AvisoGeneral hayDestinatariosActivos={hayAvisoGeneralActivo} />
        ) : (
          <p className="text-sm text-texto-2">
            Los avisos generales los redactan y mandan Planificación o Administración desde esta sección.
          </p>
        )}
      </Panel>
    </div>
  );
}
