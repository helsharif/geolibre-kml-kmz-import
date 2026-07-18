import type { NetworkLinkInfo } from "./types";
import { firstChild, textOf } from "./xml";

export function parseNetworkLink(element: Element, folderPath: string): NetworkLinkInfo {
  const link = firstChild(element, "Link") ?? firstChild(element, "Url");
  const href = link ? textOf(link, "href") : undefined;
  let kind: NetworkLinkInfo["kind"] = "missing";
  if (href) {
    try {
      const url = new URL(href);
      kind = url.protocol === "https:" || url.protocol === "http:" ? "https" : "unsafe";
    } catch {
      kind = /\.(?:kml|kmz)(?:[?#].*)?$/i.test(href) ? "archive" : "unsafe";
    }
  }
  return { name: textOf(element, "name") ?? "Network link", href, folderPath, kind };
}
