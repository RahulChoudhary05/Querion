import { rng } from '@querion/engine';

export const FIRST = ['Aarav', 'Maya', 'Liam', 'Zara', 'Noah', 'Isha', 'Ethan', 'Sofia', 'Kabir', 'Elena', 'Omar', 'Priya', 'Lucas', 'Hana', 'Diego', 'Ananya', 'Mateo', 'Chloe', 'Arjun', 'Yuki', 'Leo', 'Fatima', 'Rohan', 'Nora', 'Ibrahim', 'Emma', 'Vikram', 'Aisha', 'Felix', 'Meera', 'Jonas', 'Lina', 'Samuel', 'Kiara', 'Hugo', 'Riya', 'Theo', 'Amara', 'Dev', 'Clara'];
export const LAST = ['Sharma', 'Okafor', 'Müller', 'Garcia', 'Chen', 'Patel', 'Silva', 'Kim', 'Rossi', 'Nair', 'Haddad', 'Novak', 'Iyer', 'Costa', 'Tanaka', 'Mensah', 'Fischer', 'Reddy', 'Larsen', 'Dubois', 'Khan', 'Moreau', 'Gupta', 'Ivanova', 'Bose', 'Santos', 'Weber', 'Joshi', 'Ali', 'Kowalski'];
export const CITIES = ['Pune', 'Bengaluru', 'Mumbai', 'Delhi', 'Hyderabad', 'Chennai', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Kochi'];

export function makeRand(seed: number) {
  const f = rng(seed);
  const int = (a: number, b: number) => a + Math.floor(f() * (b - a + 1));
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(f() * arr.length)];
  const chance = (p: number) => f() < p;
  const weighted = <T>(pairs: [T, number][]): T => {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let x = f() * total;
    for (const [v, w] of pairs) {
      if ((x -= w) <= 0) return v;
    }
    return pairs[pairs.length - 1][0];
  };
  const normal = (mean: number, sd: number) => {
    const u = 1 - f();
    const v = f();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const name = () => `${pick(FIRST)} ${pick(LAST)}`;
  return { f, int, pick, chance, weighted, normal, name };
}

export type Rand = ReturnType<typeof makeRand>;

export const round2 = (n: number) => Math.round(n * 100) / 100;

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO date (YYYY-MM-DD) offset in days from a base date. */
export function day(base: string, offsetDays: number): string {
  const d = new Date(base + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Timestamp string (YYYY-MM-DD HH:MM:SS) from an ISO date plus minutes. */
export function ts(date: string, minutes: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCMinutes(d.getUTCMinutes() + Math.round(minutes));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
}

export function uniqueNames(r: Rand, n: number): string[] {
  const set = new Set<string>();
  while (set.size < n) set.add(r.name());
  return [...set];
}
