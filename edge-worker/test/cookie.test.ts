import { describe, expect, it } from "vitest";
import {
	signMediaCookie,
	verifyMediaCookie,
	readCookie,
} from "../src/cookie";

const SECRET = "test-secret-do-not-use-in-prod";

describe("media cookie", () => {
	it("round-trips a valid payload", async () => {
		const exp = Math.floor(Date.now() / 1000) + 60;
		const tok = await signMediaCookie(
			{ uid: "u1", vid: "v1", exp },
			SECRET,
		);
		const out = await verifyMediaCookie(tok, SECRET);
		expect(out).toEqual({ uid: "u1", vid: "v1", exp });
	});

	it("rejects a tampered body", async () => {
		const exp = Math.floor(Date.now() / 1000) + 60;
		const tok = await signMediaCookie(
			{ uid: "u1", vid: "v1", exp },
			SECRET,
		);
		const [, sig] = tok.split(".");
		// re-encode a different payload, keep the original signature
		const bad =
			btoa(JSON.stringify({ uid: "u1", vid: "v2", exp }))
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/, "") +
			"." +
			sig;
		expect(await verifyMediaCookie(bad, SECRET)).toBeNull();
	});

	it("rejects an expired payload", async () => {
		const exp = Math.floor(Date.now() / 1000) - 1;
		const tok = await signMediaCookie(
			{ uid: "u1", vid: "v1", exp },
			SECRET,
		);
		expect(await verifyMediaCookie(tok, SECRET)).toBeNull();
	});

	it("rejects a different secret", async () => {
		const exp = Math.floor(Date.now() / 1000) + 60;
		const tok = await signMediaCookie(
			{ uid: "u1", vid: "v1", exp },
			SECRET,
		);
		expect(await verifyMediaCookie(tok, "other-secret")).toBeNull();
	});
});

describe("readCookie", () => {
	it("finds the named cookie", () => {
		const h = "foo=1; __Host-cp-media=abc.def; bar=2";
		expect(readCookie(h, "__Host-cp-media")).toBe("abc.def");
	});
	it("returns null when absent", () => {
		expect(readCookie("foo=1", "__Host-cp-media")).toBeNull();
		expect(readCookie(null, "__Host-cp-media")).toBeNull();
	});
});
