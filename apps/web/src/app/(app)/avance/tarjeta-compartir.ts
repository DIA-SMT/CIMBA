"use client";

import type { Map as MapaLibre } from "maplibre-gl";
import { etiquetaVentana, nombreRecorte, type DatosAvance, type DiasVentana } from "@/lib/avance-tipos";
import { colorDeEmpresa } from "@/lib/color-empresa";
import { numero } from "@/lib/formato";

/**
 * LA TARJETA PARA WHATSAPP: una imagen con el mapa tal como se lo está viendo
 * y, encima, las cifras del período, quién produjo y la fecha. Se arma en el
 * navegador con un canvas —el del mapa más una capa de texto— así que no hay
 * servidor de render ni clave de nadie: lo que se ve es lo que se manda.
 *
 * Es honesta a propósito: al pie dice cuántos pedidos siguen en cola. Una
 * tarjeta que solo muestre lo hecho es propaganda; con el pendiente al lado
 * es gestión.
 */

const W = 1600;
const H = 1000;

/** La tipografía real de la página (la de next/font tiene un nombre generado). */
function fuente(): string {
  const familia = getComputedStyle(document.body).fontFamily.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  return familia ? `"${familia}", system-ui, sans-serif` : "system-ui, sans-serif";
}

function cargarImagen(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolver) => {
    const img = new Image();
    img.onload = () => resolver(img);
    img.onerror = () => resolver(null);
    img.src = src;
  });
}

function redondeado(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function generarTarjeta(opciones: {
  mapa: MapaLibre;
  datos: DatosAvance;
  dias: DiasVentana;
  empresa: string | null;
}): Promise<Blob> {
  const { mapa, datos, dias, empresa } = opciones;
  await document.fonts.ready;

  /* Un cuadro fresco del mapa: se pide un repintado y se espera a que termine
     antes de copiar el canvas (el mapa se creó con preserveDrawingBuffer). */
  await new Promise<void>((listo) => {
    mapa.once("render", () => listo());
    mapa.triggerRepaint();
  });

  const lienzo = document.createElement("canvas");
  lienzo.width = W;
  lienzo.height = H;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("Este navegador no puede armar la imagen.");
  const f = fuente();

  // 1. El mapa, cubriendo todo el lienzo (recorte centrado, sin deformar).
  const cv = mapa.getCanvas();
  const escala = Math.max(W / cv.width, H / cv.height);
  const dw = cv.width * escala;
  const dh = cv.height * escala;
  ctx.fillStyle = "#0b0f16";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(cv, (W - dw) / 2, (H - dh) / 2, dw, dh);

  // 2. La banda oscura de abajo, donde va lo que se lee.
  const banda = ctx.createLinearGradient(0, H * 0.45, 0, H);
  banda.addColorStop(0, "rgba(7,10,16,0)");
  banda.addColorStop(0.35, "rgba(7,10,16,0.82)");
  banda.addColorStop(1, "rgba(7,10,16,0.97)");
  ctx.fillStyle = banda;
  ctx.fillRect(0, H * 0.45, W, H * 0.55);

  // 3. La marca, arriba a la izquierda, sobre un chip oscuro.
  const iso = await cargarImagen("/marca/isotipo-smt-blanco.png");
  ctx.fillStyle = "rgba(7,10,16,0.82)";
  redondeado(ctx, 40, 40, 560, 96, 22);
  ctx.fill();
  if (iso) ctx.drawImage(iso, 62, 58, 60, 60);
  ctx.fillStyle = "#edf2fa";
  ctx.font = `800 40px ${f}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("CIMBA", 140, 96);
  const anchoCimba = ctx.measureText("CIMBA").width;
  ctx.fillStyle = "#f4dc00";
  ctx.fillText(".", 140 + anchoCimba, 96);
  ctx.fillStyle = "#8fa3bf";
  ctx.font = `600 15px ${f}`;
  ctx.fillText("AVANCE DE BACHEO · SAN MIGUEL DE TUCUMÁN", 141, 120);

  // 4. La fecha, arriba a la derecha.
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hora = ahora.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(7,10,16,0.82)";
  redondeado(ctx, W - 40 - 520, 40, 520, 96, 22);
  ctx.fill();
  ctx.fillStyle = "#edf2fa";
  ctx.font = `700 26px ${f}`;
  ctx.fillText(fecha.charAt(0).toUpperCase() + fecha.slice(1), W - 66, 84);
  ctx.fillStyle = "#8fa3bf";
  ctx.font = `500 18px ${f}`;
  ctx.fillText(`${hora} hs · datos en vivo del sistema CIMBA`, W - 66, 116);
  ctx.textAlign = "left";

  // 5. Las cifras.
  const c = datos.cifras.ventana;
  const fila = empresa ? datos.porEmpresa.find((e) => e.empresa === empresa) : null;
  const n = fila ? fila.n : c.n;
  const m2 = fila ? fila.m2 : c.m2;
  const t = fila ? fila.toneladas : c.toneladas;
  const titulo = [etiquetaVentana(dias, datos.cifras.total.desde), nombreRecorte(datos.territorio), empresa]
    .filter(Boolean)
    .join("  ·  ")
    .toUpperCase();

  let y = 640;
  ctx.fillStyle = "#2eb1ff";
  ctx.font = `700 22px ${f}`;
  ctx.fillText(titulo, 60, y);

  y += 118;
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 132px ${f}`;
  const cifra = numero(n);
  ctx.fillText(cifra, 56, y);
  const anchoCifra = ctx.measureText(cifra).width;
  ctx.fillStyle = "#8fa3bf";
  ctx.font = `700 44px ${f}`;
  ctx.fillText(n === 1 ? "bache reparado" : "baches reparados", 56 + anchoCifra + 28, y);

  y += 74;
  ctx.fillStyle = "#2eb1ff";
  ctx.font = `800 52px ${f}`;
  const m2Texto = `${numero(m2)} m²`;
  ctx.fillText(m2Texto, 58, y);
  const anchoM2 = ctx.measureText(m2Texto).width;
  ctx.fillStyle = "#c9d4e5";
  ctx.font = `500 30px ${f}`;
  const detalle = [
    t > 0 ? `${numero(t)} t de mezcla asfáltica` : null,
    !empresa && c.empresas > 0 ? `${numero(c.empresas)} ${c.empresas === 1 ? "empresa" : "empresas"}` : null,
    c.vecinos > 0 ? `${numero(c.vecinos)} ${c.vecinos === 1 ? "vecino" : "vecinos"} con su pedido cerrado` : null,
  ]
    .filter(Boolean)
    .join("   ·   ");
  ctx.fillText(detalle, 58 + anchoM2 + 30, y - 6);

  // 6. Quién produjo: hasta seis chips con su color.
  const empresas = (empresa ? datos.porEmpresa.filter((e) => e.empresa === empresa) : datos.porEmpresa).slice(0, 6);
  y += 70;
  let x = 60;
  ctx.font = `600 22px ${f}`;
  for (const e of empresas) {
    const texto = `${e.empresa}  ${e.m2 > 0 ? `${numero(e.m2)} m²` : `${numero(e.n)} baches`}`;
    const ancho = ctx.measureText(texto).width + 58;
    if (x + ancho > W - 60) break;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    redondeado(ctx, x, y - 30, ancho, 44, 22);
    ctx.fill();
    ctx.fillStyle = colorDeEmpresa(e.empresa);
    ctx.beginPath();
    ctx.arc(x + 24, y - 8, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#edf2fa";
    ctx.fillText(texto, x + 42, y);
    x += ancho + 12;
  }

  // 7. El pie: lo pendiente, porque es gestión y no propaganda; y la fuente.
  ctx.fillStyle = "#8fa3bf";
  ctx.font = `500 21px ${f}`;
  ctx.fillText(
    `Siguen en cola ${numero(datos.cifras.pendientes.pedidos)} pedidos de vecinos y ${numero(datos.cifras.ahora.ordenesActivas)} órdenes activas en la calle.`,
    60,
    H - 44,
  );
  ctx.textAlign = "right";
  ctx.fillText("Municipalidad de San Miguel de Tucumán", W - 60, H - 44);
  ctx.textAlign = "left";

  return new Promise<Blob>((resolver, rechazar) => {
    lienzo.toBlob((b) => (b ? resolver(b) : rechazar(new Error("No se pudo armar la imagen."))), "image/png");
  });
}

/** Nombre de archivo con la fecha: avance-2026-09-22.png */
export function nombreDeArchivo(datos: DatosAvance): string {
  const recorte = datos.territorio ? `-${datos.territorio.nombre.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}` : "";
  return `avance${recorte}-${datos.hoy}.png`;
}

export function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** En el teléfono, directo a WhatsApp con la hoja de compartir del sistema. */
export function puedeCompartirArchivos(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([new Blob()], "x.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

export async function compartirArchivo(blob: Blob, nombre: string, texto: string): Promise<boolean> {
  const archivo = new File([blob], nombre, { type: "image/png" });
  try {
    await navigator.share({ files: [archivo], title: "Avance de bacheo", text: texto });
    return true;
  } catch {
    return false;
  }
}
