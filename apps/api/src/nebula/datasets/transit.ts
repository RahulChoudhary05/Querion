import type { Cell, Dataset } from '@querion/engine';
import { day, makeRand, round2, ts, uniqueNames } from './lib';

/** City bus network: depots, routes, stops, fleet, drivers, trips and maintenance. */
export function transit(): Dataset {
  const r = makeRand(7101);
  const depots: Cell[][] = [
    [1, 'Northgate Depot', 'Pune'],
    [2, 'Riverside Depot', 'Pune'],
    [3, 'Airport Depot', 'Pune'],
  ];

  const stopNames = ['Central Station', 'Shivaji Nagar', 'Deccan Gymkhana', 'Kothrud', 'Hinjewadi Phase 1', 'Hinjewadi Phase 3', 'Wakad', 'Aundh', 'Baner', 'Pashan', 'Swargate', 'Katraj', 'Hadapsar', 'Magarpatta', 'Kharadi', 'Viman Nagar', 'Airport Terminal', 'Yerawada', 'Koregaon Park', 'Camp', 'Pimpri', 'Chinchwad', 'Nigdi', 'Bhosari', 'Market Yard', 'Bibwewadi', 'Warje', 'Karve Nagar', 'Sinhagad Road', 'University Circle', 'Model Colony', 'Senapati Bapat Rd', 'Balewadi Stadium', 'Pimple Saudagar', 'Kalyani Nagar', 'Wagholi', 'Mundhwa', 'Undri', 'NIBM Road', 'Kondhwa'];
  const interchanges = new Set([1, 2, 11, 17, 21, 30]);
  const stops: Cell[][] = stopNames.map((n, i) => [i + 1, n, 1 + Math.floor(i / 10), interchanges.has(i + 1)]);

  const routeDefs: [string, string, string, number, number][] = [
    ['R1', 'Central – Hinjewadi Express', 'express', 1, 35],
    ['R2', 'Swargate – Katraj Local', 'urban', 2, 15],
    ['R3', 'Airport Shuttle', 'airport', 3, 60],
    ['R4', 'Kothrud – Kharadi Crosstown', 'urban', 1, 20],
    ['R5', 'Pimpri – Camp Line', 'urban', 1, 18],
    ['R6', 'Night Owl Loop', 'night', 2, 25],
    ['R7', 'IT Corridor Express', 'express', 3, 40],
    ['R8', 'Magarpatta Feeder', 'urban', 2, 12],
    ['R9', 'University Circular', 'urban', 1, 10],
    ['R10', 'Airport – Hinjewadi Link', 'airport', 3, 75],
    ['R11', 'Wagholi – Swargate Line', 'urban', 2, 18],
    ['R12', 'Sinhagad Heritage Route', 'urban', 2, 15],
  ];
  const routes: Cell[][] = routeDefs.map(([code, name, type, depot, fare], i) => [i + 1, code, name, type, depot, fare]);

  const routeStops: Cell[][] = [];
  for (let i = 1; i <= routes.length; i++) {
    const n = r.int(6, 10);
    const used = new Set<number>();
    used.add(r.pick([...interchanges]));
    while (used.size < n) used.add(r.int(1, stops.length));
    [...used].forEach((stopId, seq) => routeStops.push([i, seq + 1, stopId]));
  }

  const busModels: [string, string, number][] = [
    ['Tata Starbus Urban', 'diesel', 42],
    ['Ashok Leyland Viking', 'diesel', 48],
    ['Olectra eBuzz K9', 'electric', 38],
    ['JBM Eco-Life', 'electric', 36],
    ['Volvo 8400 Hybrid', 'hybrid', 44],
    ['Eicher Skyline CNG', 'cng', 40],
  ];
  const buses: Cell[][] = [];
  for (let i = 1; i <= 30; i++) {
    const [model, fuel, cap] = r.pick(busModels);
    buses.push([i, `MH12-${String(1000 + i * 37).slice(-4)}`, model, fuel, cap, day('2016-01-01', r.int(0, 3200)), r.int(1, 3)]);
  }

  const driverNames = uniqueNames(r, 36);
  const drivers: Cell[][] = driverNames.map((n, i) => [i + 1, n, day('2012-01-01', r.int(0, 4700)), r.weighted([['HMV', 6], ['HPMV', 3], ['HTV', 1]]), r.int(1, 3)]);

  const trips: Cell[][] = [];
  let tripId = 1;
  for (let d = 0; d < 56; d++) {
    const date = day('2026-03-02', d);
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const perDay = weekend ? r.int(3, 5) : r.int(6, 9);
    for (let k = 0; k < perDay; k++) {
      const routeId = r.int(1, routes.length);
      const type = routeDefs[routeId - 1][2];
      const startMin = type === 'night' ? r.int(22 * 60, 23 * 60 + 30) : r.int(5 * 60 + 30, 21 * 60);
      const status = r.weighted([['completed', 88], ['cancelled', 5], ['completed', 0]] as [string, number][]);
      const delay = status === 'cancelled' ? null : Math.max(0, Math.round(r.normal(weekend ? 2 : 6, 6)));
      const cap = 45;
      const peak = (startMin > 8 * 60 && startMin < 10 * 60 + 30) || (startMin > 17 * 60 && startMin < 20 * 60);
      const pax = status === 'cancelled' ? null : Math.max(3, Math.min(cap + 25, Math.round(r.normal(peak ? 52 : 26, 12))));
      const fare = routeDefs[routeId - 1][4];
      trips.push([
        tripId++,
        routeId,
        r.int(1, buses.length),
        r.int(1, drivers.length),
        date,
        ts(date, startMin),
        delay === null ? null : ts(date, startMin + delay),
        pax,
        pax === null ? null : round2(pax * fare * (0.82 + r.f() * 0.12)),
        status,
      ]);
    }
  }

  const categories = ['brakes', 'engine', 'battery', 'tyres', 'ac', 'body', 'electrical'];
  const maintenance: Cell[][] = [];
  for (let i = 1; i <= 64; i++) {
    const opened = day('2025-10-01', r.int(0, 260));
    const days = r.int(0, 9);
    const open = r.chance(0.1);
    maintenance.push([i, r.int(1, buses.length), opened, open ? null : day(opened, days), r.pick(categories), round2(r.int(1500, 42000) + r.f() * 100)]);
  }

  return {
    key: 'transit',
    name: 'MetroLine Transit',
    domain: 'transport',
    tagline: 'A city bus network — routes, stops, fleet, drivers and 56 days of trips.',
    description:
      'Operational data for a mid-size city bus operator. Trips record scheduled vs actual departure, ridership and fare revenue; buses carry fuel type and capacity; maintenance tracks workshop jobs (closed_on is NULL while a bus is still in the shop).',
    source: { kind: 'synthetic', license: 'CC0' },
    version: '2026.11.1',
    tables: [
      { name: 'depots', description: 'Bus depots (garages)', columns: [{ name: 'depot_id', type: 'integer', pk: true }, { name: 'name', type: 'text' }, { name: 'city', type: 'text' }], rows: depots },
      { name: 'routes', description: 'Bus routes', columns: [{ name: 'route_id', type: 'integer', pk: true }, { name: 'route_code', type: 'text' }, { name: 'name', type: 'text' }, { name: 'route_type', type: 'text', note: 'urban | express | airport | night' }, { name: 'depot_id', type: 'integer', ref: 'depots.depot_id' }, { name: 'base_fare', type: 'numeric(6,2)' }], rows: routes },
      { name: 'stops', description: 'Bus stops', columns: [{ name: 'stop_id', type: 'integer', pk: true }, { name: 'name', type: 'text' }, { name: 'fare_zone', type: 'integer' }, { name: 'is_interchange', type: 'boolean' }], rows: stops },
      { name: 'route_stops', description: 'Ordered stops served by each route', columns: [{ name: 'route_id', type: 'integer', pk: true, ref: 'routes.route_id' }, { name: 'stop_sequence', type: 'integer', pk: true }, { name: 'stop_id', type: 'integer', ref: 'stops.stop_id' }], rows: routeStops },
      { name: 'buses', description: 'Fleet vehicles', columns: [{ name: 'bus_id', type: 'integer', pk: true }, { name: 'registration', type: 'text' }, { name: 'model', type: 'text' }, { name: 'fuel_type', type: 'text', note: 'diesel | electric | hybrid | cng' }, { name: 'capacity', type: 'integer' }, { name: 'commissioned_on', type: 'date' }, { name: 'depot_id', type: 'integer', ref: 'depots.depot_id' }], rows: buses },
      { name: 'drivers', description: 'Bus drivers', columns: [{ name: 'driver_id', type: 'integer', pk: true }, { name: 'full_name', type: 'text' }, { name: 'hired_on', type: 'date' }, { name: 'license_class', type: 'text' }, { name: 'depot_id', type: 'integer', ref: 'depots.depot_id' }], rows: drivers },
      { name: 'trips', description: 'Individual trips run on a route', columns: [{ name: 'trip_id', type: 'integer', pk: true }, { name: 'route_id', type: 'integer', ref: 'routes.route_id' }, { name: 'bus_id', type: 'integer', ref: 'buses.bus_id' }, { name: 'driver_id', type: 'integer', ref: 'drivers.driver_id' }, { name: 'service_date', type: 'date' }, { name: 'scheduled_departure', type: 'timestamp' }, { name: 'actual_departure', type: 'timestamp', nullable: true, note: 'NULL when cancelled' }, { name: 'passengers', type: 'integer', nullable: true }, { name: 'fare_revenue', type: 'numeric(10,2)', nullable: true }, { name: 'status', type: 'text', note: 'completed | cancelled' }], rows: trips },
      { name: 'maintenance', description: 'Workshop jobs per bus', columns: [{ name: 'job_id', type: 'integer', pk: true }, { name: 'bus_id', type: 'integer', ref: 'buses.bus_id' }, { name: 'opened_on', type: 'date' }, { name: 'closed_on', type: 'date', nullable: true, note: 'NULL = still open' }, { name: 'category', type: 'text' }, { name: 'cost', type: 'numeric(10,2)' }], rows: maintenance },
    ],
  };
}
