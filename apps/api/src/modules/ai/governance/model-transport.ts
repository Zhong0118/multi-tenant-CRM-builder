import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent } from 'undici';

export class ModelConnectionError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus?: number,
  ) {
    super(code);
  }
}

function publicAddress(address: string) {
  if (!isIP(address) || address.includes('%')) return false;
  const ip = ipaddr.parse(address);
  if (ip.range() !== 'unicast') return false;
  if (ip instanceof ipaddr.IPv4) {
    // The dependency's older special-purpose registry omits benchmarking networks.
    return !(ip.octets[0] === 198 && [18, 19].includes(ip.octets[1]));
  }
  // Only allocated global unicast. Exclude protocol assignments and documentation.
  return (
    (ip.parts[0] & 0xe000) === 0x2000 &&
    !(ip.parts[0] === 0x2001 && ip.parts[1] < 0x200) &&
    !(ip.parts[0] === 0x3fff && (ip.parts[1] & 0xf000) === 0)
  );
}

export function normalizeModelBaseURL(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ModelConnectionError('INVALID_ENDPOINT');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    /[?#]/.test(url.href)
  )
    throw new ModelConnectionError('INVALID_ENDPOINT');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !publicAddress(host))
    throw new ModelConnectionError('NON_PUBLIC_ENDPOINT');
  return url.href.replace(/\/+$/, '');
}

export async function resolvePublicAddresses(
  host: string,
  resolver: (
    host: string,
    options: { all: true },
  ) => Promise<LookupAddress[]> = lookup,
) {
  const answers = await resolver(host, { all: true });
  if (!answers.length || answers.some((a) => !publicAddress(a.address)))
    throw new ModelConnectionError('NON_PUBLIC_ENDPOINT');
  return answers;
}

// net.connect consumes the lookup callback's answers directly. TLS retains the
// original hostname for SNI and certificate verification on every new socket.
const dispatcher = new Agent({
  connect: {
    timeout: 5000,
    lookup(host, options, callback) {
      void resolvePublicAddresses(host)
        .then((all) => {
          const answers = all.filter(
            (a) => !options.family || a.family === options.family,
          );
          if (!answers.length) throw new ModelConnectionError('DNS_FAILED');
          if (options.all) callback(null, answers);
          else callback(null, answers[0].address, answers[0].family);
        })
        .catch((error: Error) => callback(error, '', 0));
    },
  },
});

export const modelFetch: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  normalizeModelBaseURL(url);
  const options = { ...init, redirect: 'manual' as const, dispatcher };
  const response = await fetch(input, options);
  if (response.ok) return response;
  await response.body?.cancel().catch(() => undefined);
  if (response.status >= 300 && response.status < 400)
    throw new ModelConnectionError('REDIRECT_DENIED', response.status);
  // Discard arbitrary upstream error text and headers before the SDK sees them.
  return new Response(null, { status: response.status });
};
