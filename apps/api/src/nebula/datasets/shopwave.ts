import type { Cell, Dataset } from '@querion/engine';
import { CITIES, day, makeRand, round2, uniqueNames } from './lib';

/** E-commerce marketplace: category tree, products, customers, orders, line items and reviews. */
export function shopwave(): Dataset {
  const r = makeRand(2024);
  const catDefs: [string, number | null][] = [
    ['Electronics', null], ['Home & Kitchen', null], ['Fashion', null], ['Sports', null],
    ['Phones', 1], ['Laptops', 1], ['Audio', 1], ['Cookware', 2], ['Furniture', 2], ['Menswear', 3], ['Womenswear', 3], ['Footwear', 3], ['Fitness', 4], ['Outdoor', 4],
  ];
  const categories: Cell[][] = catDefs.map(([n, p], i) => [i + 1, n, p]);

  const productNames: Record<number, string[]> = {
    5: ['Nova X1 Phone', 'Pixelite 8', 'Orbit Mini', 'Zen Phone Pro'],
    6: ['AeroBook 14', 'ForgePad Pro 16', 'Lumen Ultrabook', 'CodeStation 15'],
    7: ['Pulse Earbuds', 'Echo Studio Headphones', 'BassCube Speaker', 'Whisper ANC Buds'],
    8: ['Cast Iron Skillet', 'Ceramic Pan Set', 'Pressure Cooker 5L', 'Chef Knife 8in'],
    9: ['Oak Study Desk', 'ErgoMesh Chair', 'Floating Shelf Set', 'Nordic Sofa'],
    10: ['Linen Shirt', 'Slim Chinos', 'Merino Sweater', 'Denim Jacket'],
    11: ['Wrap Dress', 'Cotton Kurta', 'Pleated Skirt', 'Silk Scarf'],
    12: ['Trail Runner', 'Court Classic Sneaker', 'Leather Loafer', 'Flex Sandal'],
    13: ['Yoga Mat Pro', 'Adjustable Dumbbells', 'Resistance Band Kit', 'Smart Jump Rope'],
    14: ['2P Tent', 'Hydration Pack', 'Trekking Poles', 'Camping Stove'],
  };
  const priceBand: Record<number, [number, number]> = { 5: [12000, 90000], 6: [45000, 160000], 7: [1500, 25000], 8: [800, 6000], 9: [3000, 55000], 10: [900, 5000], 11: [900, 6500], 12: [1500, 9000], 13: [400, 18000], 14: [700, 15000] };
  const products: Cell[][] = [];
  for (const [cat, names] of Object.entries(productNames)) {
    for (const n of names) {
      const [lo, hi] = priceBand[Number(cat)];
      products.push([products.length + 1, n, Number(cat), Math.round(r.int(lo, hi) / 10) * 10 - 1, day('2023-01-01', r.int(0, 900)), r.chance(0.08) ? false : true]);
    }
  }

  const custNames = uniqueNames(r, 160);
  const customers: Cell[][] = custNames.map((n, i) => [i + 1, n, `${n.toLowerCase().replace(/[^a-z]+/g, '.')}${i}@mail.test`, r.pick(CITIES), day('2023-06-01', r.int(0, 900)), r.weighted([['standard', 7], ['plus', 3]])]);

  const orders: Cell[][] = [];
  const items: Cell[][] = [];
  for (let i = 1; i <= 520; i++) {
    const c = r.weighted(customers.map((x) => [x[0] as number, x[5] === 'plus' ? 3 : 1]));
    const signup = customers[c - 1][4] as string;
    const date = day('2026-01-01', r.int(0, 180));
    const placed = date < signup ? signup : date;
    const status = r.weighted([['delivered', 78], ['shipped', 8], ['cancelled', 8], ['returned', 6]]);
    const lines = r.weighted([[1, 5], [2, 3], [3, 2], [4, 1]]);
    const used = new Set<number>();
    let total = 0;
    for (let k = 0; k < lines; k++) {
      let p = r.int(1, products.length);
      while (used.has(p)) p = r.int(1, products.length);
      used.add(p);
      const qty = r.weighted([[1, 8], [2, 2], [3, 1]]);
      const price = products[p - 1][3] as number;
      const disc = r.weighted([[0, 6], [0.05, 2], [0.1, 2], [0.2, 1]]);
      items.push([i, k + 1, p, qty, price, disc]);
      total += qty * price * (1 - disc);
    }
    orders.push([i, c, placed, status, r.weighted([['upi', 6], ['card', 4], ['cod', 2], ['wallet', 1]]), round2(total)]);
  }

  const reviews: Cell[][] = [];
  for (const it of items) {
    const ord = orders[(it[0] as number) - 1];
    if (ord[3] !== 'delivered' || !r.chance(0.35)) continue;
    const base = (it[2] as number) % 5 === 0 ? 3.2 : 4.1;
    reviews.push([reviews.length + 1, it[2], ord[1], Math.max(1, Math.min(5, Math.round(r.normal(base, 1)))), day(ord[2] as string, r.int(3, 40))]);
  }

  return {
    key: 'shopwave',
    name: 'ShopWave Marketplace',
    domain: 'commerce',
    tagline: 'An online marketplace — category tree, orders, line items, discounts and reviews.',
    description:
      'Six months of orders. Categories form a two-level tree via parent_id. An order has one or more order_items (unit_price is the list price at purchase; discount is a fraction 0–0.2, so line revenue = quantity * unit_price * (1 - discount)). order_total already includes discounts.',
    source: { kind: 'synthetic', license: 'CC0' },
    version: '2026.11.1',
    tables: [
      { name: 'categories', description: 'Product categories (two-level tree)', columns: [{ name: 'category_id', type: 'integer', pk: true }, { name: 'name', type: 'text' }, { name: 'parent_id', type: 'integer', nullable: true, ref: 'categories.category_id' }], rows: categories },
      { name: 'products', description: 'Catalog products', columns: [{ name: 'product_id', type: 'integer', pk: true }, { name: 'name', type: 'text' }, { name: 'category_id', type: 'integer', ref: 'categories.category_id' }, { name: 'price', type: 'integer', note: 'INR' }, { name: 'listed_on', type: 'date' }, { name: 'is_active', type: 'boolean' }], rows: products },
      { name: 'customers', description: 'Registered customers', columns: [{ name: 'customer_id', type: 'integer', pk: true }, { name: 'full_name', type: 'text' }, { name: 'email', type: 'text' }, { name: 'city', type: 'text' }, { name: 'signup_date', type: 'date' }, { name: 'tier', type: 'text', note: 'standard | plus' }], rows: customers },
      { name: 'orders', description: 'Customer orders', columns: [{ name: 'order_id', type: 'integer', pk: true }, { name: 'customer_id', type: 'integer', ref: 'customers.customer_id' }, { name: 'order_date', type: 'date' }, { name: 'status', type: 'text', note: 'delivered | shipped | cancelled | returned' }, { name: 'payment_method', type: 'text' }, { name: 'order_total', type: 'numeric(12,2)' }], rows: orders },
      { name: 'order_items', description: 'Order line items', columns: [{ name: 'order_id', type: 'integer', pk: true, ref: 'orders.order_id' }, { name: 'line_no', type: 'integer', pk: true }, { name: 'product_id', type: 'integer', ref: 'products.product_id' }, { name: 'quantity', type: 'integer' }, { name: 'unit_price', type: 'integer' }, { name: 'discount', type: 'numeric(4,2)' }], rows: items },
      { name: 'reviews', description: 'Product reviews (delivered orders only)', columns: [{ name: 'review_id', type: 'integer', pk: true }, { name: 'product_id', type: 'integer', ref: 'products.product_id' }, { name: 'customer_id', type: 'integer', ref: 'customers.customer_id' }, { name: 'rating', type: 'integer', note: '1–5' }, { name: 'reviewed_on', type: 'date' }], rows: reviews },
    ],
  };
}
