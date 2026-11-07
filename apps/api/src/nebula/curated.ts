import type { Difficulty } from '@querion/engine';

/**
 * Hand-written seed problems. Expected outputs are NOT written here — they are
 * computed from `sql` on every dataset variant by the forge verifier, exactly
 * like AI-generated problems. A typo in a reference therefore fails loudly at
 * seed time instead of shipping a wrong answer.
 */
export interface CuratedProblem {
  title: string;
  dataset: string;
  difficulty: Difficulty;
  topics: string[];
  statement: string;
  sql: string;
  hints: [string, string, string];
  explanation: string;
  /** Ladder tier override (default: inferred from topics). */
  tier?: number;
  /** Architect problems: allowed planner cost as a multiple of the reference plan. */
  budget?: number;
}

export const CURATED: CuratedProblem[] = [
  // ───────────────────────── Transport · MetroLine Transit ─────────────────────────
  {
    title: 'Electric Fleet Roll Call',
    dataset: 'transit',
    difficulty: 'Easy',
    topics: ['Filtering', 'Sorting'],
    statement: `The sustainability team wants a list of every **electric** bus in the fleet.

Return \`registration\`, \`model\` and \`capacity\` for all buses whose \`fuel_type\` is \`electric\`, ordered by **capacity (highest first)**, then by **registration** alphabetically.`,
    sql: `SELECT registration, model, capacity
FROM buses
WHERE fuel_type = 'electric'
ORDER BY capacity DESC, registration;`,
    hints: ['Everything you need lives in one table: `buses`.', 'Filter with WHERE on `fuel_type`, then sort with two ORDER BY keys.', "SELECT registration, model, capacity FROM buses WHERE ___ = 'electric' ORDER BY ___ DESC, ___;"],
    explanation: 'A single-table filter plus a two-key sort. The second key (registration) is a tie-breaker so the order is fully deterministic.',
  },
  {
    title: 'Busiest Service Days',
    dataset: 'transit',
    difficulty: 'Easy',
    topics: ['Aggregation', 'GROUP BY', 'Sorting'],
    statement: `Operations wants to know which days carried the most riders.

Considering only **completed** trips, return each \`service_date\` with its \`total_passengers\`. Show the **top 5** days by total passengers (highest first); break ties by the **earlier date**.`,
    sql: `SELECT service_date, SUM(passengers) AS total_passengers
FROM trips
WHERE status = 'completed'
GROUP BY service_date
ORDER BY total_passengers DESC, service_date
LIMIT 5;`,
    hints: ['You need one output row per day.', 'GROUP BY service_date and SUM the passengers; filter cancelled trips out before grouping.', 'SELECT service_date, SUM(___) FROM trips WHERE ___ GROUP BY ___ ORDER BY ___ DESC, ___ LIMIT 5;'],
    explanation: 'Filter rows first (WHERE), then aggregate (GROUP BY), then rank (ORDER BY + LIMIT). The date tie-breaker keeps LIMIT deterministic.',
  },
  {
    title: 'Stops No Route Serves',
    dataset: 'transit',
    difficulty: 'Easy',
    topics: ['Anti Join', 'Subqueries'],
    statement: `Some stops were built but no route currently serves them.

Return the \`name\` and \`fare_zone\` of every stop that does **not** appear in \`route_stops\`, ordered by \`name\`.`,
    sql: `SELECT s.name, s.fare_zone
FROM stops s
WHERE NOT EXISTS (SELECT 1 FROM route_stops rs WHERE rs.stop_id = s.stop_id)
ORDER BY s.name;`,
    hints: ['You are looking for rows in one table with no match in another.', 'Use NOT EXISTS (or LEFT JOIN … WHERE right side IS NULL).', 'SELECT name, fare_zone FROM stops s WHERE NOT EXISTS (SELECT 1 FROM route_stops rs WHERE ___) ORDER BY name;'],
    explanation: 'An anti-join. NOT EXISTS is NULL-safe and lets the planner use a hash anti-join; avoid NOT IN when the subquery column can be NULL.',
  },
  {
    title: 'On-Time Performance by Route',
    dataset: 'transit',
    difficulty: 'Medium',
    topics: ['Date & Time', 'Aggregation', 'Joins'],
    statement: `A trip is **on time** when its \`actual_departure\` is at most **5 minutes** after \`scheduled_departure\`.

For every route with completed trips, return \`route_code\`, \`completed_trips\` and \`on_time_pct\` — the percentage of completed trips that were on time, **rounded to 1 decimal**. Order by \`on_time_pct\` descending, then \`route_code\`.`,
    sql: `SELECT r.route_code,
       COUNT(*) AS completed_trips,
       ROUND(100.0 * COUNT(*) FILTER (WHERE t.actual_departure <= t.scheduled_departure + INTERVAL '5 minutes') / COUNT(*), 1) AS on_time_pct
FROM trips t
JOIN routes r ON r.route_id = t.route_id
WHERE t.status = 'completed'
GROUP BY r.route_code
ORDER BY on_time_pct DESC, r.route_code;`,
    hints: ['Compare two timestamps with interval arithmetic.', "Count conditionally: COUNT(*) FILTER (WHERE …) or SUM(CASE WHEN … THEN 1 ELSE 0 END). Multiply by 100.0 to avoid integer division.", "ROUND(100.0 * COUNT(*) FILTER (WHERE actual_departure <= scheduled_departure + INTERVAL '___') / COUNT(*), 1)"],
    explanation: 'Conditional aggregation computes several metrics in one pass over the table. 100.0 forces numeric division.',
  },
  {
    title: 'Buses Still in the Workshop',
    dataset: 'transit',
    difficulty: 'Medium',
    topics: ['Date & Time', 'Joins', 'Filtering'],
    statement: `A maintenance job is still open when \`closed_on\` is NULL.

As of **2026-07-01**, list every open job with the bus \`registration\`, job \`category\` and \`days_open\` (days between \`opened_on\` and 2026-07-01). Order by \`days_open\` descending, then \`registration\`.`,
    sql: `SELECT b.registration, m.category, DATE '2026-07-01' - m.opened_on AS days_open
FROM maintenance m
JOIN buses b ON b.bus_id = m.bus_id
WHERE m.closed_on IS NULL
ORDER BY days_open DESC, b.registration;`,
    hints: ['NULL is not equal to anything — not even NULL.', 'Use IS NULL, and subtract dates: date - date gives an integer number of days.', "SELECT b.registration, m.category, DATE '2026-07-01' - ___ AS days_open FROM maintenance m JOIN buses b ON ___ WHERE ___ IS NULL"],
    explanation: '`closed_on = NULL` is never true; `IS NULL` is required. In Postgres, subtracting two dates yields an integer day count.',
  },
  {
    title: 'Top Earning Drivers per Depot',
    dataset: 'transit',
    difficulty: 'Medium',
    topics: ['Window Functions', 'Ranking', 'CTE'],
    statement: `For each depot, find the **two drivers** (by home depot) whose completed trips generated the most \`fare_revenue\`.

Return \`depot\` (depot name), \`full_name\` and \`total_revenue\`. Break revenue ties by driver name. Order by depot name, then rank.`,
    sql: `WITH rev AS (
  SELECT d.depot_id, d.driver_id, d.full_name, SUM(t.fare_revenue) AS total_revenue
  FROM trips t
  JOIN drivers d ON d.driver_id = t.driver_id
  WHERE t.status = 'completed'
  GROUP BY d.depot_id, d.driver_id, d.full_name
), ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY depot_id ORDER BY total_revenue DESC, full_name) AS rn
  FROM rev
)
SELECT p.name AS depot, r.full_name, r.total_revenue
FROM ranked r
JOIN depots p ON p.depot_id = r.depot_id
WHERE r.rn <= 2
ORDER BY p.name, r.rn;`,
    hints: ['"Top N per group" is a classic window-function pattern.', 'Aggregate revenue per driver first, then ROW_NUMBER() OVER (PARTITION BY depot ORDER BY revenue DESC, name).', 'WITH rev AS (... GROUP BY driver), ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY ___ ORDER BY ___) rn FROM rev) SELECT ... WHERE rn <= 2'],
    explanation: 'Aggregate → rank inside partitions → filter on the rank. Window functions cannot be used in WHERE, hence the CTE.',
  },
  {
    title: 'Week-over-Week Ridership',
    dataset: 'transit',
    difficulty: 'Hard',
    topics: ['Window Functions', 'Date & Time', 'CTE'],
    statement: `Build a weekly ridership trend (weeks start on **Monday**) from completed trips.

Return \`week_start\` (a date), \`passengers\`, \`prev_week\` (previous week's passengers, NULL for the first week) and \`pct_change\` — percentage change vs the previous week rounded to **1 decimal** (NULL for the first week). Order by \`week_start\`.`,
    sql: `WITH w AS (
  SELECT date_trunc('week', service_date)::date AS week_start, SUM(passengers) AS passengers
  FROM trips
  WHERE status = 'completed'
  GROUP BY 1
)
SELECT week_start,
       passengers,
       LAG(passengers) OVER (ORDER BY week_start) AS prev_week,
       ROUND(100.0 * (passengers - LAG(passengers) OVER (ORDER BY week_start)) / LAG(passengers) OVER (ORDER BY week_start), 1) AS pct_change
FROM w
ORDER BY week_start;`,
    hints: ["date_trunc('week', …) snaps a date to its Monday.", 'Aggregate weekly in a CTE, then use LAG() to read the previous row.', 'WITH w AS (SELECT date_trunc(\'week\', service_date)::date AS week_start, SUM(passengers) ...) SELECT week_start, passengers, LAG(passengers) OVER (ORDER BY ___) ...'],
    explanation: 'Two-phase aggregation: bucket to weeks, then compare neighbours with LAG. A named WINDOW clause can remove the repetition.',
  },

  // ───────────────────────── Automotive · Velocity Motors ─────────────────────────
  {
    title: 'The EV Lineup',
    dataset: 'autohaus',
    difficulty: 'Easy',
    topics: ['Joins', 'Sorting'],
    statement: `List every electric model (\`segment = 'ev'\`) with its \`manufacturer\` name, \`model\` name and \`base_price\`, cheapest first. Break ties by model name.`,
    sql: `SELECT mf.name AS manufacturer, m.name AS model, m.base_price
FROM models m
JOIN manufacturers mf ON mf.manufacturer_id = m.manufacturer_id
WHERE m.segment = 'ev'
ORDER BY m.base_price, m.name;`,
    hints: ['Manufacturer names live in a different table.', 'JOIN models to manufacturers on manufacturer_id, then filter on segment.', "SELECT mf.name, m.name, m.base_price FROM models m JOIN manufacturers mf ON ___ WHERE m.segment = 'ev' ORDER BY ___"],
    explanation: 'A straightforward inner join plus filter. Aliasing both `name` columns avoids ambiguity.',
  },
  {
    title: 'Unsold Inventory',
    dataset: 'autohaus',
    difficulty: 'Easy',
    topics: ['Anti Join', 'Outer Joins'],
    statement: `Find vehicles that have **never been sold**.

Return \`vin\`, \`model\` (model name) and \`msrp\`, ordered by \`msrp\` descending, then \`vin\`.`,
    sql: `SELECT v.vin, m.name AS model, v.msrp
FROM vehicles v
JOIN models m ON m.model_id = v.model_id
LEFT JOIN sales s ON s.vin = v.vin
WHERE s.sale_id IS NULL
ORDER BY v.msrp DESC, v.vin;`,
    hints: ['A sold vehicle has a row in `sales`.', 'LEFT JOIN sales and keep rows where the sales side IS NULL (or use NOT EXISTS).', 'FROM vehicles v JOIN models m ON ... LEFT JOIN sales s ON s.vin = v.vin WHERE s.___ IS NULL'],
    explanation: 'LEFT JOIN … IS NULL and NOT EXISTS both express an anti-join; Postgres plans them identically here.',
  },
  {
    title: 'Dealer Scorecard',
    dataset: 'autohaus',
    difficulty: 'Medium',
    topics: ['Aggregation', 'Joins', 'GROUP BY'],
    statement: `Build a scorecard for every dealer that sold at least one car: \`dealer\` (name), \`units_sold\`, \`revenue\` (sum of \`sale_price\`) and \`avg_discount_pct\` — the average of \`(msrp - sale_price) / msrp * 100\` per sale, **rounded to 2 decimals**.

Order by \`revenue\` descending, then dealer name.`,
    sql: `SELECT d.name AS dealer,
       COUNT(*) AS units_sold,
       SUM(s.sale_price) AS revenue,
       ROUND(AVG((v.msrp - s.sale_price)::numeric / v.msrp * 100), 2) AS avg_discount_pct
FROM sales s
JOIN dealers d ON d.dealer_id = s.dealer_id
JOIN vehicles v ON v.vin = s.vin
GROUP BY d.dealer_id, d.name
ORDER BY revenue DESC, d.name;`,
    hints: ['msrp is on vehicles, sale_price on sales.', 'Join sales → dealers and sales → vehicles, then GROUP BY dealer. Integer division truncates — cast to numeric.', 'ROUND(AVG((v.msrp - s.sale_price)::numeric / v.msrp * 100), 2)'],
    explanation: 'Grouping by the dealer key (not just the name) is safer; casting to numeric avoids integer division.',
  },
  {
    title: 'Managers and Their Teams',
    dataset: 'autohaus',
    difficulty: 'Medium',
    topics: ['Self Join', 'Aggregation'],
    statement: `Each salesperson may report to a manager (\`manager_id\`). For every manager, return \`manager\` (full name), \`direct_reports\` (number of people reporting to them) and \`team_revenue\` — total \`sale_price\` of cars sold **by their direct reports** (0 if none).

Order by \`team_revenue\` descending, then manager name.`,
    sql: `SELECT mgr.full_name AS manager,
       COUNT(DISTINCT rep.salesperson_id) AS direct_reports,
       COALESCE(SUM(s.sale_price), 0) AS team_revenue
FROM salespeople mgr
JOIN salespeople rep ON rep.manager_id = mgr.salesperson_id
LEFT JOIN sales s ON s.salesperson_id = rep.salesperson_id
GROUP BY mgr.salesperson_id, mgr.full_name
ORDER BY team_revenue DESC, manager;`,
    hints: ['The same table plays two roles: manager and report.', 'Self-join salespeople (alias mgr and rep) and LEFT JOIN sales so reps without sales still count.', 'COUNT(DISTINCT rep.salesperson_id) — joining sales multiplies rows, so plain COUNT(*) over-counts.'],
    explanation: 'Self join for the hierarchy, LEFT JOIN for optional sales, COUNT(DISTINCT) to undo the fan-out caused by joining many sales per rep.',
  },
  {
    title: 'Service Frequent Flyers',
    dataset: 'autohaus',
    difficulty: 'Medium',
    topics: ['HAVING', 'Aggregation', 'Joins'],
    statement: `Find vehicles that came in for **non-warranty** service at least **3 times**.

Return \`vin\`, \`model\` (name), \`visits\` and \`total_cost\`. Order by \`visits\` descending, \`total_cost\` descending, then \`vin\`.`,
    sql: `SELECT sv.vin, m.name AS model, COUNT(*) AS visits, SUM(sv.cost) AS total_cost
FROM service_visits sv
JOIN vehicles v ON v.vin = sv.vin
JOIN models m ON m.model_id = v.model_id
WHERE sv.service_type <> 'warranty'
GROUP BY sv.vin, m.name
HAVING COUNT(*) >= 3
ORDER BY visits DESC, total_cost DESC, sv.vin;`,
    hints: ['Filtering rows and filtering groups happen in different clauses.', 'WHERE removes warranty rows; HAVING keeps groups with COUNT(*) >= 3.', "... WHERE service_type <> 'warranty' GROUP BY sv.vin, m.name HAVING ___"],
    explanation: 'WHERE filters before grouping, HAVING after. Putting the warranty filter in HAVING would not work because it is not an aggregate.',
  },
  {
    title: 'Regional Running Revenue',
    dataset: 'autohaus',
    difficulty: 'Hard',
    topics: ['Running Totals', 'Window Functions', 'Date & Time'],
    statement: `For each dealer \`region\`, compute monthly revenue and a running total within the region.

Return \`region\`, \`month\` (first day of the month, as a date), \`revenue\` and \`running_revenue\`. Order by \`region\`, then \`month\`.`,
    sql: `WITH m AS (
  SELECT d.region, date_trunc('month', s.sold_on)::date AS month, SUM(s.sale_price) AS revenue
  FROM sales s
  JOIN dealers d ON d.dealer_id = s.dealer_id
  GROUP BY 1, 2
)
SELECT region, month, revenue,
       SUM(revenue) OVER (PARTITION BY region ORDER BY month) AS running_revenue
FROM m
ORDER BY region, month;`,
    hints: ["date_trunc('month', …) buckets dates.", 'Aggregate per region & month first; then SUM(...) OVER (PARTITION BY region ORDER BY month).', 'WITH m AS (SELECT region, date_trunc(\'month\', sold_on)::date AS month, SUM(sale_price) AS revenue ... GROUP BY 1,2) SELECT ..., SUM(revenue) OVER (___) FROM m'],
    explanation: 'A windowed SUM with ORDER BY produces a cumulative total; PARTITION BY restarts it per region.',
  },
  {
    title: 'Salesperson of the Month',
    dataset: 'autohaus',
    difficulty: 'Hard',
    topics: ['Ranking', 'Window Functions', 'CTE'],
    statement: `For every month with sales, find the salesperson who sold the **most units**. Break ties by higher revenue, then by name.

Return \`month\` (first day, as a date), \`full_name\`, \`units\` and \`revenue\`. Order by \`month\`.`,
    sql: `WITH monthly AS (
  SELECT date_trunc('month', s.sold_on)::date AS month, sp.salesperson_id, sp.full_name,
         COUNT(*) AS units, SUM(s.sale_price) AS revenue
  FROM sales s
  JOIN salespeople sp ON sp.salesperson_id = s.salesperson_id
  GROUP BY 1, 2, 3
)
SELECT month, full_name, units, revenue
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY month ORDER BY units DESC, revenue DESC, full_name) AS rn
  FROM monthly
) x
WHERE rn = 1
ORDER BY month;`,
    hints: ['This is "top 1 per group" where the group is a month.', 'Aggregate per (month, salesperson), then ROW_NUMBER() partitioned by month with a 3-key ORDER BY.', 'ROW_NUMBER() OVER (PARTITION BY month ORDER BY units DESC, revenue DESC, full_name) = 1'],
    explanation: 'ROW_NUMBER with explicit tie-breakers guarantees exactly one winner per month; DISTINCT ON (month) is a Postgres-specific alternative.',
  },

  // ───────────────────────── Tech Engineering · ShipFast ─────────────────────────
  {
    title: 'Active Go & Rust Services',
    dataset: 'shipfast',
    difficulty: 'Easy',
    topics: ['Filtering', 'Sorting'],
    statement: `Return the \`name\` and \`language\` of every repository written in **Go** or **Rust** that is **not archived**, ordered by \`name\`.`,
    sql: `SELECT name, language
FROM repos
WHERE language IN ('Go', 'Rust') AND NOT is_archived
ORDER BY name;`,
    hints: ['Two conditions must both hold.', 'Use IN (...) for the language list and test the boolean column.', "WHERE language IN ('Go', 'Rust') AND ___"],
    explanation: 'IN keeps OR-lists readable; a boolean column can be used directly as a predicate.',
  },
  {
    title: 'PR Lead Time by Team',
    dataset: 'shipfast',
    difficulty: 'Medium',
    topics: ['Aggregation', 'Date & Time', 'Joins'],
    statement: `Lead time is the time from \`opened_at\` to \`merged_at\` for **merged** pull requests.

For each team (team of the repository), return \`team\`, \`merged_prs\` and \`median_hours\` — the **median** lead time in hours, rounded to **1 decimal**. Order by \`median_hours\` ascending, then team.`,
    sql: `SELECT t.name AS team,
       COUNT(*) AS merged_prs,
       ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM pr.merged_at - pr.opened_at) / 3600))::numeric, 1) AS median_hours
FROM pull_requests pr
JOIN repos r ON r.repo_id = pr.repo_id
JOIN teams t ON t.team_id = r.team_id
WHERE pr.merged_at IS NOT NULL
GROUP BY t.name
ORDER BY median_hours, team;`,
    hints: ['Medians are not AVG — Postgres has an ordered-set aggregate for percentiles.', 'PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY …) over EXTRACT(EPOCH FROM merged_at - opened_at)/3600.', 'ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ___))::numeric, 1)'],
    explanation: 'PERCENTILE_CONT returns double precision, so cast to numeric before ROUND(x, 1). Medians resist the long tail of stale PRs better than averages.',
  },
  {
    title: 'Change Failure Rate',
    dataset: 'shipfast',
    difficulty: 'Medium',
    topics: ['Aggregation', 'HAVING', 'CASE'],
    statement: `Change failure rate (a DORA metric) is the share of **production** deployments whose status is \`failed\` or \`rolled_back\`.

For repos with **at least 5** production deployments, return \`repo\` (name), \`prod_deploys\` and \`failure_rate_pct\` rounded to **1 decimal**. Order by \`failure_rate_pct\` descending, then repo name.`,
    sql: `SELECT r.name AS repo,
       COUNT(*) AS prod_deploys,
       ROUND(100.0 * COUNT(*) FILTER (WHERE d.status IN ('failed', 'rolled_back')) / COUNT(*), 1) AS failure_rate_pct
FROM deployments d
JOIN repos r ON r.repo_id = d.repo_id
WHERE d.environment = 'production'
GROUP BY r.name
HAVING COUNT(*) >= 5
ORDER BY failure_rate_pct DESC, repo;`,
    hints: ['Filter to production first, then aggregate per repo.', 'Conditional count over status, and HAVING COUNT(*) >= 5.', "ROUND(100.0 * COUNT(*) FILTER (WHERE status IN (___)) / COUNT(*), 1)"],
    explanation: 'Conditional aggregation + HAVING. The 5-deploy floor avoids noisy 100% rates from a single failure.',
  },
  {
    title: 'Engineers Without a Merge',
    dataset: 'shipfast',
    difficulty: 'Medium',
    topics: ['Anti Join', 'Joins'],
    statement: `Find engineers who had **no pull request merged in June 2026** (merged_at on or after 2026-06-01 and before 2026-07-01). They may have open, closed or older merged PRs.

Return \`full_name\` and \`team\` (team name), ordered by \`full_name\`.`,
    sql: `SELECT e.full_name, t.name AS team
FROM engineers e
JOIN teams t ON t.team_id = e.team_id
WHERE NOT EXISTS (
  SELECT 1 FROM pull_requests pr
  WHERE pr.author_id = e.engineer_id
    AND pr.merged_at >= TIMESTAMP '2026-06-01' AND pr.merged_at < TIMESTAMP '2026-07-01'
)
ORDER BY e.full_name;`,
    hints: ['"Has no X" is an anti-join.', 'NOT EXISTS with a correlated subquery that also checks the June merge window.', "WHERE NOT EXISTS (SELECT 1 FROM pull_requests pr WHERE pr.author_id = e.engineer_id AND pr.merged_at >= '2026-06-01' AND ___)"],
    explanation: 'Putting the merged condition inside the subquery is the key: a LEFT JOIN with the condition in WHERE would silently become an inner join.',
  },
  {
    title: 'MTTR by Severity',
    dataset: 'shipfast',
    difficulty: 'Hard',
    topics: ['Date & Time', 'Aggregation'],
    statement: `Mean time to restore (MTTR) is the average time between \`opened_at\` and \`resolved_at\`.

For each \`severity\`, return \`resolved\` (number of resolved incidents), \`unresolved\` (resolved_at IS NULL) and \`mttr_minutes\` — average minutes to resolve over resolved incidents, **rounded to the nearest whole minute**. Order by \`severity\`.`,
    sql: `SELECT severity,
       COUNT(resolved_at) AS resolved,
       COUNT(*) - COUNT(resolved_at) AS unresolved,
       ROUND(AVG(EXTRACT(EPOCH FROM resolved_at - opened_at) / 60)) AS mttr_minutes
FROM incidents
GROUP BY severity
ORDER BY severity;`,
    hints: ['COUNT(column) skips NULLs, COUNT(*) does not.', 'EXTRACT(EPOCH FROM interval) gives seconds; AVG ignores NULL automatically.', 'COUNT(resolved_at), COUNT(*) - COUNT(resolved_at), ROUND(AVG(EXTRACT(EPOCH FROM ___) / 60))'],
    explanation: 'NULL-aware aggregates do the heavy lifting: COUNT(col) and AVG skip unresolved incidents without any CASE logic.',
  },
  {
    title: 'Biggest PR per Repository',
    dataset: 'shipfast',
    difficulty: 'Hard',
    topics: ['Ranking', 'Window Functions'],
    statement: `For each repository, find the pull request with the most lines changed (\`lines_added + lines_deleted\`). If several PRs tie, take the one with the **smallest pr_id**.

Return \`repo\` (name), \`pr_id\` and \`lines_changed\`, ordered by \`lines_changed\` descending, then repo.`,
    sql: `SELECT DISTINCT ON (r.repo_id) r.name AS repo, pr.pr_id, pr.lines_added + pr.lines_deleted AS lines_changed
FROM pull_requests pr
JOIN repos r ON r.repo_id = pr.repo_id
ORDER BY r.repo_id, lines_changed DESC, pr.pr_id`,
    hints: ['One winner per group — think "top 1 per group".', 'Postgres DISTINCT ON (repo) keeps the first row per repo according to ORDER BY. Or use ROW_NUMBER().', 'Wrap it: SELECT * FROM (SELECT DISTINCT ON (repo_id) ... ORDER BY repo_id, lines_changed DESC, pr_id) x ORDER BY lines_changed DESC, repo'],
    explanation: 'DISTINCT ON needs its own ORDER BY, so the final presentation order must be applied in an outer query.',
  },

  // ───────────────────────── Healthcare · CarePoint ─────────────────────────
  {
    title: 'Department Revenue',
    dataset: 'carepoint',
    difficulty: 'Easy',
    topics: ['Aggregation', 'Joins', 'GROUP BY'],
    statement: `For each department, return \`department\` (name), \`completed_visits\` and \`revenue\` (sum of \`fee_charged\`) over **completed** appointments. Order by \`revenue\` descending, then department.`,
    sql: `SELECT dp.name AS department, COUNT(*) AS completed_visits, SUM(a.fee_charged) AS revenue
FROM appointments a
JOIN doctors d ON d.doctor_id = a.doctor_id
JOIN departments dp ON dp.department_id = d.department_id
WHERE a.status = 'completed'
GROUP BY dp.name
ORDER BY revenue DESC, department;`,
    hints: ['Appointments know the doctor, doctors know the department.', 'Two joins, a WHERE on status, GROUP BY department.', "FROM appointments a JOIN doctors d ON ___ JOIN departments dp ON ___ WHERE a.status = 'completed' GROUP BY dp.name"],
    explanation: 'Chain joins along foreign keys, filter, then aggregate.',
  },
  {
    title: 'No-Show Rate',
    dataset: 'carepoint',
    difficulty: 'Easy',
    topics: ['Aggregation', 'CASE'],
    statement: `Among appointments that were **not cancelled**, what percentage were \`no_show\`?

Return a single column \`no_show_pct\`, rounded to **2 decimals**.`,
    sql: `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'no_show') / COUNT(*), 2) AS no_show_pct
FROM appointments
WHERE status <> 'cancelled';`,
    hints: ['The denominator excludes cancelled appointments.', 'WHERE removes cancelled rows; a conditional count gives the numerator.', "ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'no_show') / COUNT(*), 2)"],
    explanation: 'Getting the denominator right is the whole problem — filter it in WHERE, count the event conditionally.',
  },
  {
    title: 'Most Prescribed Medications',
    dataset: 'carepoint',
    difficulty: 'Medium',
    topics: ['Aggregation', 'Joins'],
    statement: `Return the **top 5** medications by number of prescriptions: \`medication\`, \`prescriptions\` and \`patients\` (distinct patients who received it). Order by \`prescriptions\` descending, then medication.`,
    sql: `SELECT p.medication, COUNT(*) AS prescriptions, COUNT(DISTINCT a.patient_id) AS patients
FROM prescriptions p
JOIN appointments a ON a.appointment_id = p.appointment_id
GROUP BY p.medication
ORDER BY prescriptions DESC, p.medication
LIMIT 5;`,
    hints: ['Patients are reachable through appointments.', 'COUNT(*) vs COUNT(DISTINCT patient_id).', 'SELECT medication, COUNT(*), COUNT(DISTINCT a.patient_id) FROM prescriptions p JOIN appointments a ON ___ GROUP BY medication'],
    explanation: 'Two different counts from the same group: total rows vs unique patients.',
  },
  {
    title: 'Patients by Age Band',
    dataset: 'carepoint',
    difficulty: 'Medium',
    topics: ['CASE', 'Date & Time', 'GROUP BY'],
    statement: `Bucket patients who had **at least one completed appointment** into age bands based on their age on **2026-06-01**: \`0-17\`, \`18-39\`, \`40-59\`, \`60+\`.

Return \`age_band\` and \`patients\`, ordered by \`age_band\`.`,
    sql: `SELECT CASE
         WHEN age < 18 THEN '0-17'
         WHEN age < 40 THEN '18-39'
         WHEN age < 60 THEN '40-59'
         ELSE '60+'
       END AS age_band,
       COUNT(*) AS patients
FROM (
  SELECT p.patient_id, EXTRACT(YEAR FROM AGE(DATE '2026-06-01', p.birth_date)) AS age
  FROM patients p
  WHERE EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.patient_id AND a.status = 'completed')
) x
GROUP BY age_band
ORDER BY age_band;`,
    hints: ['AGE(date, date) returns an interval; EXTRACT(YEAR FROM …) gives completed years.', 'Use EXISTS to avoid counting a patient twice, then CASE to bucket.', "SELECT CASE WHEN age < 18 THEN '0-17' ... END AS age_band, COUNT(*) FROM (SELECT EXTRACT(YEAR FROM AGE(DATE '2026-06-01', birth_date)) AS age ...) x GROUP BY age_band"],
    explanation: 'EXISTS (not JOIN) keeps one row per patient; the CASE expression defines the buckets and the band labels sort correctly as text.',
  },
  {
    title: 'Doctor Satisfaction Board',
    dataset: 'carepoint',
    difficulty: 'Medium',
    topics: ['HAVING', 'Aggregation'],
    statement: `\`satisfaction\` (1–5) is recorded for some completed visits. For doctors with **at least 5 ratings**, return \`doctor\` (full name), \`ratings\` and \`avg_rating\` rounded to **2 decimals**. Order by \`avg_rating\` descending, then doctor name.`,
    sql: `SELECT d.full_name AS doctor, COUNT(a.satisfaction) AS ratings, ROUND(AVG(a.satisfaction), 2) AS avg_rating
FROM appointments a
JOIN doctors d ON d.doctor_id = a.doctor_id
GROUP BY d.doctor_id, d.full_name
HAVING COUNT(a.satisfaction) >= 5
ORDER BY avg_rating DESC, doctor;`,
    hints: ['Unrated visits have NULL satisfaction.', 'COUNT(satisfaction) and AVG(satisfaction) both ignore NULLs.', 'GROUP BY doctor HAVING COUNT(a.satisfaction) >= 5'],
    explanation: 'NULL-skipping aggregates mean no extra WHERE is required; HAVING enforces the minimum sample size.',
  },
  {
    title: 'Quick Returners',
    dataset: 'carepoint',
    difficulty: 'Hard',
    topics: ['Window Functions', 'Date & Time', 'CTE'],
    statement: `A patient is a **quick returner** if their **second** completed appointment happened within **30 days** of their first completed appointment.

Return \`full_name\`, \`first_visit\` and \`second_visit\` (dates) and \`days_between\`. Order by \`days_between\`, then \`full_name\`.`,
    sql: `WITH v AS (
  SELECT a.patient_id, a.scheduled_at::date AS visit_date,
         ROW_NUMBER() OVER (PARTITION BY a.patient_id ORDER BY a.scheduled_at, a.appointment_id) AS n
  FROM appointments a
  WHERE a.status = 'completed'
)
SELECT p.full_name, f.visit_date AS first_visit, s.visit_date AS second_visit, s.visit_date - f.visit_date AS days_between
FROM v f
JOIN v s ON s.patient_id = f.patient_id AND s.n = 2
JOIN patients p ON p.patient_id = f.patient_id
WHERE f.n = 1 AND s.visit_date - f.visit_date <= 30
ORDER BY days_between, p.full_name;`,
    hints: ['Number each patient\'s completed visits in time order.', 'ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY scheduled_at), then compare visit 1 and visit 2 (self-join or LEAD).', 'WITH v AS (SELECT patient_id, scheduled_at::date d, ROW_NUMBER() OVER (...) n ...) SELECT ... FROM v f JOIN v s ON s.patient_id = f.patient_id AND f.n = 1 AND s.n = 2'],
    explanation: 'Sequence events with ROW_NUMBER, then pair consecutive events. LEAD(scheduled_at) on the n = 1 row is an equivalent single-pass alternative.',
  },

  // ───────────────────────── Commerce · ShopWave ─────────────────────────
  {
    title: 'Plus Members by City',
    dataset: 'shopwave',
    difficulty: 'Easy',
    topics: ['GROUP BY', 'Filtering'],
    statement: `Count customers on the \`plus\` tier per \`city\`. Return \`city\` and \`plus_members\`, ordered by \`plus_members\` descending, then city.`,
    sql: `SELECT city, COUNT(*) AS plus_members
FROM customers
WHERE tier = 'plus'
GROUP BY city
ORDER BY plus_members DESC, city;`,
    hints: ['One row per city.', 'Filter the tier, then GROUP BY city.', "SELECT city, COUNT(*) FROM customers WHERE tier = 'plus' GROUP BY ___ ORDER BY ___"],
    explanation: 'Filter → group → sort; the classic aggregation pipeline.',
  },
  {
    title: 'Customers Who Never Ordered',
    dataset: 'shopwave',
    difficulty: 'Easy',
    topics: ['Anti Join', 'Outer Joins'],
    statement: `Return the \`full_name\` and \`email\` of customers with **no orders at all**, ordered by \`full_name\`.`,
    sql: `SELECT c.full_name, c.email
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
WHERE o.order_id IS NULL
ORDER BY c.full_name;`,
    hints: ['Look for customers without a match in orders.', 'LEFT JOIN orders and keep NULL order_id, or NOT EXISTS.', 'FROM customers c LEFT JOIN orders o ON ___ WHERE o.order_id IS NULL'],
    explanation: 'Classic anti-join.',
  },
  {
    title: 'Category Revenue Rollup',
    dataset: 'shopwave',
    difficulty: 'Medium',
    topics: ['Self Join', 'Joins', 'Aggregation'],
    statement: `Categories form a two-level tree (\`parent_id\`). Line revenue is \`quantity * unit_price * (1 - discount)\`.

For **delivered** orders, roll revenue up to the **top-level** category. Return \`category\` (top-level name) and \`revenue\` rounded to **2 decimals**, ordered by \`revenue\` descending.`,
    sql: `SELECT parent.name AS category,
       ROUND(SUM(oi.quantity * oi.unit_price * (1 - oi.discount)), 2) AS revenue
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
JOIN products p ON p.product_id = oi.product_id
JOIN categories c ON c.category_id = p.category_id
JOIN categories parent ON parent.category_id = c.parent_id
WHERE o.status = 'delivered'
GROUP BY parent.name
ORDER BY revenue DESC;`,
    hints: ['Products point at leaf categories; leaf categories point at their parent.', 'Join categories twice (child and parent aliases).', 'JOIN categories c ON c.category_id = p.category_id JOIN categories parent ON parent.category_id = c.___'],
    explanation: 'A self join climbs one level of the hierarchy. For arbitrary depth you would use a recursive CTE.',
  },
  {
    title: 'Top Rated Products',
    dataset: 'shopwave',
    difficulty: 'Medium',
    topics: ['HAVING', 'Aggregation', 'Sorting'],
    statement: `Among products with **at least 3 reviews**, return the top 5 by average rating: \`product\` (name), \`reviews\` and \`avg_rating\` (2 decimals). Order by \`avg_rating\` descending, then \`reviews\` descending, then product name.`,
    sql: `SELECT p.name AS product, COUNT(*) AS reviews, ROUND(AVG(r.rating), 2) AS avg_rating
FROM reviews r
JOIN products p ON p.product_id = r.product_id
GROUP BY p.product_id, p.name
HAVING COUNT(*) >= 3
ORDER BY avg_rating DESC, reviews DESC, product
LIMIT 5;`,
    hints: ['Minimum-review rules are group filters.', 'GROUP BY product, HAVING COUNT(*) >= 3, then sort and LIMIT.', 'ORDER BY avg_rating DESC, reviews DESC, product LIMIT 5'],
    explanation: 'HAVING enforces a minimum sample; multi-key ORDER BY makes LIMIT deterministic.',
  },
  {
    title: 'Frequently Bought Together',
    dataset: 'shopwave',
    difficulty: 'Hard',
    topics: ['Self Join', 'Aggregation'],
    statement: `Find the product pairs that appear together in the same order most often.

Return \`product_a\`, \`product_b\` (names, where product_a has the **smaller product_id**) and \`orders_together\`. Show the **top 5** pairs by \`orders_together\` descending; break ties by product_a then product_b name.`,
    sql: `SELECT pa.name AS product_a, pb.name AS product_b, COUNT(*) AS orders_together
FROM order_items a
JOIN order_items b ON b.order_id = a.order_id AND a.product_id < b.product_id
JOIN products pa ON pa.product_id = a.product_id
JOIN products pb ON pb.product_id = b.product_id
GROUP BY pa.name, pb.name
ORDER BY orders_together DESC, product_a, product_b
LIMIT 5;`,
    hints: ['Pair every line item with every other line item of the same order.', 'Self-join order_items on order_id with a.product_id < b.product_id to avoid duplicates and self-pairs.', 'FROM order_items a JOIN order_items b ON b.order_id = a.order_id AND a.product_id < b.product_id'],
    explanation: 'The `<` condition halves the pairs and removes (x, x). This is market-basket analysis in pure SQL.',
  },
  {
    title: 'First-Order Cohorts',
    dataset: 'shopwave',
    difficulty: 'Hard',
    topics: ['CTE', 'Date & Time', 'Aggregation'],
    statement: `Group customers into cohorts by the month of their **first** non-cancelled order. For each cohort return \`cohort_month\` (first day, as a date), \`customers\` and \`returned\` — how many of them placed another non-cancelled order in a **later** month — plus \`retention_pct\` (1 decimal).

Order by \`cohort_month\`.`,
    sql: `WITH o AS (
  SELECT customer_id, date_trunc('month', order_date)::date AS m
  FROM orders
  WHERE status <> 'cancelled'
), first AS (
  SELECT customer_id, MIN(m) AS cohort_month FROM o GROUP BY customer_id
)
SELECT f.cohort_month,
       COUNT(*) AS customers,
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM o WHERE o.customer_id = f.customer_id AND o.m > f.cohort_month)) AS returned,
       ROUND(100.0 * COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM o WHERE o.customer_id = f.customer_id AND o.m > f.cohort_month)) / COUNT(*), 1) AS retention_pct
FROM first f
GROUP BY f.cohort_month
ORDER BY f.cohort_month;`,
    hints: ['Step 1: find each customer\'s first order month. Step 2: check for any later month.', 'MIN(date_trunc(\'month\', order_date)) per customer, then EXISTS for a later month.', 'WITH first AS (SELECT customer_id, MIN(date_trunc(\'month\', order_date))::date AS cohort_month ... ) SELECT cohort_month, COUNT(*), COUNT(*) FILTER (WHERE EXISTS (...)) ...'],
    explanation: 'Cohort analysis = anchor event per entity (MIN) + follow-up check (EXISTS). A LEFT JOIN to an aggregated "later activity" CTE avoids evaluating the subquery twice.',
  },

  // ───────────────────────── Media · Netflix (Kaggle) ─────────────────────────
  {
    title: 'Long Recent Movies',
    dataset: 'streamflix',
    difficulty: 'Easy',
    topics: ['Filtering', 'Sorting'],
    statement: `Return the \`title\`, \`release_year\` and \`duration_minutes\` of **movies** released in **2018 or later** that run for **at least 120 minutes**. Order by \`duration_minutes\` descending, then title.`,
    sql: `SELECT title, release_year, duration_minutes
FROM titles
WHERE type = 'Movie' AND release_year >= 2018 AND duration_minutes >= 120
ORDER BY duration_minutes DESC, title;`,
    hints: ['Three conditions joined with AND.', "type = 'Movie', release_year >= 2018, duration_minutes >= 120.", 'ORDER BY duration_minutes DESC, title'],
    explanation: 'Multi-condition filtering; note TV shows have NULL duration_minutes so they would drop out anyway.',
  },
  {
    title: 'Genre Leaderboard',
    dataset: 'streamflix',
    difficulty: 'Easy',
    topics: ['GROUP BY', 'Sorting'],
    statement: `Return the **10** most common genres: \`genre\` and \`titles\` (number of titles tagged with it). Order by \`titles\` descending, then genre.`,
    sql: `SELECT genre, COUNT(*) AS titles
FROM title_genres
GROUP BY genre
ORDER BY titles DESC, genre
LIMIT 10;`,
    hints: ['Genres live in a link table with one row per (title, genre).', 'GROUP BY genre, COUNT(*).', 'SELECT genre, COUNT(*) AS titles FROM title_genres GROUP BY genre ORDER BY titles DESC, genre LIMIT 10;'],
    explanation: 'Many-to-many tags are counted on the link table directly.',
  },
  {
    title: 'Prolific Directors',
    dataset: 'streamflix',
    difficulty: 'Medium',
    topics: ['Joins', 'HAVING'],
    statement: `Return directors credited on **at least 2 titles** in this catalog: \`director\` (name) and \`titles\`. Order by \`titles\` descending, then director.`,
    sql: `SELECT p.name AS director, COUNT(*) AS titles
FROM credits c
JOIN people p ON p.person_id = c.person_id
WHERE c.role = 'director'
GROUP BY p.person_id, p.name
HAVING COUNT(*) >= 2
ORDER BY titles DESC, director;`,
    hints: ['credits links people to titles with a role.', "Filter role = 'director', group per person, HAVING COUNT(*) >= 2.", "... WHERE c.role = 'director' GROUP BY p.person_id, p.name HAVING ___"],
    explanation: 'WHERE for the role, HAVING for the threshold.',
  },
  {
    title: 'Movie Length by Rating',
    dataset: 'streamflix',
    difficulty: 'Medium',
    topics: ['Aggregation', 'HAVING'],
    statement: `For movie content ratings (e.g. \`PG-13\`, \`TV-MA\`) with **at least 5 movies**, return \`rating\`, \`movies\` and \`avg_minutes\` (1 decimal). Ignore NULL ratings. Order by \`avg_minutes\` descending, then rating.`,
    sql: `SELECT rating, COUNT(*) AS movies, ROUND(AVG(duration_minutes), 1) AS avg_minutes
FROM titles
WHERE type = 'Movie' AND rating IS NOT NULL
GROUP BY rating
HAVING COUNT(*) >= 5
ORDER BY avg_minutes DESC, rating;`,
    hints: ['Only movies, only non-NULL ratings.', 'GROUP BY rating with HAVING COUNT(*) >= 5.', 'ROUND(AVG(duration_minutes), 1)'],
    explanation: 'Filtering NULL groups and enforcing a minimum group size are both common reporting requirements.',
  },
  {
    title: 'Catalog Growth Curve',
    dataset: 'streamflix',
    difficulty: 'Hard',
    topics: ['Running Totals', 'Window Functions', 'Date & Time'],
    statement: `Using \`date_added\` (ignore NULLs), return each \`year_added\`, the number of \`titles_added\` that year, and \`catalog_size\` — the cumulative number of titles added up to and including that year. Order by \`year_added\`.`,
    sql: `WITH y AS (
  SELECT EXTRACT(YEAR FROM date_added)::int AS year_added, COUNT(*) AS titles_added
  FROM titles
  WHERE date_added IS NOT NULL
  GROUP BY 1
)
SELECT year_added, titles_added, SUM(titles_added) OVER (ORDER BY year_added) AS catalog_size
FROM y
ORDER BY year_added;`,
    hints: ['Group by year, then accumulate.', 'Aggregate per year in a CTE, then SUM(...) OVER (ORDER BY year) — or nest SUM(COUNT(*)) OVER (...) directly.', 'WITH y AS (SELECT EXTRACT(YEAR FROM date_added)::int AS year_added, COUNT(*) AS titles_added ... GROUP BY 1) SELECT ..., SUM(titles_added) OVER (ORDER BY ___) FROM y'],
    explanation: 'Window functions run after GROUP BY, so an aggregate can be windowed in the same SELECT.',
  },
  {
    title: 'Movie vs Show Mix by Country',
    dataset: 'streamflix',
    difficulty: 'Hard',
    topics: ['CASE', 'Joins', 'HAVING'],
    statement: `For countries with **at least 15** titles, return \`country\`, \`movies\`, \`shows\` and \`movie_pct\` (share of movies, 1 decimal). Order by \`movie_pct\` descending, then country.`,
    sql: `SELECT tc.country,
       COUNT(*) FILTER (WHERE t.type = 'Movie') AS movies,
       COUNT(*) FILTER (WHERE t.type = 'TV Show') AS shows,
       ROUND(100.0 * COUNT(*) FILTER (WHERE t.type = 'Movie') / COUNT(*), 1) AS movie_pct
FROM title_countries tc
JOIN titles t ON t.show_id = tc.show_id
GROUP BY tc.country
HAVING COUNT(*) >= 15
ORDER BY movie_pct DESC, tc.country;`,
    hints: ['Pivot two categories into two columns.', 'Conditional aggregation: COUNT(*) FILTER (WHERE type = …) or SUM(CASE …).', "COUNT(*) FILTER (WHERE t.type = 'Movie') AS movies, COUNT(*) FILTER (WHERE t.type = 'TV Show') AS shows"],
    explanation: 'Conditional aggregation pivots rows into columns in a single scan.',
  },

  // ───────────────────────── Sports · Olympics (Kaggle) ─────────────────────────
  {
    title: 'Host Cities',
    dataset: 'olympics',
    difficulty: 'Easy',
    topics: ['Sorting'],
    statement: `List every Games edition in the dataset: \`year\` and \`host_city\`, ordered by \`year\`.`,
    sql: `SELECT year, host_city FROM games ORDER BY year;`,
    hints: ['One table.', 'SELECT two columns and ORDER BY year.', 'SELECT year, host_city FROM games ORDER BY ___;'],
    explanation: 'Warm-up: projection and sorting.',
  },
  {
    title: 'Rio 2016 Medal Table',
    dataset: 'olympics',
    difficulty: 'Medium',
    topics: ['CASE', 'Aggregation', 'Joins'],
    statement: `Build the medal table for the **2016** Games (count every medal row — team events count each member).

Return \`noc\`, \`gold\`, \`silver\`, \`bronze\` and \`total\` for the **top 10** NOCs, ordered by gold, silver, bronze (all descending), then \`noc\`.`,
    sql: `SELECT r.noc,
       COUNT(*) FILTER (WHERE r.medal = 'Gold') AS gold,
       COUNT(*) FILTER (WHERE r.medal = 'Silver') AS silver,
       COUNT(*) FILTER (WHERE r.medal = 'Bronze') AS bronze,
       COUNT(r.medal) AS total
FROM results r
JOIN games g ON g.games_id = r.games_id
WHERE g.year = 2016 AND r.medal IS NOT NULL
GROUP BY r.noc
ORDER BY gold DESC, silver DESC, bronze DESC, r.noc
LIMIT 10;`,
    hints: ['Pivot medal colours into columns.', 'Conditional counts per noc, filtered to 2016 medal rows.', "COUNT(*) FILTER (WHERE medal = 'Gold') AS gold, ... ORDER BY gold DESC, silver DESC, bronze DESC, noc LIMIT 10"],
    explanation: 'Olympic tables rank lexicographically by gold, then silver, then bronze — a 3-key sort.',
  },
  {
    title: 'Multi-Games Medalists',
    dataset: 'olympics',
    difficulty: 'Medium',
    topics: ['HAVING', 'Aggregation', 'Joins'],
    statement: `Find athletes who won medals at **3 or more different Games**. Return \`name\`, \`games\` (distinct Games with a medal) and \`medals\` (total medals). Order by \`games\` descending, \`medals\` descending, then name.`,
    sql: `SELECT a.name, COUNT(DISTINCT r.games_id) AS games, COUNT(*) AS medals
FROM results r
JOIN athletes a ON a.athlete_id = r.athlete_id
WHERE r.medal IS NOT NULL
GROUP BY a.athlete_id, a.name
HAVING COUNT(DISTINCT r.games_id) >= 3
ORDER BY games DESC, medals DESC, a.name;`,
    hints: ['Count distinct Games, not medal rows.', 'COUNT(DISTINCT games_id) in HAVING.', 'GROUP BY a.athlete_id, a.name HAVING COUNT(DISTINCT r.games_id) >= 3'],
    explanation: 'COUNT(DISTINCT) answers "in how many different X" questions; grouping by the id guards against namesakes.',
  },
  {
    title: 'Youngest Gold per Sport',
    dataset: 'olympics',
    difficulty: 'Hard',
    topics: ['Ranking', 'Window Functions', 'Joins'],
    statement: `For each sport, find the **youngest gold medalist** (age = Games year − birth_year; ignore unknown birth years). If several share the youngest age, pick the one whose name sorts first.

Return \`sport\`, \`name\` and \`age\`, ordered by \`sport\`.`,
    sql: `SELECT DISTINCT ON (e.sport) e.sport, a.name, g.year - a.birth_year AS age
FROM results r
JOIN athletes a ON a.athlete_id = r.athlete_id
JOIN events e ON e.event_id = r.event_id
JOIN games g ON g.games_id = r.games_id
WHERE r.medal = 'Gold' AND a.birth_year IS NOT NULL
ORDER BY e.sport, age, a.name;`,
    hints: ['Top-1 per group again — group is the sport.', 'Compute age from games.year and athletes.birth_year; DISTINCT ON (sport) or ROW_NUMBER().', 'SELECT DISTINCT ON (e.sport) e.sport, a.name, g.year - a.birth_year AS age ... ORDER BY e.sport, age, a.name'],
    explanation: 'DISTINCT ON keeps the first row per sport under the ORDER BY — concise and fast.',
  },
  {
    title: 'Back-to-Back Champions',
    dataset: 'olympics',
    difficulty: 'Hard',
    topics: ['Window Functions', 'Gaps & Islands'],
    statement: `Find athletes who won **gold in the same event at two consecutive Games** in this dataset (consecutive = next Games edition present in \`games\`).

Return \`name\`, \`event_name\`, \`first_year\` and \`second_year\`. Order by \`first_year\`, \`event_name\`, then \`name\`.`,
    sql: `WITH g AS (
  SELECT games_id, year, LEAD(year) OVER (ORDER BY year) AS next_year FROM games
), golds AS (
  SELECT r.athlete_id, r.event_id, gm.year
  FROM results r
  JOIN games gm ON gm.games_id = r.games_id
  WHERE r.medal = 'Gold'
)
SELECT DISTINCT a.name, e.event_name, x.year AS first_year, y.year AS second_year
FROM golds x
JOIN g ON g.year = x.year
JOIN golds y ON y.athlete_id = x.athlete_id AND y.event_id = x.event_id AND y.year = g.next_year
JOIN athletes a ON a.athlete_id = x.athlete_id
JOIN events e ON e.event_id = x.event_id
ORDER BY first_year, e.event_name, a.name;`,
    hints: ['"Consecutive" is defined by the games table, not by +4 years.', 'Use LEAD(year) OVER (ORDER BY year) on games to find each edition\'s successor, then self-join gold results.', 'WITH g AS (SELECT year, LEAD(year) OVER (ORDER BY year) AS next_year FROM games) ... JOIN golds y ON y.athlete_id = x.athlete_id AND y.event_id = x.event_id AND y.year = g.next_year'],
    explanation: 'Define adjacency with LEAD, then self-join on (athlete, event, next edition). DISTINCT handles duplicate result rows.',
  },

  // ───────────────────────── Architect tier (correct AND efficient) ─────────────────────────
  {
    title: 'Route Load Factor Board',
    dataset: 'transit',
    difficulty: 'Hard',
    topics: ['Ranking', 'Aggregation', 'Joins'],
    tier: 6,
    budget: 1.6,
    statement: `Capacity planning needs a **load factor** board. A trip's load factor is \`passengers / capacity\` of the bus that ran it.

For every route with completed trips return \`route_code\`, \`trips\` (completed), \`avg_load_pct\` — the average load factor × 100, rounded to **1 decimal** — \`load_rank\` (RANK by average load factor, highest = 1, ties share a rank) and \`status\`: \`'overcrowded'\` when the average load factor is above 1, otherwise \`'ok'\`.

Order by \`load_rank\`, then \`route_code\`.

> ⚡ **Performance budget:** your query's planner cost must stay within 1.6× of the reference plan. Compute each route's average once.`,
    sql: `SELECT r.route_code,
       COUNT(*) AS trips,
       ROUND(100.0 * AVG(t.passengers::numeric / b.capacity), 1) AS avg_load_pct,
       RANK() OVER (ORDER BY AVG(t.passengers::numeric / b.capacity) DESC) AS load_rank,
       CASE WHEN AVG(t.passengers::numeric / b.capacity) > 1 THEN 'overcrowded' ELSE 'ok' END AS status
FROM trips t
JOIN routes r ON r.route_id = t.route_id
JOIN buses b ON b.bus_id = t.bus_id
WHERE t.status = 'completed'
GROUP BY r.route_code
ORDER BY load_rank, r.route_code;`,
    hints: ['Load factor needs data from three tables; the rank is computed over route-level averages.', 'Aggregate per route, then a window function (RANK) can run over the aggregated rows in the same SELECT.', 'SELECT route_code, COUNT(*), ROUND(100.0 * AVG(passengers::numeric / capacity), 1), RANK() OVER (ORDER BY AVG(___) DESC), CASE WHEN ___ THEN ... END ... GROUP BY route_code'],
    explanation: 'Window functions are evaluated after GROUP BY, so ranking an aggregate needs no subquery. Correlated subqueries per route would rescan trips once per route and blow the budget.',
  },
  {
    title: 'DORA Scorecard per Team',
    dataset: 'shipfast',
    difficulty: 'Hard',
    topics: ['CTE', 'Aggregation', 'Outer Joins'],
    tier: 6,
    budget: 1.6,
    statement: `Leadership wants one row per team with the core **DORA** metrics, over the 13 weeks starting 2026-04-01. A deployment/incident belongs to the team that owns its repository.

Return \`team\`, \`prod_deploys\` (production deployments), \`deploys_per_week\` (prod_deploys / 13, rounded to **2 decimals**), \`change_failure_pct\` — share of production deploys whose status is not \`success\`, rounded to **1 decimal** (NULL if the team has no production deploys) — and \`mttr_hours\`: average hours from \`opened_at\` to \`resolved_at\` over the team's **resolved** incidents, rounded to **1 decimal** (NULL if none).

Every team must appear (use 0 deploys where there are none). Order by \`team\`.

> ⚡ **Performance budget:** within 1.6× of the reference plan. Watch out for join fan-out between deployments and incidents.`,
    sql: `WITH d AS (
  SELECT r.team_id, COUNT(*) AS prod_deploys, COUNT(*) FILTER (WHERE dp.status <> 'success') AS failed
  FROM deployments dp
  JOIN repos r ON r.repo_id = dp.repo_id
  WHERE dp.environment = 'production'
  GROUP BY r.team_id
), i AS (
  SELECT r.team_id, AVG(EXTRACT(EPOCH FROM inc.resolved_at - inc.opened_at) / 3600) AS mttr
  FROM incidents inc
  JOIN repos r ON r.repo_id = inc.repo_id
  WHERE inc.resolved_at IS NOT NULL
  GROUP BY r.team_id
)
SELECT t.name AS team,
       COALESCE(d.prod_deploys, 0) AS prod_deploys,
       ROUND(COALESCE(d.prod_deploys, 0) / 13.0, 2) AS deploys_per_week,
       ROUND(100.0 * d.failed / NULLIF(d.prod_deploys, 0), 1) AS change_failure_pct,
       ROUND(i.mttr::numeric, 1) AS mttr_hours
FROM teams t
LEFT JOIN d ON d.team_id = t.team_id
LEFT JOIN i ON i.team_id = t.team_id
ORDER BY t.name;`,
    hints: ['Joining deployments AND incidents to repos in one query multiplies rows (every deploy × every incident).', 'Pre-aggregate each fact table per team in its own CTE, then LEFT JOIN both onto teams.', 'WITH d AS (SELECT team_id, COUNT(*) ... FROM deployments ... GROUP BY team_id), i AS (SELECT team_id, AVG(...) FROM incidents ... GROUP BY team_id) SELECT ... FROM teams t LEFT JOIN d ... LEFT JOIN i ...'],
    explanation: 'The classic metric-design pattern: aggregate each fact table to the reporting grain before joining. It is both correct (no fan-out double counting) and cheap.',
  },
  {
    title: 'Customer 360 in One Pass',
    dataset: 'shopwave',
    difficulty: 'Hard',
    topics: ['CTE', 'Ranking', 'Aggregation'],
    tier: 6,
    budget: 1.6,
    statement: `CRM needs a compact **customer 360** for the 15 most valuable customers.

For customers with at least one non-cancelled order return \`full_name\`, \`orders\` (non-cancelled orders), \`lifetime_value\` (sum of \`order_total\` over **delivered** orders, 0 if none), \`last_order_date\` (latest non-cancelled order) and \`favourite_category\` — the **top-level** category with the highest total \`quantity\` across their delivered orders (ties → alphabetically first; NULL if they have no delivered orders).

Order by \`lifetime_value\` descending, then \`full_name\`; return the first **15** rows.

> ⚡ **Performance budget:** within 1.6× of the reference plan — avoid per-customer correlated subqueries.`,
    sql: `WITH o AS (
  SELECT customer_id,
         COUNT(*) AS orders,
         COALESCE(SUM(order_total) FILTER (WHERE status = 'delivered'), 0) AS lifetime_value,
         MAX(order_date) AS last_order_date
  FROM orders
  WHERE status <> 'cancelled'
  GROUP BY customer_id
), fav AS (
  SELECT DISTINCT ON (od.customer_id) od.customer_id, parent.name AS favourite_category
  FROM orders od
  JOIN order_items oi ON oi.order_id = od.order_id
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
  JOIN categories parent ON parent.category_id = c.parent_id
  WHERE od.status = 'delivered'
  GROUP BY od.customer_id, parent.name
  ORDER BY od.customer_id, SUM(oi.quantity) DESC, parent.name
)
SELECT cu.full_name, o.orders, o.lifetime_value, o.last_order_date, fav.favourite_category
FROM o
JOIN customers cu ON cu.customer_id = o.customer_id
LEFT JOIN fav ON fav.customer_id = o.customer_id
ORDER BY o.lifetime_value DESC, cu.full_name
LIMIT 15;`,
    hints: ['Two different grains: per customer (orders, value, recency) and per customer × category (favourite).', 'Build one CTE per grain; pick the favourite with DISTINCT ON or ROW_NUMBER, then LEFT JOIN.', 'WITH o AS (... GROUP BY customer_id), fav AS (SELECT DISTINCT ON (customer_id) customer_id, parent.name ... GROUP BY customer_id, parent.name ORDER BY customer_id, SUM(quantity) DESC, parent.name) SELECT ... FROM o JOIN customers ... LEFT JOIN fav ...'],
    explanation: 'Each metric is computed once at its natural grain and joined at the end — the same shape as a dbt "customer 360" model. Scalar subqueries per customer re-scan orders for every row.',
  },
];
