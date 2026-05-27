// Edge gateway for the course platform.
//
// Sits between Cloudflare and the Hetzner origin. Three jobs:
//
//   1. Per-IP edge rate limit on the expensive media endpoints (key, manifest)
//      so a botnet can't exhaust the origin's Redis / DB. The origin still
//      does its own per-(user, video) limit — this is just the first wall.
//
//   2. UA bot block on the same endpoints. Cheap heuristic, drops anything
//      that obviously isn't a browser before it reaches Hetzner.
//
//   3. Mint a short-lived HMAC-signed media cookie on the response to
//      /manifest. Segment URLs that go through /edge/segment/* validate
//      that cookie at the edge — no origin call needed per segment.
//
// What the worker does NOT do:
//   - It does NOT see plaintext AES-128 video keys. The /key endpoint is
//     proxied to origin; the worker only sees the origin's response body
//     in transit. KEK + envelope decryption stay at origin where they belong.
//   - It does NOT replace the origin's session/nonce checks. Those are still
//     authoritative. The worker is a strictly-additive layer of defense.

import { isObviousBot } from "./bot";
import { rateLimit } from "./ratelimit";
import {
	buildSetCookie,
	readCookie,
	signMediaCookie,
	verifyMediaCookie,
} from "./cookie";

export interface Env {
	EDGE_RL: KVNamespace;
	HMAC_SECRET: string;
	ORIGIN_HOST: string;
	RL_KEY_PER_MIN: string;
	RL_MANIFEST_PER_MIN: string;
	RL_DEFAULT_PER_MIN: string;
	MEDIA_COOKIE_TTL_SEC: string;
	MEDIA_COOKIE_NAME: string;
	MEDIA?: R2Bucket; // optional — only bound if segments route through worker
}

const KEY_RE = /^\/api\/v1\/videos\/([^/]+)\/key$/;
const MANIFEST_RE = /^\/api\/v1\/videos\/([^/]+)\/(manifest|sub-manifest)$/;
const SEGMENT_RE = /^\/edge\/segment\/([^/]+)\/(.+)$/;

function clientIp(req: Request): string {
	return req.headers.get("cf-connecting-ip") ?? "0.0.0.0";
}

function tooMany(retryAfterSec: number): Response {
	return new Response("rate limited", {
		status: 429,
		headers: { "Retry-After": String(Math.max(1, retryAfterSec)) },
	});
}

function botBlocked(): Response {
	return new Response("forbidden", { status: 403 });
}

async function proxyToOrigin(req: Request, env: Env): Promise<Response> {
	const url = new URL(req.url);
	url.host = env.ORIGIN_HOST;
	// Preserve scheme as https — origin must terminate TLS (Caddy does).
	url.protocol = "https:";
	const init: RequestInit = {
		method: req.method,
		headers: req.headers,
		body:
			req.method === "GET" || req.method === "HEAD"
				? undefined
				: req.body,
		redirect: "manual",
	};
	// Cloudflare-specific: cap connection reuse so a flapping origin doesn't
	// pin the worker to a bad colo.
	const cfInit: RequestInit & { cf?: IncomingRequestCfProperties } = {
		...init,
		cf: { cacheTtl: 0, cacheEverything: false },
	};
	return fetch(url.toString(), cfInit);
}

async function handleManifest(
	req: Request,
	env: Env,
	videoId: string,
): Promise<Response> {
	if (isObviousBot(req)) return botBlocked();

	const ip = clientIp(req);
	const rl = await rateLimit(
		env.EDGE_RL,
		ip,
		"manifest",
		parseInt(env.RL_MANIFEST_PER_MIN, 10),
	);
	if (!rl.allowed) return tooMany(rl.retryAfterSec);

	const upstream = await proxyToOrigin(req, env);
	if (upstream.status !== 200) return upstream;

	// Origin echoes the authenticated user id back on this header so the
	// worker can mint a per-(user, video) cookie without parsing the body.
	// See backend/app/routers/videos.py — manifest response sets X-Cp-Uid.
	const uid = upstream.headers.get("x-cp-uid");
	const headers = new Headers(upstream.headers);
	headers.delete("x-cp-uid");

	if (uid) {
		const ttl = parseInt(env.MEDIA_COOKIE_TTL_SEC, 10);
		const exp = Math.floor(Date.now() / 1000) + ttl;
		const token = await signMediaCookie(
			{ uid, vid: videoId, exp },
			env.HMAC_SECRET,
		);
		headers.append(
			"Set-Cookie",
			buildSetCookie(env.MEDIA_COOKIE_NAME, token, ttl),
		);
	}

	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers,
	});
}

async function handleKey(
	req: Request,
	env: Env,
	_videoId: string,
): Promise<Response> {
	if (isObviousBot(req)) return botBlocked();

	const ip = clientIp(req);
	const rl = await rateLimit(
		env.EDGE_RL,
		ip,
		"key",
		parseInt(env.RL_KEY_PER_MIN, 10),
	);
	if (!rl.allowed) return tooMany(rl.retryAfterSec);

	return proxyToOrigin(req, env);
}

async function handleSegment(
	req: Request,
	env: Env,
	videoId: string,
	objectKey: string,
): Promise<Response> {
	const cookieHeader = req.headers.get("cookie");
	const token = readCookie(cookieHeader, env.MEDIA_COOKIE_NAME);
	if (!token) return new Response("no media cookie", { status: 401 });

	const payload = await verifyMediaCookie(token, env.HMAC_SECRET);
	if (!payload) return new Response("bad cookie", { status: 401 });
	if (payload.vid !== videoId) {
		return new Response("cookie not for this video", { status: 403 });
	}

	if (!env.MEDIA) {
		// R2 binding not configured — operator hasn't switched segments to
		// the edge path yet. Fall back to passing through to origin, which
		// will return a presigned R2 URL (existing behavior).
		return proxyToOrigin(req, env);
	}

	const obj = await env.MEDIA.get(objectKey);
	if (!obj) return new Response("not found", { status: 404 });

	const headers = new Headers();
	headers.set("Content-Type", "video/mp2t");
	headers.set("Cache-Control", "private, max-age=10");
	headers.set("X-Content-Type-Options", "nosniff");
	return new Response(obj.body, { status: 200, headers });
}

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);
		const path = url.pathname;

		const mKey = KEY_RE.exec(path);
		if (mKey) return handleKey(req, env, mKey[1]!);

		const mManifest = MANIFEST_RE.exec(path);
		if (mManifest) return handleManifest(req, env, mManifest[1]!);

		const mSeg = SEGMENT_RE.exec(path);
		if (mSeg) return handleSegment(req, env, mSeg[1]!, mSeg[2]!);

		// Catch-all rate limit, mostly to slow down credential stuffing on
		// /auth/login. Origin still has its own per-IP guard.
		const ip = clientIp(req);
		const rl = await rateLimit(
			env.EDGE_RL,
			ip,
			"default",
			parseInt(env.RL_DEFAULT_PER_MIN, 10),
		);
		if (!rl.allowed) return tooMany(rl.retryAfterSec);

		return proxyToOrigin(req, env);
	},
} satisfies ExportedHandler<Env>;
