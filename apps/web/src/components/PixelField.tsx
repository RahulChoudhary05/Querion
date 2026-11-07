import { useEffect, useRef } from 'react';

/**
 * Animated pixel grid for the auth screens.
 *
 * A field of outlined squares grows from two opposite corners with a stepped
 * (staircase) falloff toward the centre, a few stray squares at the frontier,
 * and slow cobalt "twinkles". When `corners` changes (login ↔ sign-up) every
 * cell eases toward its new state with a delay proportional to its distance
 * from the new corner, so the grid visibly migrates across the screen.
 * The cursor gently lights nearby cells.
 */
type Corners = 'tl-br' | 'tr-bl';

interface Cell {
  x: number;
  y: number;
  a: number; // current outline alpha 0..1
  from: number;
  to: number;
  start: number; // ms timestamp the transition starts
  glow: number; // current fill 0..1
  glowTo: number;
  rnd: number;
}

const SIZE = 28;
const DURATION = 420;

function presence(cx: number, cy: number, cols: number, rows: number, corners: Corners, rnd: number) {
  // normalised distance to the nearest active corner, staircase-quantised
  const u = cx / Math.max(1, cols - 1);
  const v = cy / Math.max(1, rows - 1);
  const pairs = corners === 'tl-br' ? [[0, 0], [1, 1]] : [[1, 0], [0, 1]];
  let d = Infinity;
  for (const [px, py] of pairs) {
    const du = Math.abs(u - px);
    const dv = Math.abs(v - py);
    // weight horizontal distance more on wide screens so the shape reads as a staircase
    d = Math.min(d, du * 1.15 + dv * 0.85);
  }
  const step = Math.floor((d + (rnd - 0.5) * 0.08) * 14) / 14; // quantised → steps
  const T = 0.42;
  if (step < T) return { on: true, d };
  if (step < T + 0.1 && rnd > 0.72) return { on: true, d }; // stray frontier squares
  return { on: false, d };
}

export function PixelField({ corners, className }: { corners: Corners; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef<{ cells: Cell[]; cols: number; rows: number; corners: Corners; mouse: { x: number; y: number } | null }>({
    cells: [],
    cols: 0,
    rows: 0,
    corners,
    mouse: null,
  });

  // (re)target cells whenever the corner configuration changes
  useEffect(() => {
    const s = state.current;
    s.corners = corners;
    const now = performance.now();
    for (const c of s.cells) {
      const { on, d } = presence(c.x, c.y, s.cols, s.rows, corners, c.rnd);
      const target = on ? 1 : 0;
      if (target !== c.to) {
        c.from = c.a;
        c.to = target;
        // appear outward from the new corner; disappear inward toward the old one
        c.start = now + (target ? d * 900 : (1 - d) * 420) + c.rnd * 120;
      }
    }
  }, [corners]);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let lastTwinkle = 0;

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = el.getBoundingClientRect();
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.ceil(width / SIZE);
      const rows = Math.ceil(height / SIZE);
      const s = state.current;
      const now = performance.now();
      const cells: Cell[] = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const rnd = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1; // stable per cell
          const { on, d } = presence(x, y, cols, rows, s.corners, rnd);
          cells.push({ x, y, a: reduce && on ? 1 : 0, from: 0, to: on ? 1 : 0, start: now + d * 900 + rnd * 160, glow: 0, glowTo: 0, rnd });
        }
      }
      s.cells = cells;
      s.cols = cols;
      s.rows = rows;
    };

    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    let last = 0;
    const frame = (now: number) => {
      // 30 fps is plenty for a slow ambient effect and halves the main-thread cost
      if (now - last < 32) {
        raf = requestAnimationFrame(frame);
        return;
      }
      last = now;
      const s = state.current;
      const { width, height } = el.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      // twinkles: occasionally pick a visible cell and let it glow cobalt
      if (!reduce && now - lastTwinkle > 380) {
        lastTwinkle = now;
        const visible = s.cells.filter((c) => c.to === 1 && c.a > 0.9);
        const pick = visible[Math.floor(Math.random() * visible.length)];
        if (pick) pick.glowTo = 0.55 + Math.random() * 0.35;
      }

      for (const c of s.cells) {
        if (!reduce) {
          const t = Math.min(1, Math.max(0, (now - c.start) / DURATION));
          c.a = c.from + (c.to - c.from) * ease(t);
          c.glow += (c.glowTo - c.glow) * 0.06;
          if (c.glow > c.glowTo - 0.02) c.glowTo *= 0.985; // fade back out
        }
        let hover = 0;
        if (s.mouse) {
          const dx = c.x * SIZE + SIZE / 2 - s.mouse.x;
          const dy = c.y * SIZE + SIZE / 2 - s.mouse.y;
          hover = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 110);
        }
        const alpha = c.a;
        if (alpha < 0.01 && hover < 0.05) continue;
        const px = c.x * SIZE + 0.5;
        const py = c.y * SIZE + 0.5;
        if (c.glow > 0.02 && alpha > 0.05) {
          ctx.fillStyle = `rgba(47, 91, 255, ${(c.glow * 0.5 * alpha).toFixed(3)})`;
          ctx.fillRect(px + 1, py + 1, SIZE - 3, SIZE - 3);
        }
        ctx.strokeStyle = `rgba(170, 190, 255, ${(0.05 + alpha * 0.16 + hover * 0.22).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, SIZE - 1, SIZE - 1);
      }
      raf = requestAnimationFrame(frame);
    };

    build();
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(build);
    ro.observe(el);
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      state.current.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const leave = () => (state.current.mouse = null);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerleave', leave);
    };
  }, []);

  return <canvas ref={canvas} aria-hidden className={className ?? 'pointer-events-none absolute inset-0 h-full w-full'} />;
}
