import { motion } from 'motion/react';
import { useId } from 'react';

/**
 * The Querion mark: a constellation of seven stars joined into a "Q", with the
 * tail ending in a bright cyan star (the answer). Stars twinkle; the path draws in.
 */
const STARS: [number, number, number][] = [
  [32, 11, 3.2],
  [48, 20, 2.4],
  [51, 37, 2.7],
  [41, 50, 2.4],
  [23, 50, 2.7],
  [13, 37, 2.4],
  [16, 20, 2.7],
];

export function LogoMark({ size = 32, animate = true, className }: { size?: number; animate?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  const ring = 'M32 11 L48 20 L51 37 L41 50 L23 50 L13 37 L16 20 Z';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a9bdff" />
          <stop offset="1" stopColor="#2f5bff" />
        </linearGradient>
        <radialGradient id={`h${id}`}>
          <stop offset="0" stopColor="#d4ff3a" stopOpacity="0.75" />
          <stop offset="1" stopColor="#d4ff3a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <motion.path
        d={ring}
        fill="none"
        stroke={`url(#g${id})`}
        strokeWidth={2.4}
        strokeLinejoin="round"
        initial={animate ? { pathLength: 0, opacity: 0.4 } : false}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.4, ease: [0.65, 0, 0.35, 1] }}
      />
      <motion.path
        d="M41 42 L53 54"
        stroke={`url(#g${id})`}
        strokeWidth={2.6}
        strokeLinecap="round"
        initial={animate ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5, delay: 1.2, ease: 'easeOut' }}
      />
      {STARS.map(([x, y, r], i) => (
        <motion.circle
          key={i}
          cx={x}
          cy={y}
          r={r}
          className="fill-ink"
          initial={animate ? { scale: 0, opacity: 0 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.12 * i, type: 'spring', stiffness: 400, damping: 18 }}
          style={{ transformOrigin: `${x}px ${y}px`, animation: animate ? `twinkle ${2.4 + (i % 3) * 0.7}s ease-in-out ${i * 0.3}s infinite` : undefined }}
        />
      ))}
      <circle cx="53" cy="54" r="9" fill={`url(#h${id})`} className="twinkle" />
      <motion.circle
        cx="53"
        cy="54"
        r="4"
        fill="#d4ff3a"
        initial={animate ? { scale: 0 } : false}
        animate={{ scale: 1 }}
        transition={{ delay: 1.55, type: 'spring', stiffness: 500, damping: 14 }}
        style={{ transformOrigin: '53px 54px' }}
      />
    </svg>
  );
}

export function Logo({ size = 28, compact = false }: { size?: number; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <LogoMark size={size} />
      {!compact && <span className="text-[1.15rem] font-semibold tracking-[-0.03em]">Querion</span>}
    </span>
  );
}
