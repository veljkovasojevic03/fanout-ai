/*
 * "Is this IP address on the public internet?" — the core of the SSRF defence
 * for the URL source (spec §5.8).
 *
 * The parsers are deliberately strict and self-contained: an address we cannot
 * parse with certainty is treated as NOT public. Allow-listing global unicast
 * space (rather than block-listing known-bad ranges) means a range we forgot
 * fails closed.
 */

type V4 = readonly [number, number, number, number];

/** Strict dotted-decimal IPv4. No octal, hex, or shortened forms. */
export function parseIPv4(value: string): V4 | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  // "010.0.0.1" is ambiguous (octal in some parsers): refuse it.
  if (match.slice(1).some((part) => part.length > 1 && part.startsWith("0"))) return null;
  return octets as unknown as V4;
}

/** IPv6 as eight 16-bit groups. Handles "::" and an embedded IPv4 tail; rejects zone ids. */
export function parseIPv6(value: string): number[] | null {
  let text = value;
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  if (text.includes("%") || text.length > 45 || !/^[0-9a-fA-F:.]+$/.test(text)) return null;

  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  if (text.includes(".")) {
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (!v4 || lastColon === -1) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    text = text.slice(0, lastColon + 1);
    // Keep a "::" intact; otherwise drop the separator before the IPv4 part.
    if (!text.endsWith("::")) text = text.slice(0, -1);
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };

  const head = parseGroups(halves[0]!);
  const rest = halves.length === 2 ? parseGroups(halves[1]!) : [];
  if (!head || !rest) return null;

  const explicit = head.length + rest.length + tail.length;
  if (halves.length === 2) {
    if (explicit > 7) return null;
    return [...head, ...new Array<number>(8 - explicit).fill(0), ...rest, ...tail];
  }
  return explicit === 8 ? [...head, ...tail] : null;
}

const inRange = (ip: V4, base: V4, bits: number): boolean => {
  const toInt = (o: V4) => ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(base) & mask);
};

/** Everything that is not ordinary public IPv4 unicast (IANA special-purpose registry). */
const BLOCKED_V4: readonly (readonly [V4, number])[] = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, incl. cloud metadata 169.254.169.254
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // documentation
  [[192, 88, 99, 0], 24], // 6to4 relay anycast
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // documentation
  [[203, 0, 113, 0], 24], // documentation
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved + broadcast
];

export function isPublicIPv4(ip: V4): boolean {
  return !BLOCKED_V4.some(([base, bits]) => inRange(ip, base, bits));
}

const v4FromGroups = (high: number, low: number): V4 => [
  high >> 8,
  high & 0xff,
  low >> 8,
  low & 0xff,
];

export function isPublicIPv6(groups: readonly number[]): boolean {
  if (groups.length !== 8) return false;
  const [a, b, c, d, e, f, g, h] = groups as unknown as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  // Addresses that carry an IPv4 address inside them are judged by that address.
  const zeros = (...values: number[]) => values.every((value) => value === 0);
  if (zeros(a, b, c, d, e) && f === 0xffff) return isPublicIPv4(v4FromGroups(g, h)); // ::ffff:0:0/96 mapped
  if (a === 0x64 && b === 0xff9b && zeros(c, d, e, f)) return isPublicIPv4(v4FromGroups(g, h)); // NAT64
  if (a === 0x2002) return isPublicIPv4(v4FromGroups(b, c)); // 6to4

  // Only global unicast (2000::/3) can be public. This excludes ::, ::1,
  // unique-local fc00::/7, link-local fe80::/10, multicast ff00::/8 and
  // IPv4-compatible ::/96 in one rule.
  if ((a & 0xe000) !== 0x2000) return false;

  if (a === 0x2001 && b === 0x0db8) return false; // documentation
  if (a === 0x2001 && b === 0x0000) return false; // Teredo
  if (a === 0x2001 && (b & 0xfff0) === 0x0010) return false; // ORCHID
  if (a === 0x2001 && (b & 0xfff0) === 0x0020) return false; // ORCHIDv2
  if (a === 0x3fff && (b & 0xf000) === 0x0000) return false; // documentation (3fff::/20)

  return true;
}

/** True only for a syntactically valid address that is routable on the public internet. */
export function isPublicAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return isPublicIPv4(v4);
  const v6 = parseIPv6(address);
  return v6 ? isPublicIPv6(v6) : false;
}

/** Whether a URL hostname is an IP literal (as opposed to a DNS name). */
export function isIpLiteral(hostname: string): boolean {
  return parseIPv4(hostname) !== null || parseIPv6(hostname) !== null;
}
