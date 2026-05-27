export default function RootLoading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted mb-3">
          กำลังเตรียมหน้า
        </div>
        <div className="font-display italic text-2xl text-ink/60">
          โปรดรอสักครู่
          <span className="inline-block animate-pulse">…</span>
        </div>
      </div>
    </div>
  );
}
