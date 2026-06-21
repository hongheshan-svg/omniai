export function readBearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }

  return header.slice("Bearer ".length).trim() || undefined;
}
