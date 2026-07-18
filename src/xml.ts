export function elementChildren(parent: ParentNode): Element[] {
  return Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1);
}

export function localName(element: Element): string {
  return element.localName || element.nodeName.split(":").at(-1) || element.nodeName;
}

export function childrenNamed(parent: ParentNode, name: string): Element[] {
  return elementChildren(parent).filter((child) => localName(child) === name);
}

export function firstChild(parent: ParentNode, name: string): Element | undefined {
  return childrenNamed(parent, name)[0];
}

export function descendantsNamed(parent: ParentNode, name: string): Element[] {
  return Array.from(parent.querySelectorAll("*")).filter((element) => localName(element) === name);
}

export function textOf(parent: ParentNode, name: string): string | undefined {
  const value = firstChild(parent, name)?.textContent?.trim();
  return value || undefined;
}

export function numberOf(parent: ParentNode, name: string): number | undefined {
  const value = Number(textOf(parent, name));
  return Number.isFinite(value) ? value : undefined;
}

export function booleanOf(parent: ParentNode, name: string): boolean | undefined {
  const value = textOf(parent, name);
  if (value === undefined) return undefined;
  return value === "1" || value.toLowerCase() === "true";
}

export function parseXml(xml: string): Document {
  if (xml.length === 0) throw new Error("The KML file is empty.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("KML containing DOCTYPE or entity declarations is not accepted for security reasons.");
  }
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const error = document.querySelector("parsererror");
  if (error) throw new Error(`Invalid KML XML: ${error.textContent?.trim() || "parser error"}`);
  const root = document.documentElement;
  if (!root || localName(root) !== "kml") throw new Error("The XML document does not have a KML root element.");
  return document;
}
