import type { Claim, Color } from "../../shared/cards";
import { isNumber } from "../../shared/cards";
import type { Dict } from "./i18n";

export function claimText(t: Dict, c: Claim, chosen?: Color | null): string {
  if (c.value === "wild4" || c.value === "wlc") {
    const base = t.valueNames[c.value];
    return chosen ? `${base} · ${t.colorNames[chosen]}` : base;
  }
  const color = c.color ? t.colorNames[c.color] : "";
  const value = isNumber(c.value) ? c.value : t.valueNames[c.value];
  return `${color} ${value}`;
}

export const colorText = (t: Dict, c: Color) => t.colorNamesLong[c];
