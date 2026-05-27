// Sliding-window per-IP rate limiter on top of Workers KV.
//
// Algorithm: each request bumps a counter keyed by (ip, scope, window-start),
// where the window-start is `floor(now / 60s) * 60s`. We read both the
// current and previous minute's counter, weight them by how far into the
// current window we are, and compare to the limit.
//
// Why KV (not a Durable Object)? KV is eventually consistent across regions
// (~30s), which is fine for "is this IP hammering us?" — false-negatives
// across regions are bounded by the propagation window, false-positives are
// impossible. A DO would be strictly more accurate but adds latency to every
// request and creates a single-point bottleneck per IP. For traffic shaping
// in front of an origin that ALSO does its own per-(user, video) limit, KV
// is the right cost/accuracy tradeoff.

export interface RateLimitResult {
	allowed: boolean;
	count: number;
	limit: number;
	retryAfterSec: number;
}

const WINDOW_SEC = 60;

export async function rateLimit(
	kv: KVNamespace,
	ip: string,
	scope: string,
	limit: number,
): Promise<RateLimitResult> {
	if (limit <= 0) return { allowed: true, count: 0, limit, retryAfterSec: 0 };

	const now = Math.floor(Date.now() / 1000);
	const curWindow = Math.floor(now / WINDOW_SEC) * WINDOW_SEC;
	const prevWindow = curWindow - WINDOW_SEC;
	const elapsed = now - curWindow;
	const prevWeight = (WINDOW_SEC - elapsed) / WINDOW_SEC;

	const curKey = `rl:${scope}:${ip}:${curWindow}`;
	const prevKey = `rl:${scope}:${ip}:${prevWindow}`;

	const [curStr, prevStr] = await Promise.all([
		kv.get(curKey),
		kv.get(prevKey),
	]);
	const curCount = curStr ? parseInt(curStr, 10) || 0 : 0;
	const prevCount = prevStr ? parseInt(prevStr, 10) || 0 : 0;

	const weighted = curCount + prevCount * prevWeight;
	if (weighted >= limit) {
		// At the limit — don't bump (saves a KV write under a flood).
		return {
			allowed: false,
			count: Math.ceil(weighted),
			limit,
			retryAfterSec: WINDOW_SEC - elapsed,
		};
	}

	// Bump current window. expirationTtl is 2*WINDOW_SEC so the previous
	// window stays readable for the full sliding range.
	await kv.put(curKey, String(curCount + 1), {
		expirationTtl: WINDOW_SEC * 2,
	});

	return {
		allowed: true,
		count: Math.ceil(weighted) + 1,
		limit,
		retryAfterSec: 0,
	};
}
