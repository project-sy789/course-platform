// HMAC-signed media cookie. Minted at the edge after a successful /manifest
// fetch; presented by the player on segment requests so the worker can
// authorize them without a round trip to origin Redis.
//
// Format (URL-safe base64, dot-separated):
//   payload_b64 . hmac_b64
// where payload_b64 = base64url(JSON.stringify({uid, vid, exp})).
//
// `exp` is a unix timestamp in seconds. The cookie is __Host- prefixed
// (Path=/, Secure, no Domain) so it can't be set or read by sibling
// subdomains.

export interface MediaCookiePayload {
	uid: string;
	vid: string;
	exp: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
	const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let s = "";
	for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
	const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
	const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

export async function signMediaCookie(
	payload: MediaCookiePayload,
	secret: string,
): Promise<string> {
	const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
	const key = await hmacKey(secret);
	const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
	return `${body}.${b64urlEncode(sig)}`;
}

export async function verifyMediaCookie(
	token: string,
	secret: string,
): Promise<MediaCookiePayload | null> {
	const dot = token.indexOf(".");
	if (dot < 0) return null;
	const body = token.slice(0, dot);
	const sigPart = token.slice(dot + 1);
	let sig: Uint8Array;
	try {
		sig = b64urlDecode(sigPart);
	} catch {
		return null;
	}
	const key = await hmacKey(secret);
	const ok = await crypto.subtle.verify("HMAC", key, sig, enc.encode(body));
	if (!ok) return null;
	let parsed: MediaCookiePayload;
	try {
		parsed = JSON.parse(dec.decode(b64urlDecode(body)));
	} catch {
		return null;
	}
	if (
		typeof parsed.uid !== "string" ||
		typeof parsed.vid !== "string" ||
		typeof parsed.exp !== "number"
	) {
		return null;
	}
	if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
	return parsed;
}

export function buildSetCookie(
	name: string,
	value: string,
	maxAgeSec: number,
): string {
	// __Host- prefix forces: Secure, Path=/, no Domain. Browser-enforced.
	return [
		`${name}=${value}`,
		"Path=/",
		"Secure",
		"HttpOnly",
		"SameSite=Strict",
		`Max-Age=${maxAgeSec}`,
	].join("; ");
}

export function readCookie(
	header: string | null,
	name: string,
): string | null {
	if (!header) return null;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq < 0) continue;
		const k = part.slice(0, eq).trim();
		if (k === name) return part.slice(eq + 1).trim();
	}
	return null;
}
