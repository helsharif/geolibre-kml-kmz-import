function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  };
  let decoded = value;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decoded.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const code = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      if (entity.startsWith("#")) {
        const code = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return named[entity.toLowerCase()] ?? match;
    });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function cellText(html: string): string {
  const withoutMarkup = html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\t\r ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
  return decodeEntities(withoutMarkup);
}

/** Extracts the two-column attribute tables commonly emitted by Google Earth and GIS exporters. */
export function extractDescriptionFields(html: string): Record<string, string> | undefined {
  const fields: Record<string, string> = {};
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowPattern.exec(html))) {
    const cells = [...row[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)];
    if (cells.length < 2) continue;
    const key = cellText(cells[0]![1] ?? "");
    const value = cellText(cells.slice(1).map((cell) => cell[1] ?? "").join(" "));
    if (!key) continue;
    let uniqueKey = key;
    let suffix = 2;
    while (Object.hasOwn(fields, uniqueKey)) uniqueKey = `${key} (${suffix++})`;
    fields[uniqueKey] = value;
  }
  if (Object.keys(fields).length === 0) {
    for (const match of html.matchAll(/<b\b[^>]*>([\s\S]*?)<\/b>/gi)) {
      const text = cellText(match[1] ?? "");
      const separator = text.indexOf(":");
      if (separator < 1) continue;
      const key = text.slice(0, separator).trim();
      const value = text.slice(separator + 1).trim();
      if (key && value) fields[key] = value;
    }
  }
  return Object.keys(fields).length ? fields : undefined;
}
