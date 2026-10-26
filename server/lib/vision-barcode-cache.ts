/**
 * Что из распознанного по фото можно положить в общий кэш штрихкодов.
 *
 * `barcode_products` общий на весь бот: запись отдаётся каждому, кто сканирует
 * этот штрихкод. Поэтому туда попадает только сырой ответ vision:
 *
 * - на фото одна позиция — иначе непонятно, какой из продуктов под штрихкодом;
 * - пользователь ничего в карточке не правил (поля, вес): правка — это его
 *   порция и его поправки, а не свойства продукта;
 * - запись из Open Food Facts не перезаписывается — это делает сам upsert
 *   (`storage.upsertVisionBarcodeProduct`, условие `source = 'vision'`).
 */

type CardLike = Record<string, any>;

/** Пометить карточки штрихкодом, если vision вернул ровно одну позицию. */
export function tagVisionBarcode<T extends CardLike>(items: T[], barcode: string | null | undefined): T[] {
  if (!barcode || items.length !== 1) return items;
  const item = items[0] as CardLike;
  item.barcode = barcode;
  item.barcodeSource = "vision";
  return items;
}

/** Вызывать при любой правке карточки до подтверждения. */
export function markUserEdited<T extends CardLike>(item: T): T {
  (item as CardLike).userEdited = true;
  return item;
}

export function shouldCacheVisionBarcode(item: CardLike | null | undefined): boolean {
  if (!item) return false;
  if (item.barcodeSource !== "vision" || !item.barcode) return false;
  if (item.userEdited) return false;
  return true;
}
