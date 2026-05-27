"use client";
// Right-hand side of the public masthead. Swaps between guest + signed-in
// states by polling /auth/me on mount. Shows a "กองบรรณาธิการ" link only
// when the signed-in user is an admin — that's the entry point to /admin
// from the public surface.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

type Me = { id: string; email: string; is_admin?: boolean };

export default function AccountNav() {
	const [me, setMe] = useState<Me | null>(null);
	const [checked, setChecked] = useState(false);
	const router = useRouter();
	const pathname = usePathname();

	// Refetch on every route change so logout/login from any page reflects
	// in the masthead without a full reload.
	useEffect(() => {
		apiFetch<Me>("/api/v1/auth/me")
			.then(setMe)
			.catch((e: ApiError) => {
				if (e.status === 401) setMe(null);
			})
			.finally(() => setChecked(true));
	}, [pathname]);

	async function logout() {
		try {
			await apiFetch("/api/v1/auth/logout-all", { method: "POST" });
		} catch {
			/* ignore — mock or already-expired session */
		}
		setMe(null);
		router.push("/");
		router.refresh();
	}

	if (!checked) {
		return <span className="text-muted text-[12px]">…</span>;
	}

	if (!me) {
		return (
			<Link href="/login" className="lede">
				เข้าสู่ระบบ →
			</Link>
		);
	}

	return (
		<div className="flex items-center gap-x-5 gap-y-1 flex-wrap">
			{me.is_admin && (
				<Link
					href="/admin"
					className="text-[12px] uppercase tracking-[0.18em] text-oxblood hover:underline underline-offset-4 decoration-1"
				>
					กองบรรณาธิการ →
				</Link>
			)}
			<span className="text-[12px] text-muted font-mono truncate max-w-[12rem]">
				{me.email}
			</span>
			<button
				onClick={logout}
				className="text-[12px] text-muted hover:text-ink underline underline-offset-4 decoration-1"
			>
				ออก
			</button>
		</div>
	);
}
