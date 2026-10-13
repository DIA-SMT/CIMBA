-- ═══════════════════════════════════════════════════════════════════════════
-- LA HUELLA DE CADA FOTO
--
-- "¿Puede saltar una alarma por fotos duplicadas?" (Dirección de Bacheo,
-- 12/10/2026). Para saber si una foto ya se usó en otro bache no alcanza con
-- comparar los archivos: la misma foto reenviada por WhatsApp o recomprimida
-- por el teléfono es otro archivo, byte por byte.
--
-- La huella es un resumen de 64 bits de cómo se ve la imagen (dHash: se
-- achica a 9×8 en grises y se anota, renglón por renglón, si cada punto es
-- más claro que el de al lado). Dos fotos que se ven iguales dan huellas que
-- difieren en pocos bits aunque una esté recomprimida o achicada; dos fotos
-- distintas difieren en ~30. La distancia se mide con bit_count(a # b).
--
-- Solo agrega una columna vacía. No cambia ni mueve ninguna fila. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

alter table fotografias add column if not exists huella bit(64);

comment on column fotografias.huella is
  'dHash de 64 bits de la imagen, para detectar la misma foto usada en dos baches (ver lib/huella-foto.ts)';
