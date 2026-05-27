// Cheap UA / header heuristics. The intent is not to stop a determined
// attacker — it's to drop curl/python/wget hammering /key without giving
// them a real auth challenge to optimize against. Anything with a real
// browser fingerprint passes through to origin, where the actual session
// + nonce checks live.

const BLOCKLIST_UA = [
	/python-requests/i,
	/python-urllib/i,
	/aiohttp/i,
	/^curl\//i,
	/^Wget\//i,
	/Go-http-client/i,
	/Java\//i,
	/okhttp/i,
	/libwww-perl/i,
	/scrapy/i,
	/HeadlessChrome/i, // real users on Chrome don't ship "Headless" in their UA
	/PhantomJS/i,
	/PostmanRuntime/i,
	/Insomnia/i,
];

export function isObviousBot(req: Request): boolean {
	const ua = req.headers.get("user-agent") ?? "";
	if (!ua) return true;
	for (const re of BLOCKLIST_UA) if (re.test(ua)) return true;

	// Real browsers always send Accept and Accept-Language. Their absence on
	// a media-key request is a strong signal of a script.
	if (!req.headers.get("accept")) return true;
	if (!req.headers.get("accept-language")) return true;

	return false;
}
