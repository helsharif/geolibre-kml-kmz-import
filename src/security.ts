const SAFE_ELEMENTS = new Set([
  "a", "b", "blockquote", "br", "code", "div", "em", "h1", "h2", "h3",
  "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "span",
  "strong", "table", "tbody", "td", "th", "thead", "tr", "u", "ul",
]);

const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "form", "svg", "math"]);

export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value, "https://invalid.local/");
    return ["https:", "http:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function sanitizeHtml(html: string): string {
  // A detached element does not execute scripts and avoids allocating a full
  // HTML document for every Placemark description in large KML files.
  const body = document.createElement("div");
  body.innerHTML = html;
  for (const element of Array.from(body.querySelectorAll("*"))) {
    const tag = element.localName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) {
      element.remove();
      continue;
    }
    if (!SAFE_ELEMENTS.has(tag)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const allowed = (tag === "a" && ["href", "title"].includes(name)) ||
        (tag === "img" && ["src", "alt", "title", "width", "height"].includes(name));
      if (!allowed || name.startsWith("on")) element.removeAttribute(attribute.name);
    }
    for (const attribute of ["href", "src"]) {
      const value = element.getAttribute(attribute);
      if (value && !isSafeExternalUrl(value) && !value.startsWith("data:image/")) element.removeAttribute(attribute);
    }
    if (tag === "a" && element.hasAttribute("href")) {
      element.setAttribute("rel", "noopener noreferrer");
      element.setAttribute("target", "_blank");
    }
  }
  return body.innerHTML;
}

export function escapeHtmlAsText(html: string): string {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
