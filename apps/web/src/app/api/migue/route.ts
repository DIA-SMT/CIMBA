import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { leerSesion } from "@/lib/auth";
import { iaDisponible } from "@/lib/ia";
import { conversarConMigue } from "@/lib/migue-conversar";
import { mensajeDeError } from "@/lib/errores";

export const maxDuration = 60;

/**
 * Migue conversacional sobre los datos de bacheo: loop de tool-calling
 * (máx. 5 rondas) contra herramientas de solo lectura. La sesión CIMBA es
 * obligatoria; las consultas corren con los claims del usuario (RLS).
 */

const entradaSchema = z.object({
  mensajes: z
    .array(
      z.object({
        rol: z.enum(["usuario", "migue"]),
        contenido: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(30),
  // El estado del mapa al momento de preguntar (lo publica mapa-cimba y lo
  // adjunta el chat). Whitelist estricta: viene del navegador.
  contextoMapa: z
    .object({
      vista: z.enum(["hoy", "brecha", "historial"]),
      colas: z.array(z.enum(["bacheo", "sat", "ingenieria"])).max(3),
      fuentesApagadas: z.array(z.string().max(40)).max(12),
      tiposApagados: z.array(z.string().max(40)).max(12),
      periodoDias: z.number().int().positive().max(3650).nullable(),
      distritoFoco: z.number().int().positive().nullable(),
      filtroBrecha: z.string().max(30).nullable(),
      riesgoPrendido: z.boolean(),
      enPantalla: z
        .object({ pendientes: z.number().int().min(0), sinAtencion: z.number().int().min(0), m2Hechos: z.number().min(0) })
        .nullable(),
    })
    .nullish(),
});

/** El contexto del mapa, contado en criollo para el sistema de Migue. */
function describirContexto(c: NonNullable<z.infer<typeof entradaSchema>["contextoMapa"]>): string {
  const partes = [
    `vista ${c.vista.toUpperCase()}`,
    `colas prendidas: ${c.colas.join(", ") || "ninguna"}`,
  ];
  if (c.fuentesApagadas.length > 0) partes.push(`fuentes apagadas: ${c.fuentesApagadas.join(", ")}`);
  if (c.tiposApagados.length > 0) partes.push(`tipos apagados: ${c.tiposApagados.join(", ")}`);
  if (c.periodoDias) partes.push(`período: últimos ${c.periodoDias} días`);
  if (c.distritoFoco) partes.push(`enfocado en el distrito ${c.distritoFoco}`);
  if (c.filtroBrecha) partes.push(`aislando la categoría "${c.filtroBrecha.replaceAll("_", " ")}"`);
  if (c.riesgoPrendido) partes.push("con la capa de riesgo preventivo prendida");
  if (c.enPantalla) {
    partes.push(
      `y EN PANTALLA hay ${c.enPantalla.pendientes} pedidos pendientes (${c.enPantalla.sinAtencion} sin atención) y ${Math.round(c.enPantalla.m2Hechos)} m² hechos`,
    );
  }
  return (
    "CONTEXTO VIVO: el usuario está mirando el mapa con " + partes.join(" · ") + ". " +
    "Si la pregunta se refiere a «esto», «acá», «lo que veo» o no aclara el universo, contestá SOBRE ESE RECORTE: " +
    "usá los números de EN PANTALLA cuando alcancen, aplicá estos filtros en las herramientas cuando las uses " +
    "(destino, fuente, tipo, barrio) y ACLARÁ siempre en una frase qué recorte estás contestando. " +
    "Si el usuario pregunta explícitamente por el total de la ciudad, ignorá el recorte y decilo."
  );
}

export async function POST(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  if (!iaDisponible()) return NextResponse.json({ error: "IA no configurada" }, { status: 501 });

  const cuerpo = entradaSchema.safeParse(await req.json());
  if (!cuerpo.success) return NextResponse.json({ error: "mensajes inválidos" }, { status: 400 });

  const contexto = cuerpo.data.contextoMapa;
  try {
    const r = await conversarConMigue(
      sesion,
      cuerpo.data.mensajes,
      contexto ? describirContexto(contexto) : undefined,
    );
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: mensajeDeError(e, "Migue no pudo responder") }, { status: 502 });
  }
}
