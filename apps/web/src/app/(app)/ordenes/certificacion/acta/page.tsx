import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { puntosParaActa, regimenPorEmpresa } from "@/lib/certificacion";
import { urlFoto } from "@/lib/fotos";
import { hoyISO } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";
import { FormularioActa } from "./formulario-acta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ARMAR EL ACTA DE MEDICIÓN CONJUNTA de una empresa: qué puntos entran, cuáles
 * se miden (todos, o la muestra sorteada), lo que dio la medición y las dos
 * firmas. La acción existía desde septiembre pero no tenía pantalla: nadie
 * podía firmar un acta, y sin acta lo cargado no se certifica para el pago.
 */
export default async function PaginaArmarActa({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const sesion = (await leerSesion())!;
  if (!["admin", "planificacion", "supervision"].includes(sesion.rol_cimba)) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center text-sm text-texto-3">
        El acta de medición la arman los inspectores y planificación.
      </div>
    );
  }
  const sp = await searchParams;
  const empresaId = /^\d{1,9}$/.test(sp.empresa ?? "") ? Number(sp.empresa) : null;
  const regimenes = await regimenPorEmpresa(sesion);
  const regimen = regimenes.find((r) => r.empresaId === empresaId) ?? null;

  if (!empresaId || !regimen) {
    const conPuntos = regimenes.filter((r) => r.itemsSinCertificar > 0);
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <Link href="/ordenes/certificacion" className="mb-4 inline-flex items-center gap-1.5 text-sm text-texto-2 hover:text-texto">
          <ArrowLeft size={15} /> Certificación
        </Link>
        <TituloPagina titulo="Armar un acta de medición" sub="Elegí de qué empresa es el acta." />
        <div className="space-y-2">
          {conPuntos.map((r) => (
            <Link key={r.empresaId} href={`/ordenes/certificacion/acta?empresa=${r.empresaId}`} className="block">
              <Panel className="p-4 transition hover:border-celeste/50">
                <b>{r.empresa}</b>
                <span className="num ml-2 text-sm text-texto-2">{r.itemsSinCertificar} puntos sin certificar</span>
              </Panel>
            </Link>
          ))}
          {conPuntos.length === 0 && (
            <Panel className="p-6 text-center text-sm text-texto-3">No hay puntos pendientes de certificar.</Panel>
          )}
        </div>
      </div>
    );
  }

  const puntos = await puntosParaActa(sesion, empresaId);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <Link href="/ordenes/certificacion" className="mb-4 inline-flex items-center gap-1.5 text-sm text-texto-2 hover:text-texto">
        <ArrowLeft size={15} /> Certificación
      </Link>
      <TituloPagina
        titulo={`Acta de medición — ${regimen.empresa}`}
        sub="Se mide en la calle, junto con la empresa, y se anota acá lo que dio. Lo que entra en el acta queda certificado para el pago."
      />
      <FormularioActa
        empresaId={empresaId}
        empresa={regimen.empresa}
        modalidad={regimen.modalidad}
        motivo={regimen.motivo}
        hoy={hoyISO()}
        inspector={sesion.nombre}
        puntos={puntos.map((p) => ({
          itemId: p.itemId,
          ordenId: p.ordenId,
          ordenNumero: p.ordenNumero,
          direccion: p.direccion,
          reportadoEn: p.reportadoEn,
          anchoM: p.anchoM,
          largoM: p.largoM,
          m2Informado: p.m2Informado,
          revisado: p.revisado,
          lat: p.lat,
          lon: p.lon,
          fotos: p.fotos
            .map((f) => ({ momento: f.momento, url: urlFoto(f) }))
            .filter((f): f is { momento: string; url: string } => f.url != null),
        }))}
      />
    </div>
  );
}
