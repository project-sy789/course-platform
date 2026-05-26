"use client";
import Link from "next/link";

export default function PaymentSuccessPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm rounded-xl border border-emerald-700 bg-emerald-950/30 p-6 text-center">
        <h1 className="text-xl font-semibold mb-2">Payment received</h1>
        <p className="opacity-80 mb-4">
          Your enrollment is being activated by our payment processor.
          This usually takes a few seconds.
        </p>
        <Link href="/" className="underline">Browse courses</Link>
      </div>
    </main>
  );
}
