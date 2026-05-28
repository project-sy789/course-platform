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
	price_baht: number;
	access_duration_days: number | null;
	pixel_watermark: boolean;
	is_featured: boolean;
	cover_data_url: string | null;
	lessons: { id: string; title: string; position: number; is_preview: boolean; video_id: string }[];
};

type MockSlip = {
	id: string;
	user_email: string;
	amount_baht: number;
	status: "pending" | "auto_approved" | "admin_approved" | "rejected";
	target: { type: string; title: string; slug: string };
	slip_ref: string | null;
	verify_response: string | null;
	image_url: string;
	created_at: string;
	reviewed_at: string | null;
	review_note: string | null;
};

type MockProgress = {
	user_id: string;
	lesson_id: string;
	position_seconds: number;
	duration_seconds: number;
	completed: boolean;
	updated_at: string;
};

type MockMaterial = {
	id: string;
	lesson_id: string | null;
	course_slug: string | null;
	filename: string;
	content_type: string;
	size_bytes: number;
	created_at: string;
};

type MockEncodeJob = {
	id: string;
	upload_id: string;
	course_slug: string;
	lesson_title: string;
	is_preview: boolean;
	source_filename: string;
	source_size: number;
	created_at: string;
	video_id?: string;
};

type MockCoupon = {
	id: string;
	code: string;
	kind: "fixed" | "percent" | "full";
	amount_baht: number | null;
	percent: number | null;
	max_discount_baht: number | null;
	min_purchase_baht: number;
	scope: "all" | "course" | "lesson";
	target_course_slug: string | null;
	target_lesson_id: string | null;
	valid_from: string | null;
	valid_until: string | null;
	usage_limit: number | null;
	per_user_limit: number | null;
	usage_count: number;
	is_active: boolean;
	note: string | null;
	created_at: string;
};

type MockCouponRedemption = {
	id: string;
	coupon_id: string;
	user_id: string;
	user_email: string | null;
	payment_id: string | null;
	slip_upload_id: string | null;
	original_baht: number;
	discount_baht: number;
	final_baht: number;
	redeemed_at: string;
};

type MockState = {
	currentUserId: string | null;
	users: MockUser[];
	courses: MockCourse[];
	slips: MockSlip[];
	progress: MockProgress[];
	materials: MockMaterial[];
	encodeJobs: MockEncodeJob[];
	coupons: MockCoupon[];
	couponRedemptions: MockCouponRedemption[];
	tax_info: {
		tax_name: string | null;
		tax_id: string | null;
		tax_address: string | null;
		tax_branch: string | null;
	};
	payment_settings: {
		// null = not overridden (UI shows env-fallback value)
		receiver_bank_name: string | null;
		receiver_bank_account: string | null;
		receiver_name: string | null;
		promptpay_id: string | null;
		slipok_branch_id: string | null;
		slipok_api_key: string | null;
	};
};

// In mock mode we don't have a real .env, so simulate the env fallback with
// sensible defaults so the buyer-side page never looks empty during demos.
const MOCK_PAY_ENV = {
	receiver_bank_name: "ไทยพาณิชย์ (SCB)",
	receiver_bank_account: "123-4-56789-0",
	receiver_name: "บจก. สถาบันการศึกษาทางไกล",
	promptpay_id: "0-1234-56789-01-2",
	slipok_branch_id: "",
	slipok_api_key: "",
};

// Mock email-provider env. Mirrors backend EMAIL_* envvars + SMTP_*.
const MOCK_EMAIL_ENV = {
	provider: "smtp" as "smtp" | "resend" | "postmark" | "sendgrid" | "disabled",
	api_key: "",
	from_email: "no-reply@example.com",
	from_name: "สถาบัน",
	smtp_host: "mailserver",
	smtp_port: 587,
	smtp_use_tls: true,
	smtp_user: "postmaster@example.com",
	smtp_password: "••••••",
};

// In-memory overrides for email-settings — survives only the page session.
// Keep a separate object instead of folding into MockState because we don't
// want to bump the persisted-state schema for what's a demo-only knob.
const mockEmail: {
	provider?: typeof MOCK_EMAIL_ENV.provider;
	api_key?: string;
	from_email?: string;
	from_name?: string;
} = {};

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
				price_baht: 1290,
				access_duration_days: null,
				pixel_watermark: true,
				is_featured: true,
				cover_data_url: null,
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
				price_baht: 890,
				access_duration_days: 365,
				pixel_watermark: false,
				is_featured: true,
				cover_data_url: null,
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
				price_baht: 0,
				access_duration_days: null,
				pixel_watermark: false,
				is_featured: false,
				cover_data_url: null,
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
				price_baht: 590,
				access_duration_days: 180,
				pixel_watermark: false,
				is_featured: false,
				cover_data_url: null,
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
				amount_baht: 1290,
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
				amount_baht: 890,
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
				amount_baht: 1290,
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
		progress: [],
		materials: [
			{ id: "mat-seed-1", lesson_id: "l-1a", course_slug: null, filename: "เอกสารบทที่ ๑.pdf", content_type: "application/pdf", size_bytes: 482 * 1024, created_at: days(30) },
			{ id: "mat-seed-2", lesson_id: "l-1a", course_slug: null, filename: "บรรณานุกรม.pdf", content_type: "application/pdf", size_bytes: 96 * 1024, created_at: days(30) },
			{ id: "mat-seed-3", lesson_id: null, course_slug: "thai-history-modern", filename: "เอกสารคอร์สครบชุด.pdf", content_type: "application/pdf", size_bytes: 2_148_000, created_at: days(28) },
			{ id: "mat-seed-4", lesson_id: null, course_slug: "thai-history-modern", filename: "ประมวลคำศัพท์.pdf", content_type: "application/pdf", size_bytes: 312_000, created_at: days(28) },
		],
		encodeJobs: [],
		coupons: [
			{
				id: "cp-welcome10", code: "WELCOME10", kind: "percent",
				amount_baht: null, percent: 10, max_discount_baht: null,
				min_purchase_baht: 0, scope: "all",
				target_course_slug: null, target_lesson_id: null,
				valid_from: null, valid_until: null,
				usage_limit: null, per_user_limit: 1, usage_count: 3,
				is_active: true, note: "ยินดีต้อนรับนักเรียนใหม่ — ใช้ได้ครั้งเดียวต่อบัญชี",
				created_at: days(45),
			},
			{
				id: "cp-songkran100", code: "SONGKRAN100", kind: "fixed",
				amount_baht: 100, percent: null, max_discount_baht: null,
				min_purchase_baht: 500, scope: "all",
				target_course_slug: null, target_lesson_id: null,
				valid_from: null, valid_until: null,
				usage_limit: 50, per_user_limit: 1, usage_count: 12,
				is_active: true, note: "เทศกาลสงกรานต์ — ลด ๑๐๐ บาทเมื่อยอดตั้งแต่ ๕๐๐",
				created_at: days(20),
			},
		],
		couponRedemptions: [],
		payment_settings: {
			receiver_bank_name: null,
			receiver_bank_account: null,
			receiver_name: null,
			promptpay_id: null,
			slipok_branch_id: null,
			slipok_api_key: null,
		},
	};
}

function load(): MockState {
	if (typeof window === "undefined") return seed();
	try {
		const raw = window.localStorage.getItem(STORE_KEY);
		if (!raw) return seed();
		if (raw.includes("price_cents") || raw.includes("amount_cents") || raw.includes("balance_satang")) {
			window.localStorage.removeItem(STORE_KEY);
			return seed();
		}
		const parsed = JSON.parse(raw);
		// shape-check the few top-level keys; if anything's off, reseed.
		if (!parsed.users || !parsed.courses || !parsed.slips) return seed();
		if (!parsed.progress) parsed.progress = [];
		if (!parsed.materials) parsed.materials = [];
		if (!parsed.encodeJobs) parsed.encodeJobs = [];
		if (!parsed.coupons) parsed.coupons = [];
		if (!parsed.couponRedemptions) parsed.couponRedemptions = [];
		if (!parsed.payment_settings) {
			parsed.payment_settings = {
				receiver_bank_name: null,
				receiver_bank_account: null,
				receiver_name: null,
				promptpay_id: null,
				slipok_branch_id: null,
				slipok_api_key: null,
			};
		}
		for (const c of parsed.courses) {
			if (!("cover_data_url" in c)) c.cover_data_url = null;
			if (!("is_featured" in c)) c.is_featured = false;
				if ("price_cents" in c && !("price_baht" in c)) {
					c.price_baht = Math.floor((c.price_cents ?? 0) / 100);
					delete c.price_cents;
				}
				for (const l of c.lessons ?? []) {
					if ("price_cents" in l && !("price_baht" in l)) {
						(l as any).price_baht = Math.floor(((l as any).price_cents ?? 0) / 100);
						delete (l as any).price_cents;
					}
				}
		}
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

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

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
				price_baht: c.price_baht,
				is_featured: c.is_featured,
				cover_url: c.cover_data_url ? `/api/v1/courses/${c.slug}/cover` : null,
			})),
		);
	}
	{
		const m = /^\/api\/v1\/courses\/([^/]+)\/cover$/.exec(path);
		if (m && method === "GET") {
			const c = state.courses.find((x) => x.slug === m[1]);
			if (!c || !c.cover_data_url) return err(404, "no cover");
			// Decode the data URL and return as image bytes so <img src> works.
			const match = /^data:([^;]+);base64,(.*)$/.exec(c.cover_data_url);
			if (!match) return err(500, "malformed cover");
			const ctype = match[1]!;
			const bin = atob(match[2]!);
			const bytes = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			return new Response(bytes, {
				status: 200,
				headers: { "content-type": ctype, "cache-control": "public, max-age=86400" },
			});
		}
	}
	{
		const m = /^\/api\/v1\/courses\/([^/]+)$/.exec(path);
		if (m && method === "GET") {
			const c = state.courses.find((x) => x.slug === m[1]);
			if (!c) return err(404, "course not found");
			return ok({
				...c,
				cover_url: c.cover_data_url ? `/api/v1/courses/${c.slug}/cover` : null,
			});
		}
	}

	{
		const m = /^\/api\/v1\/courses\/([^/]+)\/materials$/.exec(path);
		if (m && method === "GET") {
			const u = requireAuth(state);
			if (!u) return err(401, "not authenticated");
			const slug = m[1];
			if (!state.courses.some((c) => c.slug === slug)) return err(404, "course not found");
			return ok(
				state.materials
					.filter((mm) => mm.course_slug === slug)
					.map(({ id, filename, content_type, size_bytes }) => ({
						id, filename, content_type, size_bytes,
					})),
			);
		}
	}

	// ----- public: lessons + materials ------------------------------------
	{
		const m = /^\/api\/v1\/lessons\/([^/]+)(\/materials)?$/.exec(path);
		if (m && method === "GET") {
			const lessonId = m[1]!;
			const wantMats = !!m[2];
			if (wantMats) {
				return ok(
					state.materials
						.filter((mm) => mm.lesson_id === lessonId)
						.map(({ id, filename, content_type, size_bytes }) => ({
							id, filename, content_type, size_bytes,
						})),
				);
			}
			for (const c of state.courses) {
				const l = c.lessons.find((ll) => ll.id === lessonId);
				if (l) return ok({ ...l, course_id: c.id });
			}
			return err(404, "lesson not found");
		}
	}

	// ----- progress --------------------------------------------------------
	{
		const m = /^\/api\/v1\/lessons\/([^/]+)\/progress$/.exec(path);
		if (m && (method === "GET" || method === "PUT")) {
			const u = requireAuth(state);
			if (!u) return err(401, "not authenticated");
			const lessonId = m[1]!;
			if (method === "GET") {
				const p = state.progress.find((x) => x.user_id === u.id && x.lesson_id === lessonId);
				if (!p) return ok({ position_seconds: 0, duration_seconds: 0, completed: false });
				return ok(p);
			}
			const body = await readJson(init);
			const dur = Math.max(0, Number(body.duration_seconds ?? 0));
			const rawPos = Math.max(0, Number(body.position_seconds ?? 0));
			const pos = dur > 0 ? Math.min(rawPos, dur) : rawPos;
			const completed = dur > 0 && pos >= Math.floor(dur * 0.9);
			let p = state.progress.find((x) => x.user_id === u.id && x.lesson_id === lessonId);
			if (!p) {
				p = { user_id: u.id, lesson_id: lessonId, position_seconds: pos, duration_seconds: dur, completed, updated_at: new Date().toISOString() };
				state.progress.push(p);
			} else {
				p.position_seconds = pos;
				p.duration_seconds = dur;
				p.completed = p.completed || completed;
				p.updated_at = new Date().toISOString();
			}
			save(state);
			return ok({ position_seconds: pos, completed: p.completed });
		}
	}
	{
		const m = /^\/api\/v1\/courses\/([^/]+)\/progress$/.exec(path);
		if (m && method === "GET") {
			const u = requireAuth(state);
			if (!u) return err(401, "not authenticated");
			const c = state.courses.find((x) => x.slug === m[1]);
			if (!c) return err(404, "course not found");
			const items = c.lessons
				.slice()
				.sort((a, b) => a.position - b.position)
				.map((l) => {
					const p = state.progress.find((x) => x.user_id === u.id && x.lesson_id === l.id);
					return {
						lesson_id: l.id,
						title: l.title,
						position: l.position,
						position_seconds: p?.position_seconds ?? 0,
						duration_seconds: p?.duration_seconds ?? 0,
						completed: !!p?.completed,
					};
				});
			return ok({
				course_slug: c.slug,
				completed_lessons: items.filter((x) => x.completed).length,
				total_lessons: items.length,
				lessons: items,
			});
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
	if (method === "GET" && path === "/api/v1/account/resume") {
		const u = requireAuth(state); if (!u) return err(401, "not authenticated");
		// Demo: pretend the user is mid-way through lesson 3 of the first course.
		const c = state.courses[0];
		if (!c || c.lessons.length < 2) return ok(null);
		const lesson = c.lessons[Math.min(2, c.lessons.length - 1)]!;
		return ok({
			course_slug: c.slug,
			course_title: c.title,
			lesson_id: lesson.id,
			lesson_title: lesson.title,
			lesson_position: lesson.position,
			watched_pct: 47,
			updated_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
		});
	}

	// ----- payments --------------------------------------------------------
	if (method === "GET" && path === "/api/v1/payments") {
		const u = requireAuth(state); if (!u) return err(401, "not authenticated");
		return ok([
			{
				id: "p-1",
				amount_baht: 1290,
				subtotal_baht: 1206,
				vat_baht: 84,
				currency: "THB",
				status: "paid",
				invoice_number: "INV-2569-00042",
				created_at: new Date(Date.now() - 14 * 86_400_000).toISOString(),
			},
			{
				id: "p-2",
				amount_baht: 590,
				subtotal_baht: 551,
				vat_baht: 39,
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
		const ps = state.payment_settings;
		const eff = (db: string | null, env: string) => db !== null ? db : env;
		return ok({
			bank_name: eff(ps.receiver_bank_name, MOCK_PAY_ENV.receiver_bank_name),
			account_number: eff(ps.receiver_bank_account, MOCK_PAY_ENV.receiver_bank_account),
			account_name: eff(ps.receiver_name, MOCK_PAY_ENV.receiver_name),
			promptpay_id: eff(ps.promptpay_id, MOCK_PAY_ENV.promptpay_id),
			auto_verify: !!(eff(ps.slipok_api_key, MOCK_PAY_ENV.slipok_api_key)
				&& eff(ps.slipok_branch_id, MOCK_PAY_ENV.slipok_branch_id)),
		});
	}
	if (method === "POST" && path === "/api/v1/coupons/validate") {
		const u = requireAuth(state); if (!u) return err(401, "not authenticated");
		const b = await readJson(init);
		const code = String(b.code ?? "").trim().toUpperCase();
		if (!code) return ok({ valid: false, reason: "กรุณากรอกโค้ดส่วนลด" });
		const c = state.coupons.find((x) => x.code.toUpperCase() === code);
		if (!c) return ok({ valid: false, reason: "ไม่พบโค้ดส่วนลดนี้" });
		if (!c.is_active) return ok({ valid: false, reason: "โค้ดนี้ถูกปิดใช้งาน" });
		const now = Date.now();
		if (c.valid_from && now < new Date(c.valid_from).getTime()) {
			return ok({ valid: false, reason: "โค้ดนี้ยังไม่เริ่มใช้งาน" });
		}
		if (c.valid_until && now > new Date(c.valid_until).getTime()) {
			return ok({ valid: false, reason: "โค้ดนี้หมดอายุแล้ว" });
		}
		// Resolve target → price.
		let price = 0;
		let courseSlug: string | null = null;
		let lessonId: string | null = null;
		if (b.course_slug) {
			const course = state.courses.find((x) => x.slug === b.course_slug);
			if (!course) return err(404, "course not found");
			price = course.price_baht;
			courseSlug = course.slug;
		} else if (b.lesson_id) {
			let lesson: any = null;
			for (const cc of state.courses) {
				const l = cc.lessons.find((ll) => ll.id === b.lesson_id);
				if (l) { lesson = l; break; }
			}
			if (!lesson) return err(404, "lesson not found");
			price = (lesson as any).price_baht ?? 0;
			lessonId = lesson.id;
		} else {
			return err(400, "specify course_slug or lesson_id");
		}
		if (price <= 0) return err(400, "this item is free");
		if (c.scope === "course" && c.target_course_slug !== courseSlug) {
			return ok({ valid: false, reason: "โค้ดนี้ใช้ไม่ได้กับคอร์สที่เลือก" });
		}
		if (c.scope === "lesson" && c.target_lesson_id !== lessonId) {
			return ok({ valid: false, reason: "โค้ดนี้ใช้ไม่ได้กับบทเรียนที่เลือก" });
		}
		if (price < c.min_purchase_baht) {
			return ok({
				valid: false,
				reason: `โค้ดนี้ใช้ได้เมื่อยอดซื้อตั้งแต่ ${c.min_purchase_baht} บาทขึ้นไป`,
			});
		}
		if (c.usage_limit != null && c.usage_count >= c.usage_limit) {
			return ok({ valid: false, reason: "โค้ดนี้ถูกใช้ครบจำนวนแล้ว" });
		}
		if (c.per_user_limit != null) {
			const used = state.couponRedemptions.filter(
				(r) => r.coupon_id === c.id && r.user_id === u.id,
			).length;
			if (used >= c.per_user_limit) {
				return ok({ valid: false, reason: "คุณใช้โค้ดนี้ครบจำนวนแล้ว" });
			}
		}
		// Compute discount.
		let discount = 0;
		if (c.kind === "full") discount = price;
		else if (c.kind === "fixed") discount = Math.min(c.amount_baht ?? 0, price);
		else if (c.kind === "percent") {
			let raw = Math.floor(price * (c.percent ?? 0) / 100);
			if (c.max_discount_baht != null) raw = Math.min(raw, c.max_discount_baht);
			discount = Math.min(raw, price);
		}
		return ok({
			valid: true, code: c.code,
			original_baht: price, discount_baht: discount,
			final_baht: price - discount,
		});
	}

	if (method === "POST" && path === "/api/v1/orders/quote") {
		const u = requireAuth(state); if (!u) return err(401, "not authenticated");
		const b = await readJson(init);
		const rawItems: any[] = Array.isArray(b.items) ? b.items : [];
		if (rawItems.length === 0) return err(400, "ตะกร้าว่าง");
		type Line = {
			course_id: string | null; lesson_id: string | null;
			title: string; unit_price_baht: number;
			line_discount_baht: number; line_final_baht: number;
		};
		const lines: Line[] = [];
		for (const it of rawItems) {
			if (it.course_id) {
				const c = state.courses.find((x) => x.id === it.course_id);
				if (!c) return err(404, "ไม่พบคอร์สบางรายการในตะกร้า");
				lines.push({
					course_id: c.id, lesson_id: null, title: c.title,
					unit_price_baht: c.price_baht,
					line_discount_baht: 0, line_final_baht: c.price_baht,
				});
			} else if (it.lesson_id) {
				let lesson: any = null;
				for (const cc of state.courses) {
					const l = cc.lessons.find((ll) => ll.id === it.lesson_id);
					if (l) { lesson = l; break; }
				}
				if (!lesson || (lesson.price_baht ?? 0) <= 0) {
					return err(400, "บทเรียนนี้ไม่ได้เปิดขายแยก");
				}
				lines.push({
					course_id: null, lesson_id: lesson.id, title: lesson.title,
					unit_price_baht: lesson.price_baht,
					line_discount_baht: 0, line_final_baht: lesson.price_baht,
				});
			} else {
				return err(400, "ตะกร้าผิดรูปแบบ");
			}
		}
		const subtotal = lines.reduce((s, l) => s + l.unit_price_baht, 0);
		const codeRaw = b.code ? String(b.code).trim().toUpperCase() : "";
		const baseReply = {
			lines, subtotal_baht: subtotal,
			discount_baht: 0, final_baht: subtotal,
			coupon: null as null | { code: string; discount_baht: number },
			coupon_reason: null as string | null,
		};
		if (!codeRaw) return ok(baseReply);

		const c = state.coupons.find((x) => x.code.toUpperCase() === codeRaw);
		if (!c) return ok({ ...baseReply, coupon_reason: "ไม่พบโค้ดส่วนลดนี้" });
		if (!c.is_active) return ok({ ...baseReply, coupon_reason: "โค้ดนี้ถูกปิดใช้งาน" });
		const now = Date.now();
		if (c.valid_from && now < new Date(c.valid_from).getTime()) {
			return ok({ ...baseReply, coupon_reason: "โค้ดนี้ยังไม่เริ่มใช้งาน" });
		}
		if (c.valid_until && now > new Date(c.valid_until).getTime()) {
			return ok({ ...baseReply, coupon_reason: "โค้ดนี้หมดอายุแล้ว" });
		}
		// Eligible lines depend on scope.
		const eligibleIdx: number[] = [];
		for (let i = 0; i < lines.length; i++) {
			const l = lines[i]!;
			if (c.scope === "all") eligibleIdx.push(i);
			else if (c.scope === "course") {
				const slug = state.courses.find((cc) => cc.id === l.course_id)?.slug;
				if (slug && slug === c.target_course_slug) eligibleIdx.push(i);
			} else if (c.scope === "lesson") {
				if (l.lesson_id && l.lesson_id === c.target_lesson_id) eligibleIdx.push(i);
			}
		}
		if (eligibleIdx.length === 0) {
			const reason = c.scope === "course"
				? "โค้ดนี้ใช้ได้กับบางคอร์สเท่านั้น — ไม่มีคอร์สนั้นในตะกร้า"
				: c.scope === "lesson"
					? "โค้ดนี้ใช้ได้กับบางบทเรียนเท่านั้น — ไม่มีบทนั้นในตะกร้า"
					: "โค้ดนี้ใช้กับตะกร้านี้ไม่ได้";
			return ok({ ...baseReply, coupon_reason: reason });
		}
		const eligibleSubtotal = eligibleIdx.reduce(
			(s, i) => s + lines[i]!.unit_price_baht, 0,
		);
		if (eligibleSubtotal < c.min_purchase_baht) {
			return ok({
				...baseReply,
				coupon_reason: `โค้ดนี้ใช้ได้เมื่อยอด${c.scope !== "all" ? "รายการที่เข้าเงื่อนไข" : ""}ตั้งแต่ ${c.min_purchase_baht} บาทขึ้นไป`,
			});
		}
		if (c.usage_limit != null && c.usage_count >= c.usage_limit) {
			return ok({ ...baseReply, coupon_reason: "โค้ดนี้ถูกใช้ครบจำนวนแล้ว" });
		}
		if (c.per_user_limit != null) {
			const used = state.couponRedemptions.filter(
				(r) => r.coupon_id === c.id && r.user_id === u.id,
			).length;
			if (used >= c.per_user_limit) {
				return ok({ ...baseReply, coupon_reason: "คุณใช้โค้ดนี้ครบจำนวนแล้ว" });
			}
		}
		let totalDiscount = 0;
		if (c.kind === "full") totalDiscount = eligibleSubtotal;
		else if (c.kind === "fixed") totalDiscount = Math.min(c.amount_baht ?? 0, eligibleSubtotal);
		else if (c.kind === "percent") {
			let raw = Math.floor(eligibleSubtotal * (c.percent ?? 0) / 100);
			if (c.max_discount_baht != null) raw = Math.min(raw, c.max_discount_baht);
			totalDiscount = Math.min(raw, eligibleSubtotal);
		}
		if (totalDiscount <= 0) return ok(baseReply);

		// Distribute discount across eligible lines (largest-remainder rounding).
		const raw = eligibleIdx.map((i) =>
			(lines[i]!.unit_price_baht * totalDiscount) / eligibleSubtotal,
		);
		const floors = raw.map((r) => Math.floor(r));
		const leftover = totalDiscount - floors.reduce((s, n) => s + n, 0);
		const order = raw.map((r, k) => [k, r - floors[k]!] as const)
			.sort((a, b) => b[1] - a[1]);
		for (let k = 0; k < leftover; k++) floors[order[k]![0]]! += 1;
		for (let k = 0; k < eligibleIdx.length; k++) {
			const i = eligibleIdx[k]!;
			const share = floors[k]!;
			lines[i] = {
				...lines[i]!,
				line_discount_baht: share,
				line_final_baht: lines[i]!.unit_price_baht - share,
			};
		}
		return ok({
			lines, subtotal_baht: subtotal,
			discount_baht: totalDiscount,
			final_baht: subtotal - totalDiscount,
			coupon: { code: c.code, discount_baht: totalDiscount },
			coupon_reason: null,
		});
	}

	if (method === "POST" && path === "/api/v1/slip-payments/upload-order") {
		const u = requireAuth(state); if (!u) return err(401, "not authenticated");
		const body = init?.body;
		if (!(body instanceof FormData)) return err(400, "expected multipart");
		const itemsJson = body.get("items_json");
		const couponCode = String(body.get("coupon_code") ?? "").trim().toUpperCase();
		let rawItems: any[] = [];
		try { rawItems = JSON.parse(String(itemsJson ?? "[]")); }
		catch { return err(400, "items_json ไม่ถูกต้อง"); }
		if (!Array.isArray(rawItems) || rawItems.length === 0) return err(400, "ตะกร้าว่าง");

		// Re-quote on the server-mock so the buyer can't tamper.
		const quoteRes = await handle(
			new URL("http://mock/api/v1/orders/quote"),
			"POST",
			{ body: JSON.stringify({ items: rawItems, code: couponCode || null }) },
		);
		const quote = await quoteRes.json();
		if (!quoteRes.ok) return err(quoteRes.status, quote?.detail ?? "quote failed");
		if (couponCode && !quote.coupon && quote.coupon_reason) {
			return err(400, quote.coupon_reason);
		}

		const orderId = `o-${Date.now()}`;
		const slipId = `s-${Date.now()}`;
		// Record redemption (mock skips the awaiting state).
		if (quote.coupon) {
			const c = state.coupons.find((x) => x.code.toUpperCase() === quote.coupon!.code);
			if (c) {
				c.usage_count = (c.usage_count ?? 0) + 1;
				state.couponRedemptions.unshift({
					id: `cr-${Date.now()}`,
					coupon_id: c.id, user_id: u.id, user_email: u.email,
					payment_id: null, slip_upload_id: slipId,
					original_baht: quote.subtotal_baht,
					discount_baht: quote.discount_baht,
					final_baht: quote.final_baht,
					redeemed_at: new Date().toISOString(),
				});
			}
		}
		save(state);
		if (quote.final_baht <= 0) {
			return ok({
				status: "auto_approved",
				message: "ใช้คูปองสำเร็จ — เปิดสิทธิ์เรียนให้แล้ว",
				slip_id: slipId, order_id: orderId,
			});
		}
		return ok({
			status: "auto_approved",
			message: "ระบบตรวจสลิปอัตโนมัติเรียบร้อย เปิดสิทธิ์เข้าเรียนให้แล้ว",
			slip_id: slipId, order_id: orderId,
		});
	}

	if (method === "POST" && path === "/api/v1/slip-payments/upload") {
		const u = requireAuth(state); if (!u) return err(401, "not authenticated");
		const body = await readJson(init);
		const couponCode = body.coupon_code ? String(body.coupon_code).trim().toUpperCase() : "";
		const slipId = `s-${Date.now()}`;
		// Look up the coupon (if any) so we can record the redemption mock-side.
		const c = couponCode
			? state.coupons.find((x) => x.code.toUpperCase() === couponCode)
			: null;
		if (c) {
			// Resolve price for redemption record.
			let price = 0;
			if (body.course_slug) {
				const course = state.courses.find((x) => x.slug === body.course_slug);
				if (course) price = course.price_baht;
			}
			let discount = 0;
			if (c.kind === "full") discount = price;
			else if (c.kind === "fixed") discount = Math.min(c.amount_baht ?? 0, price);
			else if (c.kind === "percent") {
				let raw = Math.floor(price * (c.percent ?? 0) / 100);
				if (c.max_discount_baht != null) raw = Math.min(raw, c.max_discount_baht);
				discount = Math.min(raw, price);
			}
			c.usage_count = (c.usage_count ?? 0) + 1;
			state.couponRedemptions.unshift({
				id: `cr-${Date.now()}`,
				coupon_id: c.id,
				user_id: u.id,
				user_email: u.email,
				payment_id: null,
				slip_upload_id: slipId,
				original_baht: price,
				discount_baht: discount,
				final_baht: price - discount,
				redeemed_at: new Date().toISOString(),
			});
			save(state);
			if (price - discount === 0) {
				return ok({
					status: "auto_approved",
					message: "ใช้คูปองสำเร็จ — เปิดสิทธิ์เรียนให้แล้ว",
					slip_id: null,
				});
			}
		}
		return ok({
			status: "auto_approved",
			message: "ระบบตรวจสลิปอัตโนมัติเรียบร้อย เปิดสิทธิ์เข้าเรียนให้แล้ว",
			slip_id: slipId,
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
		{
			const m = /^\/api\/v1\/admin\/lessons\/([^/]+)$/.exec(path);
			if (m && (method === "PATCH" || method === "DELETE")) {
				const lessonId = m[1];
				let course: MockCourse | undefined;
				let lessonIdx = -1;
				for (const c of state.courses) {
					const i = c.lessons.findIndex((l) => l.id === lessonId);
					if (i >= 0) { course = c; lessonIdx = i; break; }
				}
				if (!course || lessonIdx < 0) return err(404, "ไม่พบบทเรียน");
				if (method === "DELETE") {
					course.lessons.splice(lessonIdx, 1);
					save(state);
					return ok({ ok: true });
				}
				const b = await readJson(init);
				const lesson = course.lessons[lessonIdx];
				if (b.title !== undefined) lesson.title = b.title;
				if (b.is_preview !== undefined) lesson.is_preview = !!b.is_preview;
				if (b.price_baht !== undefined) (lesson as any).price_baht = b.price_baht;
				if (b.position !== undefined && b.position !== lesson.position) {
					const other = course.lessons.find((l) => l.position === b.position && l.id !== lesson.id);
					if (other) {
						other.position = lesson.position;
					}
					lesson.position = b.position;
				}
				save(state);
				return ok({ ok: true });
			}
		}
		{
			const m = /^\/api\/v1\/admin\/lessons\/([^/]+)\/materials$/.exec(path);
			if (m && method === "GET") {
				return ok(
					state.materials
						.filter((mm) => mm.lesson_id === m[1])
						.map((mm) => ({
							id: mm.id,
							filename: mm.filename,
							content_type: mm.content_type,
							size_bytes: mm.size_bytes,
							created_at: mm.created_at,
						})),
				);
			}
			if (m && method === "POST") {
				const lessonId = m[1]!;
				const exists = state.courses.some((c) => c.lessons.some((l) => l.id === lessonId));
				if (!exists) return err(404, "ไม่พบบทเรียน");
				const body = init?.body;
				let filename = "unnamed";
				let ctype = "application/octet-stream";
				let size = 0;
				if (body instanceof FormData) {
					const f = body.get("file");
					if (f && typeof (f as any) === "object" && "name" in (f as any)) {
						const file = f as File;
						filename = file.name.replace(/[\\/]/g, "_");
						ctype = file.type || "application/octet-stream";
						size = file.size;
					}
				}
				const id = `mat-${Date.now()}`;
				const mat: MockMaterial = {
					id, lesson_id: lessonId, course_slug: null, filename, content_type: ctype,
					size_bytes: size, created_at: new Date().toISOString(),
				};
				state.materials.push(mat);
				save(state);
				return ok({ id, filename, size_bytes: size, content_type: ctype }, 201);
			}
		}
		{
			const m = /^\/api\/v1\/admin\/materials\/([^/]+)$/.exec(path);
			if (m && method === "DELETE") {
				const idx = state.materials.findIndex((x) => x.id === m[1]);
				if (idx < 0) return err(404, "ไม่พบเอกสาร");
				state.materials.splice(idx, 1);
				save(state);
				return ok({ ok: true });
			}
		}
		if (method === "POST" && path === "/api/v1/admin/courses") {
			const b = await readJson(init);
			const c: MockCourse = {
				id: `c-${Date.now()}`,
				slug: b.slug, title: b.title,
				description: b.description ?? "",
				price_baht: b.price_baht ?? 0,
				access_duration_days: b.access_duration_days ?? null,
				pixel_watermark: !!b.pixel_watermark,
				is_featured: !!b.is_featured,
				cover_data_url: null,
				lessons: [],
			};
			state.courses.push(c);
			save(state);
			return ok({ id: c.id });
		}
		{
			const m = /^\/api\/v1\/admin\/courses\/([^/]+)\/cover$/.exec(path);
			if (m && method === "POST") {
				const c = state.courses.find((x) => x.slug === m[1]);
				if (!c) return err(404, "ไม่พบคอร์ส");
				const body = init?.body;
				if (!(body instanceof FormData)) return err(400, "expected multipart");
				const f = body.get("file");
				if (!(f && typeof (f as any) === "object" && "arrayBuffer" in (f as any))) {
					return err(400, "missing file");
				}
				const file = f as File;
				if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
					return err(415, `cover must be jpeg/png/webp, got ${file.type}`);
				}
				if (file.size > 5 * 1024 * 1024) return err(413, "cover exceeds 5 MB");
				const buf = new Uint8Array(await file.arrayBuffer());
				let bin = "";
				for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
				c.cover_data_url = `data:${file.type};base64,${btoa(bin)}`;
				save(state);
				return ok({ cover_url: `/api/v1/courses/${c.slug}/cover` }, 201);
			}
			if (m && method === "DELETE") {
				const c = state.courses.find((x) => x.slug === m[1]);
				if (!c) return err(404, "ไม่พบคอร์ส");
				c.cover_data_url = null;
				save(state);
				return ok({ ok: true });
			}
		}
		{
			const m = /^\/api\/v1\/admin\/courses\/([^/]+)\/materials$/.exec(path);
			if (m && method === "GET") {
				const slug = m[1];
				return ok(
					state.materials
						.filter((mm) => mm.course_slug === slug)
						.map((mm) => ({
							id: mm.id, filename: mm.filename, content_type: mm.content_type,
							size_bytes: mm.size_bytes, created_at: mm.created_at,
						})),
				);
			}
			if (m && method === "POST") {
				const slug = m[1]!;
				if (!state.courses.some((c) => c.slug === slug)) return err(404, "ไม่พบคอร์ส");
				const body = init?.body;
				let filename = "unnamed";
				let ctype = "application/octet-stream";
				let size = 0;
				if (body instanceof FormData) {
					const f = body.get("file");
					if (f && typeof (f as any) === "object" && "name" in (f as any)) {
						const file = f as File;
						filename = file.name.replace(/[\\/]/g, "_");
						ctype = file.type || "application/octet-stream";
						size = file.size;
					}
				}
				const id = `mat-${Date.now()}`;
				state.materials.push({
					id, lesson_id: null, course_slug: slug, filename, content_type: ctype,
					size_bytes: size, created_at: new Date().toISOString(),
				});
				save(state);
				return ok({ id, filename, size_bytes: size, content_type: ctype }, 201);
			}
		}
		{
			const m = /^\/api\/v1\/admin\/courses\/([^/]+)$/.exec(path);
			if (m && method === "PATCH") {
				const c = state.courses.find((x) => x.slug === m[1]);
				if (!c) return err(404, "ไม่พบคอร์ส");
				const b = await readJson(init);
				if (b.title !== undefined) c.title = b.title;
				if (b.description !== undefined) c.description = b.description;
				if (b.price_baht !== undefined) c.price_baht = b.price_baht;
				if (b.access_duration_days !== undefined) c.access_duration_days = b.access_duration_days;
				if (b.pixel_watermark !== undefined) c.pixel_watermark = !!b.pixel_watermark;
				if (b.is_featured !== undefined) c.is_featured = !!b.is_featured;
				save(state);
				return ok({ ok: true });
			}
			if (m && method === "DELETE") {
				const idx = state.courses.findIndex((x) => x.slug === m[1]);
				if (idx < 0) return err(404, "ไม่พบคอร์ส");
				state.courses.splice(idx, 1);
				save(state);
				return ok({ ok: true });
			}
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
			const ps = state.payment_settings;
			const eff = (db: string | null, env: string) => db !== null ? db : env;
			const slipok_configured = !!(eff(ps.slipok_api_key, MOCK_PAY_ENV.slipok_api_key)
				&& eff(ps.slipok_branch_id, MOCK_PAY_ENV.slipok_branch_id));
			const receiver_bank_set = !!eff(ps.receiver_bank_account, MOCK_PAY_ENV.receiver_bank_account);
			const e = MOCK_EMAIL_ENV;
			const provider = mockEmail.provider ?? e.provider;
			const api_key = mockEmail.api_key !== undefined ? mockEmail.api_key : e.api_key;
			const from_email = mockEmail.from_email ?? e.from_email;
			const from_name = mockEmail.from_name ?? e.from_name;
			const configured = provider === "disabled" ? false
				: provider === "smtp" ? !!e.smtp_host
				: !!api_key;
			return ok({
				email: {
					provider, configured,
					from: from_email,
					from_name: from_name || null,
					api_key_set: !!api_key,
					smtp_host: e.smtp_host, smtp_port: e.smtp_port, smtp_use_tls: e.smtp_use_tls,
					smtp_user: e.smtp_user || null, smtp_password_set: !!e.smtp_password,
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
					slipok_configured,
					receiver_bank_set,
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

		if (method === "GET" && path === "/api/v1/admin/email-settings") {
			const e = MOCK_EMAIL_ENV;
			const provider = mockEmail.provider ?? e.provider;
			const api_key = mockEmail.api_key !== undefined ? mockEmail.api_key : e.api_key;
			const from_email = mockEmail.from_email ?? e.from_email;
			const from_name = mockEmail.from_name ?? e.from_name;
			const configured = provider === "disabled" ? false
				: provider === "smtp" ? !!e.smtp_host
				: !!api_key;
			return ok({
				provider,
				api_key_set: !!api_key,
				from_email,
				from_name,
				configured,
				smtp: {
					host: e.smtp_host, port: e.smtp_port, use_tls: e.smtp_use_tls,
					user: e.smtp_user || null, password_set: !!e.smtp_password,
				},
				overrides: {
					provider: mockEmail.provider !== undefined,
					api_key: mockEmail.api_key !== undefined,
					from_email: mockEmail.from_email !== undefined,
					from_name: mockEmail.from_name !== undefined,
				},
			});
		}

		if (method === "PUT" && path === "/api/v1/admin/email-settings") {
			const b = await readJson(init);
			if ("provider" in b) {
				mockEmail.provider = b.provider === null ? undefined : b.provider;
			}
			if ("from_email" in b) {
				mockEmail.from_email = b.from_email === null ? undefined : b.from_email;
			}
			if ("from_name" in b) {
				mockEmail.from_name = b.from_name === null ? undefined : b.from_name;
			}
			if (b.clear_api_key) {
				mockEmail.api_key = undefined;
			} else if (typeof b.api_key === "string" && b.api_key.trim()) {
				mockEmail.api_key = b.api_key;
			}
			return ok({ ok: true });
		}
		if (method === "GET" && path === "/api/v1/admin/payment-settings") {
			const ps = state.payment_settings;
			const eff = (db: string | null, env: string) => db !== null ? db : env;
			return ok({
				receiver_bank_name: eff(ps.receiver_bank_name, MOCK_PAY_ENV.receiver_bank_name),
				receiver_bank_account: eff(ps.receiver_bank_account, MOCK_PAY_ENV.receiver_bank_account),
				receiver_name: eff(ps.receiver_name, MOCK_PAY_ENV.receiver_name),
				promptpay_id: eff(ps.promptpay_id, MOCK_PAY_ENV.promptpay_id),
				slipok_branch_id: eff(ps.slipok_branch_id, MOCK_PAY_ENV.slipok_branch_id),
				slipok_api_key_set: !!eff(ps.slipok_api_key, MOCK_PAY_ENV.slipok_api_key),
				slipok_enabled: !!(eff(ps.slipok_api_key, MOCK_PAY_ENV.slipok_api_key)
					&& eff(ps.slipok_branch_id, MOCK_PAY_ENV.slipok_branch_id)),
				receiver_bank_set: !!eff(ps.receiver_bank_account, MOCK_PAY_ENV.receiver_bank_account),
				overrides: {
					receiver_bank_name: ps.receiver_bank_name !== null,
					receiver_bank_account: ps.receiver_bank_account !== null,
					receiver_name: ps.receiver_name !== null,
					promptpay_id: ps.promptpay_id !== null,
					slipok_branch_id: ps.slipok_branch_id !== null,
					slipok_api_key: ps.slipok_api_key !== null,
				},
			});
		}
		if (method === "PUT" && path === "/api/v1/admin/payment-settings") {
			const b = await readJson(init);
			const ps = state.payment_settings;
			const setIf = (k: keyof typeof ps) => {
				if (k in b) ps[k] = b[k] === "" ? "" : (b[k] ?? null);
			};
			setIf("receiver_bank_name");
			setIf("receiver_bank_account");
			setIf("receiver_name");
			setIf("promptpay_id");
			setIf("slipok_branch_id");
			if (b.clear_slipok_api_key) {
				ps.slipok_api_key = null;
			} else if (typeof b.slipok_api_key === "string" && b.slipok_api_key.trim()) {
				ps.slipok_api_key = b.slipok_api_key;
			}
			save(state);
			return ok({ ok: true });
		}
		if (method === "POST" && path === "/api/v1/admin/settings/test-email") {
			return ok({ ok: true });
		}

		// ----- admin: coupons -------------------------------------------------
		if (method === "GET" && path === "/api/v1/admin/coupons") {
			const activeOnly = search.get("active_only") === "true";
			const rows = activeOnly
				? state.coupons.filter((c) => c.is_active)
				: state.coupons;
			return ok(rows.map((c) => ({
				...c,
				target_course_id: c.target_course_slug ? `c-${c.target_course_slug}` : null,
				target_lesson_title: null,
			})));
		}
		if (method === "POST" && path === "/api/v1/admin/coupons") {
			const b = await readJson(init);
			const code = String(b.code ?? "").trim().toUpperCase();
			if (!code) return err(422, "code required");
			if (state.coupons.find((x) => x.code.toUpperCase() === code)) {
				return err(409, "โค้ดนี้มีอยู่แล้ว");
			}
			const c: MockCoupon = {
				id: `cp-${Date.now()}`,
				code,
				kind: b.kind,
				amount_baht: b.amount_baht ?? null,
				percent: b.percent ?? null,
				max_discount_baht: b.max_discount_baht ?? null,
				min_purchase_baht: b.min_purchase_baht ?? 0,
				scope: b.scope ?? "all",
				target_course_slug: b.target_course_slug ?? null,
				target_lesson_id: b.target_lesson_id ?? null,
				valid_from: b.valid_from ?? null,
				valid_until: b.valid_until ?? null,
				usage_limit: b.usage_limit ?? null,
				per_user_limit: b.per_user_limit ?? null,
				usage_count: 0,
				is_active: b.is_active ?? true,
				note: b.note ?? null,
				created_at: new Date().toISOString(),
			};
			state.coupons.unshift(c);
			save(state);
			return ok({ ...c, target_course_id: null, target_lesson_title: null });
		}
		{
			const m = /^\/api\/v1\/admin\/coupons\/([^/]+)$/.exec(path);
			if (m) {
				const c = state.coupons.find((x) => x.id === m[1]);
				if (!c) return err(404, "coupon not found");
				if (method === "PATCH") {
					const b = await readJson(init);
					for (const f of [
						"kind", "amount_baht", "percent", "max_discount_baht",
						"min_purchase_baht", "scope", "target_course_slug",
						"target_lesson_id", "valid_from", "valid_until",
						"usage_limit", "per_user_limit", "is_active", "note",
					] as (keyof MockCoupon)[]) {
						if (f in b) (c as any)[f] = (b as any)[f];
					}
					save(state);
					return ok({ ...c, target_course_id: null, target_lesson_title: null });
				}
				if (method === "DELETE") {
					c.is_active = false;
					save(state);
					return ok({ ok: true });
				}
			}
		}
		{
			const m = /^\/api\/v1\/admin\/coupons\/([^/]+)\/redemptions$/.exec(path);
			if (m && method === "GET") {
				const rows = state.couponRedemptions.filter((r) => r.coupon_id === m[1]);
				return ok(rows);
			}
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
		if (method === "POST" && path === "/api/v1/admin/encode-jobs") {
			const b = await readJson(init);
			const id = `j-${Date.now()}`;
			state.encodeJobs.unshift({
				id, upload_id: b.upload_id, course_slug: b.course_slug,
				lesson_title: b.lesson_title, is_preview: !!b.is_preview,
				source_filename: b.source_filename ?? "source.mp4",
				source_size: b.source_size ?? 0,
				created_at: new Date().toISOString(),
			});
			save(state);
			return ok({ job_id: id, status: "queued" }, 202);
		}
		if (method === "GET" && path === "/api/v1/admin/encode-jobs") {
			// Synthesise status from elapsed time so the demo feels alive:
			//   <2s queued, <12s encoding, after that done.
			const now = Date.now();
			const limit = Number(search.get("limit") ?? "20");
			const rows = state.encodeJobs.slice(0, limit).map((j) => {
				const age = (now - new Date(j.created_at).getTime()) / 1000;
				let status: string;
				let video_id: string | null = j.video_id ?? null;
				let error: string | null = null;
				if (age < 2) status = "queued";
				else if (age < 12) status = "encoding";
				else {
					status = "done";
					if (!video_id) {
						video_id = `v-${j.id.slice(2)}`;
						j.video_id = video_id;
					}
				}
				return {
					id: j.id, upload_id: j.upload_id,
					course_slug: j.course_slug, lesson_title: j.lesson_title,
					status, error, video_id,
					created_at: j.created_at,
				};
			});
			save(state);
			return ok(rows);
		}

		if (method === "GET" && path === "/api/v1/admin/video-health") {
			const now = new Date();
			const day = (h: number) => {
				const d = new Date(now); d.setHours(d.getHours() - (23 - h), 0, 0, 0);
				return d.toISOString();
			};
			const enc_spark = Array.from({ length: 24 }, (_, h) => ({
				hour: day(h),
				pending: h === 23 ? 1 : 0,
				running: h === 23 ? 1 : 0,
				done: Math.max(0, Math.round(2 + 3 * Math.sin(h * 0.6))),
				failed: h === 14 ? 1 : 0,
			}));
			const pb_spark = Array.from({ length: 24 }, (_, h) => ({
				hour: day(h),
				granted: Math.round(40 + 60 * Math.abs(Math.sin(h * 0.4))),
				denied: h === 7 ? 12 : Math.round(2 + 3 * Math.abs(Math.cos(h * 0.5))),
			}));
			const grants_24h = pb_spark.reduce((s, r) => s + r.granted, 0);
			const denies_24h = pb_spark.reduce((s, r) => s + r.denied, 0);
			return ok({
				generated_at: now.toISOString(),
				encode: {
					last_24h: { pending: 1, running: 1, done: enc_spark.reduce((s, r) => s + r.done, 0), failed: 1 },
					recent_failed: [
						{
							id: "j-fail-1",
							course_slug: "buddhist-philosophy",
							lesson_title: "อนัตตากับการปล่อยวาง",
							error: "ffmpeg exit 1: Invalid data found when processing input",
							created_at: new Date(now.getTime() - 10 * 3600_000).toISOString(),
							updated_at: new Date(now.getTime() - 10 * 3600_000 + 90_000).toISOString(),
						},
					],
					recent_done: state.courses.flatMap((c) => c.lessons.slice(0, 1).map((l, i) => ({
						id: `j-done-${c.slug}-${i}`,
						course_slug: c.slug,
						lesson_title: l.title,
						created_at: new Date(now.getTime() - (i + 2) * 1800_000).toISOString(),
						updated_at: new Date(now.getTime() - (i + 2) * 1800_000 + 240_000).toISOString(),
						duration_sec: 240,
					}))).slice(0, 6),
					sparkline_24h: enc_spark,
				},
				playback: {
					grants_24h,
					denies_24h,
					deny_reasons: [
						{ reason: "expired_session", count: 18 },
						{ reason: "device_mismatch", count: 11 },
						{ reason: "rate_limited", count: 7 },
						{ reason: "no_entitlement", count: 4 },
					],
					sparkline_24h: pb_spark,
				},
				suspicious: {
					multi_user_ips: [
						{ ip: "203.0.113.45", user_count: 3, request_count: 47 },
					],
					multi_ip_users: [
						{ user_id: "u-2", email: "siriporn@example.com", ip_count: 5, request_count: 62 },
					],
					thresholds: { users_per_ip: 2, ips_per_user: 4 },
				},
				storage: {
					reachable: true,
					latency_ms: 38.4,
					error: null,
					bucket: "course-platform-media",
				},
				sessions: {
					total_active: 7,
					max_per_user: 3,
					near_max: [
						{ user_id: "u-1", count: 3 },
						{ user_id: "u-2", count: 2 },
					],
				},
				videos: { total: 11, encoded_today: 2 },
			});
		}

		// ----- new admin endpoints (dashboard / user mgmt / audit / broadcast) ----
		if (method === "GET" && path === "/api/v1/admin/dashboard") {
			const sparkline = Array.from({ length: 30 }, (_, i) => {
				const d = new Date(); d.setDate(d.getDate() - (29 - i));
				return {
					date: d.toISOString().slice(0, 10),
					revenue_baht: Math.round(2000 + 4000 * Math.abs(Math.sin(i * 0.7))),
				};
			});
			return ok({
				revenue: { today_baht: 5400, month_baht: 84200, total_baht: 612400 },
				pending_slips: 2,
				new_users_7d: 17,
				coupons_today: 3,
				suspicious_logins_24h: 0,
				top_courses: state.courses.slice(0, 5).map((c, i) => ({
					slug: c.slug, title: c.title,
					sold: 24 - i * 4, revenue_baht: (24 - i * 4) * (c.price_baht ?? 599),
				})),
				sparkline_30d: sparkline,
			});
		}

		if (method === "GET" && path === "/api/v1/admin/users/search") {
			const q = (search.get("q") ?? "").toLowerCase();
			const role = search.get("role");
			const status_filter = search.get("status_filter");
			const sort = search.get("sort") ?? "created_desc";
			const limit = Math.min(Number(search.get("limit") ?? "100"), 500);
			const offset = Number(search.get("offset") ?? "0");
			let pool = state.users.slice();
			if (q) pool = pool.filter((u) => u.email.toLowerCase().includes(q));
			if (role === "admin") pool = pool.filter((u) => u.is_admin);
			else if (role === "user") pool = pool.filter((u) => !u.is_admin);
			if (status_filter === "active") pool = pool.filter((u) => u.is_active);
			else if (status_filter === "suspended") pool = pool.filter((u) => !u.is_active);
			else if (status_filter === "unverified") pool = pool.filter((u) => !(u as any).email_verified);
			if (sort === "created_asc") pool.sort((a, b) => a.created_at.localeCompare(b.created_at));
			else if (sort === "email_asc") pool.sort((a, b) => a.email.localeCompare(b.email));
			else pool.sort((a, b) => b.created_at.localeCompare(a.created_at));
			const total = pool.length;
			const rows = pool.slice(offset, offset + limit).map((u) => ({
				id: u.id, email: u.email, is_admin: u.is_admin, is_active: u.is_active,
				email_verified: (u as any).email_verified ?? true,
				created_at: u.created_at,
			}));
			return ok({ total, rows });
		}

		{
			const m = /^\/api\/v1\/admin\/users\/([^/]+)$/.exec(path);
			if (m && method === "GET") {
				const usr = state.users.find((x) => x.id === m[1]);
				if (!usr) return err(404, "user not found");
				return ok({
					user: {
						id: usr.id, email: usr.email, is_admin: usr.is_admin,
						is_active: usr.is_active,
						email_verified: (usr as any).email_verified ?? true,
						created_at: usr.created_at,
						tax_name: null, tax_id: null,
					},
					enrollments: [], payments: [], devices: [], logins: [], slips: [],
				});
			}
			if (m && method === "PATCH") {
				const usr = state.users.find((x) => x.id === m[1]);
				if (!usr) return err(404, "user not found");
				const b = await readJson(init);
				if (b.is_active !== undefined) usr.is_active = !!b.is_active;
				if (b.is_admin !== undefined) usr.is_admin = !!b.is_admin;
				save(state);
				return ok({ ok: true, user: { ...usr } });
			}
			if (m && method === "DELETE") {
				const idx = state.users.findIndex((x) => x.id === m[1]);
				if (idx < 0) return err(404, "user not found");
				state.users.splice(idx, 1);
				save(state);
				return ok({ ok: true });
			}
		}
		{
			const m = /^\/api\/v1\/admin\/users\/([^/]+)\/revoke-devices$/.exec(path);
			if (m && method === "POST") return ok({ ok: true, revoked: 0 });
		}
		{
			const m = /^\/api\/v1\/admin\/users\/([^/]+)\/reset-password$/.exec(path);
			if (m && method === "POST") {
				return ok({
					ok: true,
					reset_url: `${location.origin}/reset-password?token=mock-${Math.random().toString(36).slice(2)}`,
					ttl_minutes: 30,
				}, 202);
			}
		}
		if (method === "POST" && path === "/api/v1/admin/users/bulk") {
			const b = await readJson(init);
			const ids = new Set<string>(b.user_ids ?? []);
			let affected = 0;
			for (const u of state.users.slice()) {
				if (!ids.has(u.id)) continue;
				if (b.action === "suspend" && u.is_active) { u.is_active = false; affected++; }
				else if (b.action === "activate" && !u.is_active) { u.is_active = true; affected++; }
				else if (b.action === "promote" && !u.is_admin) { u.is_admin = true; affected++; }
				else if (b.action === "demote" && u.is_admin) { u.is_admin = false; affected++; }
				else if (b.action === "delete") {
					const i = state.users.findIndex((x) => x.id === u.id);
					if (i >= 0) { state.users.splice(i, 1); affected++; }
				}
			}
			save(state);
			return ok({ ok: true, affected });
		}

		if (method === "GET" && path === "/api/v1/admin/audit") {
			return ok({ total: 0, rows: [] });
		}

		if (method === "POST" && path === "/api/v1/admin/email-broadcast") {
			const b = await readJson(init);
			let count = 0;
			if (b.audience === "all") count = state.users.length;
			else if (b.audience === "active") count = state.users.filter((u) => u.is_active).length;
			else if (b.audience === "admins") count = state.users.filter((u) => u.is_admin).length;
			else if (b.audience === "enrolled") count = Math.min(8, state.users.length);
			return ok({
				recipient_count: count,
				dry_run: !!b.dry_run,
				queued: !b.dry_run,
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
