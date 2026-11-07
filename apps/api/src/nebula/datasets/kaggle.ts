import fs from 'node:fs';
import path from 'node:path';
import type { Cell, Dataset } from '@querion/engine';
import { parseCsv } from './csv';
import { RAW_DIR } from '../../paths';

const MONTHS: Record<string, string> = { January: '01', February: '02', March: '03', April: '04', May: '05', June: '06', July: '07', August: '08', September: '09', October: '10', November: '11', December: '12' };
const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** Netflix Movies & TV Shows (Kaggle: shivamb/netflix-shows) normalised into 5 tables. */
export function netflixFromKaggle(): Dataset | null {
  const file = path.join(RAW_DIR, 'netflix', 'netflix_titles.csv');
  if (!fs.existsSync(file)) return null;
  const [header, ...rows] = parseCsv(fs.readFileSync(file, 'utf8'));
  const idx = (n: string) => header.indexOf(n);
  // deterministic, evenly spread sample of ~650 titles
  const sample = rows.filter((_, i) => i % 13 === 0);
  const titles: Cell[][] = [];
  const genres: Cell[][] = [];
  const countries: Cell[][] = [];
  const people: Map<string, number> = new Map();
  const credits: Cell[][] = [];
  const personId = (n: string) => {
    if (!people.has(n)) people.set(n, people.size + 1);
    return people.get(n)!;
  };
  for (const r of sample) {
    const id = r[idx('show_id')];
    const type = r[idx('type')];
    const dur = r[idx('duration')] ?? '';
    const added = /^\s*(\w+) (\d{1,2}), (\d{4})/.exec(r[idx('date_added')] ?? '');
    titles.push([
      id,
      type,
      r[idx('title')],
      Number(r[idx('release_year')]),
      r[idx('rating')] || null,
      type === 'Movie' && /min/.test(dur) ? parseInt(dur, 10) : null,
      type === 'TV Show' && /Season/.test(dur) ? parseInt(dur, 10) : null,
      added ? `${added[3]}-${MONTHS[added[1]]}-${added[2].padStart(2, '0')}` : null,
    ]);
    for (const g of splitList(r[idx('listed_in')] ?? '')) genres.push([id, g]);
    for (const c of splitList(r[idx('country')] ?? '')) countries.push([id, c]);
    for (const d of splitList(r[idx('director')] ?? '').slice(0, 2)) credits.push([id, personId(d), 'director']);
    for (const a of splitList(r[idx('cast')] ?? '').slice(0, 4)) credits.push([id, personId(a), 'actor']);
  }
  const dedupe = (xs: Cell[][]) => [...new Map(xs.map((x) => [JSON.stringify(x), x])).values()];
  return {
    key: 'streamflix',
    name: 'Netflix Catalog',
    domain: 'media',
    tagline: 'A real slice of the Netflix catalog from Kaggle — titles, genres, countries and credits.',
    description:
      'Normalised from the Kaggle "Netflix Movies and TV Shows" dataset (deterministic ~1/13 sample). Movies have duration_minutes, TV shows have seasons. Genres, countries and credits are many-to-many link tables.',
    source: { kind: 'kaggle', slug: 'shivamb/netflix-shows', url: 'https://www.kaggle.com/datasets/shivamb/netflix-shows', license: 'CC0' },
    version: '2026.11.1',
    tables: [
      { name: 'titles', description: 'Movies and TV shows', columns: [{ name: 'show_id', type: 'text', pk: true }, { name: 'type', type: 'text', note: 'Movie | TV Show' }, { name: 'title', type: 'text' }, { name: 'release_year', type: 'integer' }, { name: 'rating', type: 'text', nullable: true }, { name: 'duration_minutes', type: 'integer', nullable: true }, { name: 'seasons', type: 'integer', nullable: true }, { name: 'date_added', type: 'date', nullable: true }], rows: titles },
      { name: 'title_genres', description: 'Genre tags per title', columns: [{ name: 'show_id', type: 'text', pk: true, ref: 'titles.show_id' }, { name: 'genre', type: 'text', pk: true }], rows: dedupe(genres) },
      { name: 'title_countries', description: 'Production countries per title', columns: [{ name: 'show_id', type: 'text', pk: true, ref: 'titles.show_id' }, { name: 'country', type: 'text', pk: true }], rows: dedupe(countries) },
      { name: 'people', description: 'Directors and actors', columns: [{ name: 'person_id', type: 'integer', pk: true }, { name: 'name', type: 'text' }], rows: [...people.entries()].map(([n, id]) => [id, n]) },
      { name: 'credits', description: 'Who directed / acted in what (first 4 cast members)', columns: [{ name: 'show_id', type: 'text', pk: true, ref: 'titles.show_id' }, { name: 'person_id', type: 'integer', pk: true, ref: 'people.person_id' }, { name: 'role', type: 'text', pk: true, note: 'director | actor' }], rows: dedupe(credits) },
    ],
  };
}

/** 120 years of Olympic history (Kaggle: heesoo37/...) — Summer Games 2000–2016, five sports. */
export function olympicsFromKaggle(): Dataset | null {
  const file = path.join(RAW_DIR, 'olympics', 'athlete_events.csv');
  const regionsFile = path.join(RAW_DIR, 'olympics', 'noc_regions.csv');
  if (!fs.existsSync(file)) return null;
  const [header, ...rows] = parseCsv(fs.readFileSync(file, 'utf8'));
  const ix = Object.fromEntries(header.map((h, i) => [h, i]));
  const sports = new Set(['Athletics', 'Swimming', 'Badminton', 'Weightlifting', 'Table Tennis']);
  const keep = rows.filter((r, i) => {
    const year = Number(r[ix.Year]);
    if (r[ix.Season] !== 'Summer' || year < 2000 || !sports.has(r[ix.Sport])) return false;
    return r[ix.Medal] !== 'NA' || i % 9 === 0;
  });
  const num = (v: string) => (v === 'NA' || v === '' ? null : Number(v));
  const athletes = new Map<string, Cell[]>();
  const games = new Map<string, Cell[]>();
  const events = new Map<string, Cell[]>();
  const results: Cell[][] = [];
  const nocs = new Set<string>();
  for (const r of keep) {
    const aid = Number(r[ix.ID]);
    if (!athletes.has(r[ix.ID])) {
      const age = num(r[ix.Age]);
      athletes.set(r[ix.ID], [aid, r[ix.Name], r[ix.Sex], age === null ? null : Number(r[ix.Year]) - age, num(r[ix.Height]), num(r[ix.Weight])]);
    }
    if (!games.has(r[ix.Games])) games.set(r[ix.Games], [games.size + 1, Number(r[ix.Year]), r[ix.City]]);
    const evKey = r[ix.Event];
    if (!events.has(evKey)) events.set(evKey, [events.size + 1, r[ix.Sport], evKey, /Women's/.test(evKey) ? 'F' : /Mixed/.test(evKey) ? 'X' : 'M']);
    nocs.add(r[ix.NOC]);
    results.push([results.length + 1, aid, games.get(r[ix.Games])![0], events.get(evKey)![0], r[ix.NOC], r[ix.Team], r[ix.Medal] === 'NA' ? null : r[ix.Medal]]);
  }
  let regions: Cell[][] = [];
  if (fs.existsSync(regionsFile)) {
    const [, ...rr] = parseCsv(fs.readFileSync(regionsFile, 'utf8'));
    regions = rr.filter((r) => nocs.has(r[0])).map((r) => [r[0], r[1] === 'NA' ? null : r[1]]);
  }
  return {
    key: 'olympics',
    name: 'Olympic Games 2000–2016',
    domain: 'sports',
    tagline: 'Real Olympic results from Kaggle — athletes, Games, events and medals.',
    description:
      'Normalised from the Kaggle "120 years of Olympic history" dataset: Summer Games 2000–2016 for Athletics, Swimming, Badminton, Weightlifting and Table Tennis (all medal results plus a sample of non-medal entries). medal is NULL when no medal was won. Team events award a medal to every team member.',
    source: { kind: 'kaggle', slug: 'heesoo37/120-years-of-olympic-history-athletes-and-results', url: 'https://www.kaggle.com/datasets/heesoo37/120-years-of-olympic-history-athletes-and-results', license: 'CC0' },
    version: '2026.11.1',
    tables: [
      { name: 'athletes', description: 'Athletes', columns: [{ name: 'athlete_id', type: 'integer', pk: true }, { name: 'name', type: 'text' }, { name: 'sex', type: 'text' }, { name: 'birth_year', type: 'integer', nullable: true }, { name: 'height_cm', type: 'integer', nullable: true }, { name: 'weight_kg', type: 'numeric(5,1)', nullable: true }], rows: [...athletes.values()] },
      { name: 'games', description: 'Olympic Games editions', columns: [{ name: 'games_id', type: 'integer', pk: true }, { name: 'year', type: 'integer' }, { name: 'host_city', type: 'text' }], rows: [...games.values()] },
      { name: 'events', description: 'Medal events', columns: [{ name: 'event_id', type: 'integer', pk: true }, { name: 'sport', type: 'text' }, { name: 'event_name', type: 'text' }, { name: 'gender', type: 'text', note: 'M | F | X (mixed)' }], rows: [...events.values()] },
      { name: 'regions', description: 'National Olympic Committees', columns: [{ name: 'noc', type: 'text', pk: true }, { name: 'region', type: 'text', nullable: true }], rows: regions },
      { name: 'results', description: 'One row per athlete per event entry', columns: [{ name: 'result_id', type: 'integer', pk: true }, { name: 'athlete_id', type: 'integer', ref: 'athletes.athlete_id' }, { name: 'games_id', type: 'integer', ref: 'games.games_id' }, { name: 'event_id', type: 'integer', ref: 'events.event_id' }, { name: 'noc', type: 'text', ref: 'regions.noc' }, { name: 'team', type: 'text' }, { name: 'medal', type: 'text', nullable: true, note: 'Gold | Silver | Bronze | NULL' }], rows: results },
    ],
  };
}
