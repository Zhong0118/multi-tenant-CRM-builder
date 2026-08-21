const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function resolveBrowserApiOrigin(
  configuredOrigin: string,
  pageHostname?: string,
): string {
  const origin = new URL(configuredOrigin);
  if (
    pageHostname &&
    LOOPBACK_HOSTS.has(pageHostname) &&
    LOOPBACK_HOSTS.has(origin.hostname)
  ) {
    origin.hostname = pageHostname;
  }
  return origin.origin;
}
