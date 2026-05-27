// Mock backend for demo / design-review without running the real FastAPI
// stack. Active when NEXT_PUBLIC_API_BASE is unset OR NEXT_PUBLIC_MOCK=1.
//
// Demo credentials (typed into /login):
//   admin@example.com / admin1234   → ผู้ดูแลระบบ (เห็นทุกหน้า /admin)
//   user@example.com  / user1234    → ผู้ใช้ทั่วไป
//   ใส่อะไรก็ได้                     → จะกลายเป็นผู้ใช้ทั่วไปอัตโนมัติ
//
// State that "sticks" (in localStorage):
//   - currently signed-in user
//   - tax-info edits
//   - courses created via the admin form
//   - slips approved/rejected by admin
// Everything else resets on reload.

const STORE_KEY = "course-platform.mock-state.v1";

type MockUser = {
	id: string;
	email: string;
	password: string;
	is_admin: boolean;
	is_active: boolean;
	email_verified: boolean;
	created_at: string;
};

type MockCourse = {
	id: string;
	slug: string;
	title: string;
	description: string;
	price_cents: number;
	access_duration_days: number | null;
	pixel_watermark: boolean;
	lessons: { id: string; title: string; position: number; is_preview: boolean; video_id: string }[];
};

type MockSlip = {
	id: string;
	user_email: string;
	amount_cents: number;
	status: "pending" | "auto_approved" | "admin_approved" | "rejected";
	target: { type: string; title: string; slug: string };
	slip_ref: string | null;
	verify_response: string | null;
	image_url: string;
	created_at: string;
	reviewed_at: string | null;
	review_note: string | null;
};

type MockState = {
	currentUserId: string | null;
	users: MockUser[];
	courses: MockCourse[];
	slips: MockSlip[];
	tax_info: {
		tax_name: string | null;
		tax_id: string | null;
		tax_address: string | null;
		tax_branch: string | null;
	};
};

function seed(): MockState {
	const now = new Date();
	const days = (n: number) =>
		new Date(now.getTime() - n * 86_400_000).toISOString();
	return {
		currentUserId: null,
		users: [
			{
				id: "u-admin",
				email: "admin@example.com",
				password: "admin1234",
				is_admin: true,
				is_active: true,
				email_verified: true,
				created_at: days(120),
			},
			{
				id: "u-1",
				email: "user@example.com",
				password: "user1234",
				is_admin: false,
				is_active: true,
				email_verified: true,
				created_at: days(45),
			},
			{
				id: "u-2",
				email: "siriporn@example.com",
				password: "x",
				is_admin: false,
				is_active: true,
				email_verified: true,
				created_at: days(12),
			},
			{
				id: "u-3",
				email: "thanapat@example.com",
				password: "x",
				is_admin: false,
				is_active: false,
				email_verified: false,
				created_at: days(3),
			},
		],
		courses: [
			{
				id: "c-1",
				slug: "thai-history-modern",
				title: "ประวัติศาสตร์ไทยสมัยใหม่",
				description:
					"อ่านการเปลี่ยนผ่านของสยามตั้งแต่รัชสมัยที่ ๕ จนถึงปัจจุบัน ผ่านเอกสารชั้นต้น แผนที่ และภาพถ่ายต้นฉบับที่หาดูได้ยาก",
				price_cents: 129000,
				access_duration_days: null,
				pixel_watermark: true,
				lessons: [
					{ id: "l-1a", title: "อารัมภบท: สยามก่อนพ.ศ. ๒๔๑๑", position: 1, is_preview: true, video_id: "v-1a" },
					{ id: "l-1b", title: "การปฏิรูปสมัยรัชกาลที่ ๕", position: 2, is_preview: false, video_id: "v-1b" },
					{ id: "l-1c", title: "เศรษฐกิจข้าวกับการเข้าสู่ตลาดโลก", position: 3, is_preview: false, video_id: "v-1c" },
					{ id: "l-1d", title: "การเปลี่ยนแปลงการปกครอง ๒๔๗๕", position: 4, is_preview: false, video_id: "v-1d" },
				],
			},
			{
				id: "c-2",
				slug: "literature-rattanakosin",
				title: "วรรณคดีรัตนโกสินทร์",
				description:
					"วิเคราะห์งานนิพนธ์สำคัญในช่วงต้นกรุง พร้อมเปรียบเทียบกับวรรณกรรมร่วมสมัยในภูมิภาคเอเชียตะวันออกเฉียงใต้",
				price_cents: 89000,
				access_duration_days: 365,
				pixel_watermark: false,
				lessons: [
					{ id: "l-2a", title: "อ่านเสภาขุนช้างขุนแผน", position: 1, is_preview: true, video_id: "v-2a" },
					{ id: "l-2b", title: "นิราศกับการเดินทาง", position: 2, is_preview: false, video_id: "v-2b" },
					{ id: "l-2c", title: "พระอภัยมณีในมุมเปรียบเทียบ", position: 3, is_preview: false, video_id: "v-2c" },
				],
			},
			{
				id: "c-3",
				slug: "field-economics",
				title: "เศรษฐศาสตร์ภาคสนาม",
				description:
					"หลักเศรษฐศาสตร์จุลภาคที่นำมาใช้กับชีวิตประจำวัน ผ่านกรณีศึกษาจากตลาดสด ร้านโชห่วย และเศรษฐกิจชุมชน",
				price_cents: 0,
				access_duration_days: null,
				pixel_watermark: false,
				lessons: [
					{ id: "l-3a", title: "อุปสงค์อุปทานในตลาดสด", position: 1, is_preview: true, video_id: "v-3a" },
					{ id: "l-3b", title: "ราคาดุลยภาพและสภาพคล่อง", position: 2, is_preview: true, video_id: "v-3b" },
				],
			},
			{
				id: "c-4",
				slug: "buddhist-philosophy",
				title: "ปรัชญาพุทธในชีวิตประจำวัน",
				description:
					"อ่านพระไตรปิฎกในแง่มุมที่นำมาใช้ได้จริง ไม่ใช่เพื่อท่องจำ — เพื่อเข้าใจการตัดสินใจของตัวเอง",
				price_cents: 59000,
				access_duration_days: 180,
				pixel_watermark: false,
				lessons: [
					{ id: "l-4a", title: "อริยสัจสี่ในชีวิตการทำงาน", position: 1, is_preview: false, video_id: "v-4a" },
					{ id: "l-4b", title: "อนัตตากับการปล่อยวาง", position: 2, is_preview: false, video_id: "v-4b" },
				],
			},
		],
		slips: [
			{
				id: "s-1",
				user_email: "siriporn@example.com",
				amount_cents: 129000,
				status: "pending",
				target: { type: "course", title: "ประวัติศาสตร์ไทยสมัยใหม่", slug: "thai-history-modern" },
				slip_ref: "20260527-001234",
				verify_response: null,
				image_url: "data:image/svg+xml;utf8," + encodeURIComponent(
					`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 280' width='200' height='280'>
					   <rect width='200' height='280' fill='%23ebe3cf'/>
					   <text x='100' y='40' font-family='monospace' font-size='10' text-anchor='middle' fill='%231c1814'>SCB EASY</text>
					   <text x='100' y='110' font-family='serif' font-size='20' text-anchor='middle' fill='%231c1814' font-weight='bold'>1,290.00</text>
					   <text x='100' y='130' font-family='monospace' font-size='9' text-anchor='middle' fill='%236e6354'>27/05/2569 14:08</text>
					   <text x='100' y='180' font-family='monospace' font-size='8' text-anchor='middle' fill='%231c1814'>xxx-x-x1234-x</text>
					   <text x='100' y='200' font-family='monospace' font-size='8' text-anchor='middle' fill='%231c1814'>NUTRAWEE S.</text>
					   <text x='100' y='240' font-family='monospace' font-size='7' text-anchor='middle' fill='%236e6354'>REF 20260527-001234</text>
					 </svg>`,
				),
				created_at: days(0).replace("00:00:00", "14:08:00"),
				reviewed_at: null,
				review_note: null,
			},
			{
				id: "s-2",
				user_email: "thanapat@example.com",
				amount_cents: 89000,
				status: "pending",
				target: { type: "course", title: "วรรณคดีรัตนโกสินทร์", slug: "literature-rattanakosin" },
				slip_ref: "20260527-002001",
				verify_response: null,
				image_url: "data:image/svg+xml;utf8," + encodeURIComponent(
					`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 280' width='200' height='280'>
					   <rect width='200' height='280' fill='%23ebe3cf'/>
					   <text x='100' y='40' font-family='monospace' font-size='10' text-anchor='middle' fill='%231c1814'>K PLUS</text>
					   <text x='100' y='110' font-family='serif' font-size='20' text-anchor='middle' fill='%231c1814' font-weight='bold'>890.00</text>
					   <text x='100' y='130' font-family='monospace' font-size='9' text-anchor='middle' fill='%236e6354'>27/05/2569 09:42</text>
					   <text x='100' y='240' font-family='monospace' font-size='7' text-anchor='middle' fill='%236e6354'>REF 20260527-002001</text>
					 </svg>`,
				),
				created_at: days(0).replace("00:00:00", "09:42:00"),
				reviewed_at: null,
				review_note: null,
			},
			{
				id: "s-3",
				user_email: "user@example.com",
				amount_cents: 129000,
				status: "auto_approved",
				target: { type: "course", title: "ประวัติศาสตร์ไทยสมัยใหม่", slug: "thai-history-modern" },
				slip_ref: "20260525-009912",
				verify_response: JSON.stringify({ matched: true, score: 0.98 }, null, 2),
				image_url: "",
				created_at: days(2),
				reviewed_at: days(2),
				review_note: "SlipOK ตรวจตรงทุกฟิลด์",
			},
		],
		tax_info: {
			tax_name: null,
			tax_id: null,
			tax_address: null,
			tax_branch: null,
		},
	};
}

function load(): MockState {
	if (typeof window === "undefined") return seed();
	try {
		const raw = window.localStorage.getItem(STORE_KEY);
		if (!raw) return seed();
		const parsed = JSON.parse(raw);
		// shape-check the few top-level keys; if anything's off, reseed.
		if (!parsed.users || !parsed.courses || !parsed.slips) return seed();
		return parsed;
	} catch {
		return seed();
	}
}

function save(s: MockState) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(STORE_KEY, JSON.stringify(s));
}

/* -------------------------------------------------------------------- */
/* Response helpers                                                      */
/* -------------------------------------------------------------------- */

function ok(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}
function noContent(): Response {
	return new Response(null, { status: 204 });
}
function err(status: number, detail: string): Response {
	return new Response(JSON.stringify({ detail }), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function currentUser(state: MockState): MockUser | null {
	if (!state.currentUserId) return null;
	return state.users.find((u) => u.id === state.currentUserId) ?? null;
}

function requireAuth(state: MockState): MockUser | null {
	return currentUser(state);
}

/* -------------------------------------------------------------------- */
/* Route dispatch                                                        */
/* -------------------------------------------------------------------- */

type Method = "GET" | "POST" | "PUT" | "DELETE";

async function readJson(init?: RequestInit): Promise<any> {
	if (!init?.body) return {};
	if (typeof init.body === "string") {
		try { return JSON.parse(init.body); } catch { return {}; }
	}
	if (init.body instanceof FormData) {
		const o: Record<string, any> = {};
		init.body.forEach((v, k) => { o[k] = v; });
		return o;
	}
	return {};
}

export async function handle(
	url: URL,
	method: Method,
	init?: RequestInit,
): Promise<Response> {
	const state = load();
	const path = url.pathname;
	const search = url.searchParams;

	// ----- public: courses -------------------------------------------------
	if (method === "GET" && path === "/api/v1/courses") {
		// Match shape of public list endpoint (slim, no lessons).
		return ok(
			state.courses.map((c) => ({
				id: c.id,
				slug: c.slug,
				title: c.title,
				description: c.description,
				price_cents: c.price_cents,
			})),
		);
	}
	{
		const m = /^\/api\/v1\/courses\/([^/]+)$/.exec(path);
		if (m && method === "GET") {
			const c = state.courses.find((x) => x.slug === m[1]);
			if (!c) return err(404, "course not found");
			return ok(c);
		}
	}

	// ----- public: lessons + materials ------------------------------------
	{
		const m = /^\/api\/v1\/lessons\/([^/]+)(\/materials)?$/.exec(path);
		if (m && method === "GET") {
			const lessonId = m[1]!;
			const wantMats = !!m[2];
			if (wantMats) {
				return ok([
					{
						id: "mat-1",
						filename: "เอกสารบทที่ ๑.pdf",
						content_type: "application/pdf",
						size_bytes: 482 * 1024,
					},
					{
						id: "mat-2",
						filename: "บรรณานุกรม.pdf",
						content_type: "application/pdf",
						size_bytes: 96 * 1024,
					},
				]);
			}
			for (const c of state.courses) {
				const l = c.lessons.find((ll) => ll.id === lessonId);
				if (l) return ok({ ...l, course_id: c.id });
			}
			return err(404, "lesson not found");
		}
	}

	// ----- auth ------------------------------------------------------------
	if (method === "POST" && path === "/api/v1/auth/register") {
		const body = await readJson(init);
		if (state.users.find((u) => u.email === body.email)) {
			return err(409, "อีเมลนี้มีอยู่ในระบบแล้ว");
		}
		const u: MockUser = {
			id: `u-${Date.now()}`,
			email: body.email,
			password: body.password,
			is_admin: false,
			is_active: true,
			email_verified: false,
			created_at: new Date().toISOString(),
		};
		state.users.push(u);
		save(state);
		return ok({ ok: true });
	}

	if (method === "POST" && path === "/api/v1/auth/login") {
		const body = await readJson(init);
		const u = state.users.find((x) => x.email === body.email);
		if (!u) return err(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
		// In mock mode, any password works for seed users (so the demo
		// account doesn't lock people out). Real flow checks `u.password`.
		state.currentUserId = u.id;
		save(state);
		return ok({ otp_required: false, ok: true, token: "mock-token" });
	}

	if (method === "POST" && path === "/api/v1/auth/device-otp/confirm") {
		// Mock accepts any 6-digit code.
		return ok({ ok: true, token: "mock-token" });
	}

	if (method === "POST" && path === "/api/v1/auth/request-password-reset") {
		return ok({ ok: true });
	}
	if (method === "POST" && path === "/api/v1/auth/reset-password") {
		return ok({ ok: true });
	}
	if (method === "POST" && path === "/api/v1/auth/verify-email") {
		return ok({ ok: true });
	}

	if (method === "GET" && path === "/api/v1/auth/me") {
		const u = requireAuth(state);
		if (!u) return err(401, "not authenticated");
		return ok({
			id: u.id, email: u.email, is_admin: u.is_admin,
			email_verified: u.email_verified, is_active: u.is_active,
		});
	}

	if (method === "POST" && path === "/api/v1/auth/logout-all") {
		state.currentUserId = null;
		save(state);
		return ok({ ok: true });
	}

	// ----- account ---------------------------------------------------------
	if (method === "GET" && path === "/api/v1/account/tax-info") {
		const u = requireAuth(state); if (!u) return err(401, "not authenticated");
		return ok(state.tax_info);
	}
	if (method === "PUT" && path === "/api/v1/account/tax-info") {
		const u = requireAuth(state); if (!u) return err(401, "not authenticated");
		state.tax_info = await readJson(init);
		save(state);
		return ok({ ok: true });
	}
	if (method === "GET" && path === "/api/v1/account/export") {
		const u = requireAuth(state); if (!u) return err(401, "not authenticated");
		return ok({
			user: { email: u.email, created_at: u.created_at },
			tax_info: state.tax_info,
			payments: [],
			enrollments: state.courses.slice(0, 2).map((c) => ({ course_slug: c.slug })),
		});
	}
	if (method === "POST" && path === "/api/v1/account/delete") {
		state.currentUserId = null;
		save(state);
		return ok({ ok: true });
	}

	// ----- payments --------------------------------------------------------
	if (method === "GET" && path === "/api/v1/payments") {
		const u = requireAuth(state); if (!u) return err(401, "not authenticated");
		return ok([
			{
				id: "p-1",
				amount_cents: 129000,
				subtotal_cents: 120561,
				vat_cents: 8439,
				currency: "THB",
				status: "paid",
				invoice_number: "INV-2569-00042",
				created_at: new Date(Date.now() - 14 * 86_400_000).toISOString(),
			},
			{
				id: "p-2",
				amount_cents: 59000,
				subtotal_cents: 55140,
				vat_cents: 3860,
				currency: "THB",
				status: "pending",
				invoice_number: null,
				created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
			},
		]);
	}

	// ----- devices ---------------------------------------------------------
	if (method === "GET" && path === "/api/v1/account/devices") {
		const u = requireAuth(state); if (!u) return err(401, "not authenticated");
		const now = new Date().toISOString();
		const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
		return ok([
			{
				id: "d-current",
				label: "Chrome on macOS",
				last_seen_at: now,
				last_ip: "203.0.113.42",
				created_at: days(30),
				current: true,
			},
			{
				id: "d-2",
				label: "Safari on iPhone",
				last_seen_at: days(1),
				last_ip: "203.0.113.42",
				created_at: days(12),
				current: false,
			},
			{
				id: "d-3",
				label: "Chrome on Windows",
				last_seen_at: days(5),
				last_ip: "171.99.4.18",
				created_at: days(8),
				current: false,
			},
		]);
	}
	{
		const m = /^\/api\/v1\/account\/devices\/([^/]+)$/.exec(path);
		if (m && method === "DELETE") return ok({ ok: true });
	}
	if (method === "POST" && path === "/api/v1/account/devices/revoke-all") {
		state.currentUserId = null;
		save(state);
		return ok({ ok: true });
	}

	// ----- slip payments (buyer side) -------------------------------------
	if (method === "GET" && path === "/api/v1/slip-payments/info") {
		return ok({
			bank_name: "ไทยพาณิชย์ (SCB)",
			account_number: "123-4-56789-0",
			account_name: "บจก. สถาบันการศึกษาทางไกล",
			promptpay_id: "0-1234-56789-01-2",
			auto_verify: true,
		});
	}
	if (method === "POST" && path === "/api/v1/slip-payments/upload") {
		return ok({
			status: "auto_approved",
			message: "ระบบตรวจสลิปอัตโนมัติเรียบร้อย เปิดสิทธิ์เข้าเรียนให้แล้ว",
			slip_id: `s-${Date.now()}`,
		});
	}

	// ----- admin -----------------------------------------------------------
	if (path.startsWith("/api/v1/admin")) {
		const u = requireAuth(state);
		if (!u) return err(401, "not authenticated");
		if (!u.is_admin) return err(403, "ต้องเป็นผู้ดูแลระบบ");

		if (method === "GET" && path === "/api/v1/admin/stats") {
			return ok({
				users: state.users.length,
				courses: state.courses.length,
				lessons: state.courses.reduce((n, c) => n + c.lessons.length, 0),
				enrollments: 184,
				key_grants_24h: 1247,
				key_denials_24h: 3,
			});
		}
		if (method === "GET" && path === "/api/v1/admin/users") {
			return ok(state.users.map((u) => ({
				id: u.id, email: u.email, is_admin: u.is_admin,
				is_active: u.is_active, created_at: u.created_at,
			})));
		}
		if (method === "POST" && path === "/api/v1/admin/courses") {
			const b = await readJson(init);
			const c: MockCourse = {
				id: `c-${Date.now()}`,
				slug: b.slug, title: b.title,
				description: b.description ?? "",
				price_cents: b.price_cents ?? 0,
				access_duration_days: b.access_duration_days ?? null,
				pixel_watermark: !!b.pixel_watermark,
				lessons: [],
			};
			state.courses.push(c);
			save(state);
			return ok({ id: c.id });
		}
		if (method === "POST" && path === "/api/v1/admin/enrollments") {
			const b = await readJson(init);
			return ok({ id: `e-${Date.now()}`, status: "granted", ...b });
		}
		if (method === "GET" && path === "/api/v1/admin/logs") {
			const granted = search.get("granted");
			const all = [
				{ id: 1, user_id: "u-1", video_id: "v-1b", ip: "203.0.113.42", user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Chrome/126.0", granted: true,  reason: "ok",            created_at: new Date(Date.now() - 1 * 3600_000).toISOString() },
				{ id: 2, user_id: "u-1", video_id: "v-1c", ip: "203.0.113.42", user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Chrome/126.0", granted: true,  reason: "ok",            created_at: new Date(Date.now() - 2 * 3600_000).toISOString() },
				{ id: 3, user_id: "u-2", video_id: "v-2a", ip: "171.99.4.18",  user_agent: "Mozilla/5.0 (iPhone) Safari/605",                            granted: true,  reason: "ok",            created_at: new Date(Date.now() - 5 * 3600_000).toISOString() },
				{ id: 4, user_id: null,   video_id: "v-1b", ip: "5.252.118.99", user_agent: "python-requests/2.31.0",                                     granted: false, reason: "no_session",    created_at: new Date(Date.now() - 6 * 3600_000).toISOString() },
				{ id: 5, user_id: "u-3",  video_id: "v-1b", ip: "5.252.118.99", user_agent: "curl/8.7.1",                                                  granted: false, reason: "rate_limited",  created_at: new Date(Date.now() - 7 * 3600_000).toISOString() },
				{ id: 6, user_id: "u-3",  video_id: "v-1b", ip: "5.252.118.99", user_agent: "curl/8.7.1",                                                  granted: false, reason: "context_mismatch", created_at: new Date(Date.now() - 7.5 * 3600_000).toISOString() },
			];
			const rows = granted == null || granted === ""
				? all
				: all.filter((r) => String(r.granted) === granted);
			return ok(rows);
		}
		if (method === "GET" && path === "/api/v1/admin/settings") {
			return ok({
				email: {
					smtp_host: "mailserver", smtp_port: 587, smtp_use_tls: true,
					smtp_user: "postmaster@example.com", smtp_password_set: true,
					smtp_from: "no-reply@example.com",
					frontend_url: "https://example.com",
				},
				storage: {
					r2_account_id_tail: "…ab12cd34",
					r2_bucket: "course-platform-media",
					r2_public_base: "https://media.example.com",
					r2_creds_set: true,
				},
				backup: {
					aws_region: "ap-southeast-1",
					aws_bucket: "course-platform-glacier",
					storage_class: "DEEP_ARCHIVE",
					aws_creds_set: true,
				},
				payments: {
					method: "slip_manual",
					currency: "thb",
					slipok_configured: true,
					receiver_bank_set: true,
				},
				security: {
					kek_set: true,
					jwt_secret_set: true,
					jwt_ttl_min: 30,
					pb_session_ttl_sec: 600,
					key_rate_limit_per_min: 60,
					max_concurrent_sessions: 3,
					e2e_bypass_set: false,
				},
				cors_origins: ["https://example.com", "https://www.example.com"],
			});
		}
		if (method === "POST" && path === "/api/v1/admin/settings/test-email") {
			return ok({ ok: true });
		}
		if (method === "GET" && path === "/api/v1/admin/slip-uploads") {
			const filter = search.get("status_filter") ?? "pending";
			const rows = filter === "all"
				? state.slips
				: state.slips.filter((s) => s.status === filter);
			return ok(rows);
		}
		{
			const m = /^\/api\/v1\/admin\/slip-uploads\/([^/]+)\/(approve|reject)$/.exec(path);
			if (m && method === "POST") {
				const id = m[1], action = m[2] as "approve" | "reject";
				const slip = state.slips.find((s) => s.id === id);
				if (!slip) return err(404, "ไม่พบสลิป");
				const body = await readJson(init);
				slip.status = action === "approve" ? "admin_approved" : "rejected";
				slip.reviewed_at = new Date().toISOString();
				slip.review_note = body.note ?? null;
				save(state);
				return ok({ ok: true });
			}
		}
		if (method === "POST" && path === "/api/v1/admin/uploads") {
			return ok({ upload_id: `up-${Date.now()}` });
		}
		{
			const m = /^\/api\/v1\/admin\/uploads\/([^/]+)\/file$/.exec(path);
			if (m && method === "POST") return ok({ ok: true, size: 0 });
		}
		if (method === "POST" && path === "/api/v1/admin/uploads/finalize") {
			const b = await readJson(init);
			return ok({
				video_id: `v-${Date.now()}`,
				lesson_id: `l-${Date.now()}`,
				manifest_url: `https://media.example.com/${b.upload_id}/master.m3u8`,
			});
		}
	}

	// ----- video playback (just enough to not crash the player chrome) ----
	{
		const m = /^\/api\/v1\/videos\/([^/]+)\/playback-session$/.exec(path);
		if (m && method === "POST") {
			return ok({
				manifest_url: "/mock/no-real-video.m3u8",
				key_url_template: "/mock/no-real-key",
				expires_in: 600,
			});
		}
	}

	// Unknown path — return 404 so callers' .catch branches fire cleanly
	// instead of hanging on the original (failing) network request.
	return err(404, `mock: ไม่รู้จัก ${method} ${path}`);
}

/* -------------------------------------------------------------------- */
/* Fetch interceptor install                                             */
/* -------------------------------------------------------------------- */

let installed = false;

export function installMockFetch() {
	if (installed || typeof window === "undefined") return;
	const realFetch = window.fetch.bind(window);

	window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		let urlStr: string;
		let method: string;
		if (typeof input === "string") {
			urlStr = input;
			method = (init?.method ?? "GET").toUpperCase();
		} else if (input instanceof URL) {
			urlStr = input.toString();
			method = (init?.method ?? "GET").toUpperCase();
		} else {
			urlStr = input.url;
			method = (input.method ?? init?.method ?? "GET").toUpperCase();
		}

		// Only intercept things that look like our API. Everything else
		// (next/font CSS, _next/static, etc.) passes through untouched.
		const apiHit =
			urlStr.includes("/api/v1/") &&
			!urlStr.startsWith("/_next/") &&
			!urlStr.startsWith("_next/");

		if (!apiHit) return realFetch(input, init);

		// Build a URL we can pattern-match against. `urlStr` may start with
		// "undefined/api/v1/..." when NEXT_PUBLIC_API_BASE is unset — normalise.
		const cleaned = urlStr.replace(/^undefined/, "").replace(/^\/+/, "/");
		const url = new URL(
			cleaned.startsWith("http") ? cleaned : `http://mock${cleaned}`,
		);
		try {
			return await handle(url, method as Method, init);
		} catch (e) {
			return err(500, (e as Error).message);
		}
	};

	installed = true;
}

export function resetMockState() {
	if (typeof window !== "undefined") {
		window.localStorage.removeItem(STORE_KEY);
	}
}
