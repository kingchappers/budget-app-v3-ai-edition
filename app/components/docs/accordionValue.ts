// Accordion values end up in aria-controls ids, where a space splits the reference in two.
// Every character outside A-Z, a-z, 0-9 becomes _hex_, so different inputs never share a value.
export function accordionValue(...parts: string[]): string {
  return parts
    .map((part) => Array.from(part).map((c) => (/[A-Za-z0-9]/.test(c) ? c : `_${c.codePointAt(0)!.toString(16)}_`)).join(''))
    .join('-');
}
