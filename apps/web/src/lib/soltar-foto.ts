"use client";

import { useEffect, type DragEvent } from "react";

/**
 * ARRASTRAR UNA FOTO DESDE WHATSAPP A CUALQUIER CUADRO DE FOTO.
 *
 * Quien carga desde la computadora recibe las fotos de las cuadrillas por
 * WhatsApp, y bajar cada una para volver a subirla era lo lento. Arrastrar se
 * hizo primero solo en «Falta completar» (13/10); el resto de los cuadros
 * —la carga del bache, «Ya lo tapamos», la carga sin orden, Carga rápida—
 * seguían pidiendo el archivo. "Me siguen insistiendo de poder arrastrar
 * desde WhatsApp a la app" (el usuario, 29/10).
 *
 * En el teléfono no cambia nada: tocar el cuadro sigue abriendo la cámara.
 */

/**
 * El archivo de imagen de un arrastre, mirando los dos lados del dataTransfer.
 *
 * Arrastrada desde una carpeta —o desde WhatsApp de escritorio— la imagen llega
 * en `files`. Pero arrastrada DESDE una web (WhatsApp Web) el navegador no la
 * pone en `files` sino en `items`: la misma lectura que hace el pegar con
 * Ctrl+V. Mirando solo `files`, ese arrastre no agarraba nada —y WhatsApp Web
 * cambió a ese camino—. getAsFile() va acá, sincrónico: el dataTransfer no
 * sobrevive al handler.
 */
export function archivoImagen(dt: DataTransfer): File | null {
  const directo = dt.files?.[0];
  if (directo && directo.type.startsWith("image/")) return directo;
  const item = Array.from(dt.items ?? []).find((i) => i.kind === "file" && i.type.startsWith("image/"));
  return item?.getAsFile() ?? null;
}

/** Solo los arrastres que traen un archivo: arrastrar texto no se toca. */
const traeArchivo = (dt: DataTransfer | null) => Boolean(dt && Array.from(dt.types).includes("Files"));

export const NO_ES_FOTO = "Lo que soltaste no es una foto: arrastrá la imagen (JPG, PNG o WEBP).";

/**
 * Lo que se le agrega a un cuadro de foto para que acepte una soltada. Mientras
 * la foto está encima, el cuadro lleva `data-soltando` (lo pinta globals.css):
 * sin una señal, no se sabe si soltarla ahí sirve.
 */
export function soltarFoto(alRecibir: (archivo: File) => void, alFallar?: (mensaje: string) => void) {
  return {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!traeArchivo(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      e.currentTarget.dataset.soltando = "";
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      // Pasar por encima de la miniatura de adentro también "sale" del cuadro.
      if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
      delete e.currentTarget.dataset.soltando;
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      delete e.currentTarget.dataset.soltando;
      if (!traeArchivo(e.dataTransfer)) return;
      e.preventDefault();
      const archivo = archivoImagen(e.dataTransfer);
      if (archivo) alRecibir(archivo);
      else alFallar?.(NO_ES_FOTO);
    },
  };
}

/**
 * Una foto soltada FUERA de un cuadro el navegador la abre en la pestaña, y se
 * pierde todo lo cargado en el formulario: medidas, ubicación, fotos. Con los
 * cuadros invitando a arrastrar, errarle por un centímetro es lo esperable.
 * Mientras el formulario está abierto, soltarla afuera no hace nada.
 */
export function usarSinSoltarAfuera() {
  useEffect(() => {
    const frenar = (e: globalThis.DragEvent) => {
      // Si un cuadro ya la tomó, no hay nada que frenar.
      if (e.defaultPrevented || !traeArchivo(e.dataTransfer)) return;
      e.preventDefault();
      if (e.type === "dragover" && e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", frenar);
    window.addEventListener("drop", frenar);
    return () => {
      window.removeEventListener("dragover", frenar);
      window.removeEventListener("drop", frenar);
    };
  }, []);
}
