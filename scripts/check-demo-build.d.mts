export function readMarker(markerSourceText: string): string;
export function findMarkerFiles(dir: string, marker: string): string[];
export function findServerOnlyCode(dir: string): string[];
export function findExternalReferences(dir: string): string[];
export function inlineScriptHashes(html: string): string[];
export function buildCspHeader(hashes: string[]): string;
export function buildHeadersFile(csp: string): string;
