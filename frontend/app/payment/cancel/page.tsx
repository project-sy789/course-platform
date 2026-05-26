"use client";
import Link from "next/link";

export default function PaymentCancelPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm rounded-xl border border-neutral-800 p-6 text-center">
        <h1 className="text-xl font-semibold mb-2">Payment cancelled</h1>
        <p className="opacity-80 mb-4">No charge was made.</p>
        <Link href="/" className="underline">Back to courses</Link>
      </div>
    </main>
  );
}
