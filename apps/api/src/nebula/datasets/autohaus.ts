import type { Cell, Dataset } from '@querion/engine';
import { CITIES, day, makeRand, round2, uniqueNames } from './lib';

/** Automotive retail: manufacturers, models, dealers, sales staff, inventory, sales and service visits. */
export function autohaus(): Dataset {
  const r = makeRand(4242);
  const makers: [string, string][] = [
    ['Tata Motors', 'India'], ['Mahindra', 'India'], ['Maruti Suzuki', 'India'], ['Hyundai', 'South Korea'],
    ['Toyota', 'Japan'], ['Volkswagen', 'Germany'], ['BYD', 'China'], ['Kia', 'South Korea'],
  ];
  const manufacturers: Cell[][] = makers.map(([n, c], i) => [i + 1, n, c]);

  const modelDefs: [number, string, string, number, number][] = [
    [1, 'Nexon', 'suv', 2017, 820000], [1, 'Tiago', 'hatchback', 2016, 560000], [1, 'Nexon EV', 'ev', 2020, 1450000], [1, 'Harrier', 'suv', 2019, 1550000],
    [2, 'XUV700', 'suv', 2021, 1400000], [2, 'Thar', 'suv', 2020, 1150000], [2, 'Scorpio-N', 'suv', 2022, 1360000], [2, 'XUV400', 'ev', 2023, 1590000],
    [3, 'Swift', 'hatchback', 2005, 600000], [3, 'Baleno', 'hatchback', 2015, 670000], [3, 'Brezza', 'suv', 2016, 840000], [3, 'Dzire', 'sedan', 2008, 680000],
    [4, 'Creta', 'suv', 2015, 1100000], [4, 'Verna', 'sedan', 2006, 1100000], [4, 'i20', 'hatchback', 2008, 710000], [4, 'Ioniq 5', 'ev', 2023, 4600000],
    [5, 'Innova Hycross', 'suv', 2022, 1900000], [5, 'Fortuner', 'suv', 2009, 3300000], [5, 'Glanza', 'hatchback', 2019, 690000], [5, 'Hilux', 'pickup', 2022, 3040000],
    [6, 'Virtus', 'sedan', 2022, 1150000], [6, 'Taigun', 'suv', 2021, 1170000],
    [7, 'Atto 3', 'ev', 2022, 3399000], [7, 'Seal', 'ev', 2024, 4100000],
    [8, 'Seltos', 'suv', 2019, 1090000], [8, 'Sonet', 'suv', 2020, 790000], [8, 'Carens', 'suv', 2022, 1050000], [8, 'EV6', 'ev', 2022, 6095000],
  ];
  const models: Cell[][] = modelDefs.map(([m, n, seg, y, p], i) => [i + 1, m, n, seg, y, p]);

  const dealerDefs: [string, string, string][] = [
    ['Velocity Motors Baner', 'Pune', 'West'], ['Velocity Motors Andheri', 'Mumbai', 'West'], ['Velocity Motors Whitefield', 'Bengaluru', 'South'],
    ['Velocity Motors Gachibowli', 'Hyderabad', 'South'], ['Velocity Motors Saket', 'Delhi', 'North'], ['Velocity Motors Malviya Nagar', 'Jaipur', 'North'],
    ['Velocity Motors Salt Lake', 'Kolkata', 'East'], ['Velocity Motors OMR', 'Chennai', 'South'],
  ];
  const dealers: Cell[][] = dealerDefs.map(([n, c, reg], i) => [i + 1, n, c, reg, day('2014-04-01', r.int(0, 2600))]);

  // salespeople with a manager hierarchy per dealer (first person per dealer is the manager)
  const staffNames = uniqueNames(r, 32);
  const salespeople: Cell[][] = [];
  let sid = 1;
  for (let d = 1; d <= dealers.length; d++) {
    const manager = sid;
    const count = d <= 4 ? 4 : 4;
    for (let k = 0; k < count; k++) {
      salespeople.push([sid, d, staffNames[sid - 1], day('2016-01-01', r.int(0, 3300)), k === 0 ? null : manager]);
      sid++;
    }
  }

  const colors = ['Pearl White', 'Midnight Black', 'Lunar Silver', 'Flame Red', 'Ocean Blue', 'Graphite Grey'];
  const vehicles: Cell[][] = [];
  for (let i = 1; i <= 280; i++) {
    const modelId = r.weighted(models.map((m) => [m[0] as number, (m[3] === 'ev' ? 2 : 4) + (m[4] as number > 2000000 ? 0 : 2)]));
    const model = modelDefs[modelId - 1];
    const fuel = model[2] === 'ev' ? 'electric' : r.weighted([['petrol', 6], ['diesel', 3], ['hybrid', 1]]);
    const msrp = Math.round(model[4] * (1 + r.f() * 0.25) / 1000) * 1000;
    vehicles.push([`VIN${String(100000 + i * 7919).slice(-6)}`, modelId, r.pick(colors), r.weighted([[2025, 5], [2026, 4], [2024, 1]]), fuel, msrp]);
  }

  const sales: Cell[][] = [];
  const soldVins = vehicles.filter(() => r.chance(0.78));
  soldVins.forEach((v, i) => {
    const dealerId = r.weighted(dealers.map((d) => [d[0] as number, (d[0] as number) <= 3 ? 3 : 2]));
    const staff = salespeople.filter((s) => s[1] === dealerId);
    const sp = r.pick(staff);
    const discount = r.weighted([[0, 3], [0.02, 3], [0.05, 2], [0.08, 1]]);
    sales.push([
      i + 1,
      v[0],
      dealerId,
      sp[0],
      day('2025-07-01', r.int(0, 300)),
      Math.round((v[5] as number) * (1 - discount)),
      r.weighted([['loan', 6], ['cash', 3], ['lease', 1]]),
      r.chance(0.8) ? dealerDefs[dealerId - 1][1] : r.pick(CITIES),
    ]);
  });

  const serviceTypes: [string, number][] = [['periodic', 6], ['repair', 3], ['warranty', 2], ['accident', 1], ['battery', 1]];
  const visits: Cell[][] = [];
  for (let i = 1; i <= 240; i++) {
    const s = r.pick(sales);
    const type = r.weighted(serviceTypes);
    const hours = round2(type === 'periodic' ? 1 + r.f() * 2 : 2 + r.f() * 9);
    const cost = type === 'warranty' ? 0 : round2(hours * 1250 + r.int(500, 18000));
    visits.push([i, s[1], r.chance(0.85) ? s[2] : r.int(1, dealers.length), day(s[4] as string, r.int(20, 330)), type, hours, cost]);
  }

  return {
    key: 'autohaus',
    name: 'Velocity Motors',
    domain: 'automotive',
    tagline: 'A multi-brand car dealership chain — inventory, sales staff, deals and service visits.',
    description:
      'Eight dealerships across India selling 28 models from 8 manufacturers. Vehicles are identified by VIN; not every vehicle is sold yet. Salespeople report to a manager (manager_id is NULL for managers). Warranty service visits cost 0.',
    source: { kind: 'synthetic', license: 'CC0' },
    version: '2026.11.1',
    tables: [
      { name: 'manufacturers', description: 'Car makers', columns: [{ name: 'manufacturer_id', type: 'integer', pk: true }, { name: 'name', type: 'text' }, { name: 'country', type: 'text' }], rows: manufacturers },
      { name: 'models', description: 'Car models', columns: [{ name: 'model_id', type: 'integer', pk: true }, { name: 'manufacturer_id', type: 'integer', ref: 'manufacturers.manufacturer_id' }, { name: 'name', type: 'text' }, { name: 'segment', type: 'text', note: 'hatchback | sedan | suv | pickup | ev' }, { name: 'launch_year', type: 'integer' }, { name: 'base_price', type: 'integer', note: 'INR' }], rows: models },
      { name: 'dealers', description: 'Dealership showrooms', columns: [{ name: 'dealer_id', type: 'integer', pk: true }, { name: 'name', type: 'text' }, { name: 'city', type: 'text' }, { name: 'region', type: 'text' }, { name: 'opened_on', type: 'date' }], rows: dealers },
      { name: 'salespeople', description: 'Sales staff (self-referencing manager)', columns: [{ name: 'salesperson_id', type: 'integer', pk: true }, { name: 'dealer_id', type: 'integer', ref: 'dealers.dealer_id' }, { name: 'full_name', type: 'text' }, { name: 'hired_on', type: 'date' }, { name: 'manager_id', type: 'integer', nullable: true, ref: 'salespeople.salesperson_id' }], rows: salespeople },
      { name: 'vehicles', description: 'Vehicle inventory', columns: [{ name: 'vin', type: 'text', pk: true }, { name: 'model_id', type: 'integer', ref: 'models.model_id' }, { name: 'color', type: 'text' }, { name: 'model_year', type: 'integer' }, { name: 'fuel', type: 'text' }, { name: 'msrp', type: 'integer', note: 'INR list price' }], rows: vehicles },
      { name: 'sales', description: 'Completed vehicle sales', columns: [{ name: 'sale_id', type: 'integer', pk: true }, { name: 'vin', type: 'text', ref: 'vehicles.vin' }, { name: 'dealer_id', type: 'integer', ref: 'dealers.dealer_id' }, { name: 'salesperson_id', type: 'integer', ref: 'salespeople.salesperson_id' }, { name: 'sold_on', type: 'date' }, { name: 'sale_price', type: 'integer' }, { name: 'financing', type: 'text', note: 'cash | loan | lease' }, { name: 'customer_city', type: 'text' }], rows: sales },
      { name: 'service_visits', description: 'After-sales service visits', columns: [{ name: 'visit_id', type: 'integer', pk: true }, { name: 'vin', type: 'text', ref: 'vehicles.vin' }, { name: 'dealer_id', type: 'integer', ref: 'dealers.dealer_id' }, { name: 'visit_date', type: 'date' }, { name: 'service_type', type: 'text' }, { name: 'labor_hours', type: 'numeric(5,2)' }, { name: 'cost', type: 'numeric(10,2)' }], rows: visits },
    ],
  };
}
