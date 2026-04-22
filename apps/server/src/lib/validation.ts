export const CUID_RE = /^c[a-z0-9]{20,}$/

export function isValidCuid(id: string): boolean {
  return CUID_RE.test(id)
}
