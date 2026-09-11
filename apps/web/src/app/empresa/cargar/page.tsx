import Link from "next/link";
import { redirect } from "next/navigation";
import { leerSesion } from "@/lib/auth";
import { resolverVistaPortal } from "../vista";
import { FormularioLibre } from "./formulario-libre";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cargar trabajo sin orden. La puerta que faltaba: hasta acá, una empresa que
 * tapó un bache por urgencia no tenía dónde registrarlo en CIMBA y terminaba
 * cargándolo en la planilla de siempre.
 */
export default async function PaginaCargarLibre({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  const sesion = (await leerSesion())!;
  const vista = await resolverVistaPortal(sesion, await searchParams);
  // Staff sin empresa elegida: no hay a nombre de quién cargar.
  if (!vista.empresaId) redirect("/empresa");
  const sufijoEspejo = vista.esVistaEspejo ? `?empresa=${vista.empresaId}` : "";

  return (
    <div className="mx-auto max-w-xl p-4 pb-16">
      <Link
        href={`/empresa${sufijoEspejo}`}
        className="inline-flex min-h-12 items-center text-sm font-medium text-texto-2 hover:text-texto"
      >
        ← Mis órdenes
      </Link>

      <h1 className="mb-1 text-2xl font-bold tracking-tight">Cargar un trabajo sin orden</h1>
      <p className="mb-4 text-sm leading-relaxed text-texto-2">
        Para lo que hicieron por urgencia, por pedido de un inspector o porque estaban ahí. Entra al
        mapa y a las métricas como cualquier otro trabajo, pero queda marcado{" "}
        <b>“sin orden”</b>: la Dirección lo ve aparte de lo que encargó.
      </p>

      <FormularioLibre empresaId={vista.esVistaEspejo ? vista.empresaId : null} />
    </div>
  );
}
