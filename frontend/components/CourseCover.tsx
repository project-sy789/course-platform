"use client";

/**
 * Deterministic editorial cover for a course.
 *
 * No images, no stock photos — a typeset "plate" sized like the inner
 * front cover of a hardback: hashed paper tone, large serif initial,
 * thin double-rule border, and a Thai-print ornamental flourish in the
 * corner. Same slug always produces the same cover so users build
 * recognition over time.
 */

const PALETTES: Array<{ bg: string; ink: string; rule: string; accent: string }> = [
  { bg: "#ebe3cf", ink: "#1c1814", rule: "#1c1814", accent: "#7a1c1c" }, // cream
  { bg: "#dfd5be", ink: "#241a14", rule: "#241a14", accent: "#5a2018" }, // oat
  { bg: "#e8d9c4", ink: "#2a1810", rule: "#2a1810", accent: "#7a1c1c" }, // bisque
  { bg: "#cfd9cf", ink: "#1a2018", rule: "#1a2018", accent: "#3a4a2a" }, // sage
  { bg: "#d8cfc0", ink: "#1c1814", rule: "#1c1814", accent: "#7a1c1c" }, // taupe
  { bg: "#e3d6c8", ink: "#1d1410", rule: "#1d1410", accent: "#6e1818" }, // sand
  { bg: "#d3c8b4", ink: "#241c14", rule: "#241c14", accent: "#583414" }, // umber
  { bg: "#dfd2bd", ink: "#1c1814", rule: "#1c1814", accent: "#7a1c1c" }, // parchment
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function paletteFor(slug: string) {
  return PALETTES[hash(slug) % PALETTES.length]!;
}

function initial(title: string): string {
  const t = title.trim();
  return t ? Array.from(t)[0]! : "?";
}

type Variant = "card" | "hero" | "thumb";

const SIZES: Record<Variant, { w: number; h: number; initial: number; sub: number; pad: number }> = {
  card:  { w: 600, h: 800,  initial: 360, sub: 22, pad: 36 },
  hero:  { w: 900, h: 600,  initial: 380, sub: 26, pad: 44 },
  thumb: { w: 240, h: 320,  initial: 150, sub: 13, pad: 18 },
};

export function CourseCover({
  slug,
  title,
  variant = "card",
  className = "",
  kicker,
  coverUrl,
}: {
  slug: string;
  title: string;
  variant?: Variant;
  className?: string;
  kicker?: string;
  coverUrl?: string | null;
}) {
  if (coverUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={coverUrl}
        alt={title}
        className={`object-cover ${className}`}
      />
    );
  }
  const p = paletteFor(slug);
  const s = SIZES[variant];
  const ch = initial(title);
  const tag = kicker ?? slug;

  // Tiny noise / texture made from deterministic dots so each cover is
  // visually distinct without needing real artwork.
  const dots: { cx: number; cy: number; r: number; o: number }[] = [];
  let seed = hash(slug);
  for (let i = 0; i < 80; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    dots.push({
      cx: (seed % s.w),
      cy: ((seed >> 8) % s.h),
      r: 0.6 + ((seed >> 16) % 14) / 10,
      o: 0.05 + ((seed >> 4) % 8) / 100,
    });
  }

  return (
    <svg
      viewBox={`0 0 ${s.w} ${s.h}`}
      preserveAspectRatio="xMidYMid slice"
      className={className}
      role="img"
      aria-label={title}
    >
      <rect x={0} y={0} width={s.w} height={s.h} fill={p.bg} />
      {dots.map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill={p.ink} opacity={d.o} />
      ))}

      {/* double rule border — a typographer's frame */}
      <rect
        x={s.pad} y={s.pad}
        width={s.w - s.pad * 2} height={s.h - s.pad * 2}
        fill="none" stroke={p.rule} strokeWidth={1}
      />
      <rect
        x={s.pad + 6} y={s.pad + 6}
        width={s.w - s.pad * 2 - 12} height={s.h - s.pad * 2 - 12}
        fill="none" stroke={p.rule} strokeWidth={0.5}
      />

      {/* corner ornaments — diamond + tick */}
      {[
        [s.pad + 14, s.pad + 14],
        [s.w - s.pad - 14, s.pad + 14],
        [s.pad + 14, s.h - s.pad - 14],
        [s.w - s.pad - 14, s.h - s.pad - 14],
      ].map(([cx, cy], i) => (
        <g key={i} transform={`translate(${cx} ${cy}) rotate(45)`}>
          <rect x={-3} y={-3} width={6} height={6} fill={p.accent} />
        </g>
      ))}

      {/* kicker — small uppercase tag at top */}
      <text
        x={s.w / 2} y={s.pad + 38}
        textAnchor="middle"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        fontSize={s.sub * 0.55}
        letterSpacing={2.4}
        fill={p.ink}
        opacity={0.55}
      >
        {tag.toUpperCase()}
      </text>

      {/* the initial letter — the centerpiece */}
      <text
        x={s.w / 2} y={s.h / 2 + s.initial * 0.18}
        textAnchor="middle"
        fontFamily="'IBM Plex Serif', 'Sarabun', Georgia, serif"
        fontWeight={600}
        fontSize={s.initial}
        fill={p.ink}
      >
        {ch}
      </text>

      {/* accent rule under the initial */}
      <line
        x1={s.w / 2 - s.initial * 0.22}
        x2={s.w / 2 + s.initial * 0.22}
        y1={s.h / 2 + s.initial * 0.32}
        y2={s.h / 2 + s.initial * 0.32}
        stroke={p.accent}
        strokeWidth={2}
      />

      {/* foot — small course-row dressing */}
      <text
        x={s.w / 2} y={s.h - s.pad - 24}
        textAnchor="middle"
        fontFamily="'IBM Plex Serif', 'Sarabun', Georgia, serif"
        fontStyle="italic"
        fontSize={s.sub}
        fill={p.ink}
        opacity={0.7}
      >
        ondemand · ฉบับนักเรียน
      </text>
    </svg>
  );
}
