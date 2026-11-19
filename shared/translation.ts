export function translationChunks(
  body: string,
): { start: number; end: number }[] {
  const chunks: { start: number; end: number }[] = [];
  let start = 0;
  while (start < body.length) {
    let end = Math.min(start + 4000, body.length);
    if (end < body.length) {
      const slice = body.slice(start, end);
      let boundary = slice.lastIndexOf("\n\n");
      if (boundary < 1200)
        boundary = Math.max(
          slice.lastIndexOf(". "),
          slice.lastIndexOf("! "),
          slice.lastIndexOf("? "),
        );
      if (boundary > 1200) end = start + boundary + 2;
      // Do not split a UTF-16 surrogate pair.
      if (/[\uD800-\uDBFF]/.test(body[end - 1])) end--;
    }
    chunks.push({ start, end });
    start = end;
  }
  return chunks;
}
import type { Analysis } from "./schema";

export function savedTranslations(
  body: string,
  history: Analysis[],
  preferredModel: string,
) {
  const chunks = translationChunks(body).filter((c) =>
    body.slice(c.start, c.end).trim(),
  );
  const modelNames = [
    ...new Set(
      history.filter((a) => a.kind === "translation").map((a) => a.model),
    ),
  ];
  const models = modelNames
    .map((model) => ({
      model,
      completed: chunks.filter((c) =>
        history.some(
          (a) =>
            a.kind === "translation" &&
            a.model === model &&
            a.start === c.start &&
            a.end === c.end &&
            a.selection === body.slice(c.start, c.end),
        ),
      ).length,
    }))
    .sort(
      (a, b) =>
        b.completed - a.completed ||
        Number(b.model === preferredModel) - Number(a.model === preferredModel),
    );
  const selectedModel =
    models.find((m) => m.completed)?.model ?? preferredModel;
  const saved = chunks.map((c) =>
    history.find(
      (a) =>
        a.kind === "translation" &&
        a.model === selectedModel &&
        a.start === c.start &&
        a.end === c.end &&
        a.selection === body.slice(c.start, c.end),
    ),
  );
  return { chunks, models, selectedModel, saved };
}
