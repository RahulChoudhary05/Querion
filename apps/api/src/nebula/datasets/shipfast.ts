import type { Cell, Dataset } from '@querion/engine';
import { day, makeRand, ts, uniqueNames } from './lib';

/** Software engineering org: teams, engineers, repositories, pull requests, deployments and incidents. */
export function shipfast(): Dataset {
  const r = makeRand(9001);
  const teamDefs: [string, string][] = [
    ['Payments', 'Fintech'], ['Search', 'Discovery'], ['Platform', 'Infrastructure'], ['Mobile', 'Product'], ['Data', 'Infrastructure'], ['Growth', 'Product'],
  ];
  const teams: Cell[][] = teamDefs.map(([n, o], i) => [i + 1, n, o]);

  const names = uniqueNames(r, 42);
  const engineers: Cell[][] = [];
  let eid = 1;
  for (let t = 1; t <= teams.length; t++) {
    const lead = eid;
    const size = t === 3 ? 9 : 6 + (t % 2);
    for (let k = 0; k < size && eid <= names.length; k++) {
      const level = k === 0 ? r.pick(['L6', 'L7']) : r.weighted([['L3', 3], ['L4', 4], ['L5', 3], ['L6', 1]]);
      engineers.push([eid, names[eid - 1], t, level, day('2018-01-01', r.int(0, 2900)), k === 0 ? null : lead]);
      eid++;
    }
  }

  const repoDefs: [string, string, number][] = [
    ['payments-gateway', 'Go', 1], ['ledger-service', 'Java', 1], ['fraud-scorer', 'Python', 1],
    ['search-api', 'Rust', 2], ['ranker', 'Python', 2], ['autocomplete', 'TypeScript', 2],
    ['k8s-infra', 'HCL', 3], ['service-mesh', 'Go', 3], ['ci-runners', 'Go', 3], ['observability', 'TypeScript', 3],
    ['ios-app', 'Swift', 4], ['android-app', 'Kotlin', 4],
    ['etl-pipelines', 'Python', 5], ['warehouse-models', 'SQL', 5],
    ['experiments', 'TypeScript', 6], ['notifications', 'Java', 6],
  ];
  const repos: Cell[][] = repoDefs.map(([n, l, t], i) => [i + 1, n, l, t, day('2019-03-01', r.int(0, 1800)), i === 9 ? true : false]);

  const prs: Cell[][] = [];
  for (let i = 1; i <= 420; i++) {
    const repoId = r.weighted(repos.map((x) => [x[0] as number, x[5] ? 0.3 : 1 + ((x[0] as number) % 3)]));
    const teamId = repoDefs[repoId - 1][2];
    const teamEng = engineers.filter((e) => e[2] === teamId);
    const author = r.chance(0.85) ? r.pick(teamEng)[0] : r.pick(engineers)[0];
    const date = day('2026-04-01', r.int(0, 90));
    const openedMin = r.int(9 * 60, 20 * 60);
    const outcome = r.weighted([['merged', 78], ['closed', 12], ['open', 10]]);
    const hoursToClose = Math.max(0.3, r.normal(30, 28)) * 60;
    const added = Math.round(Math.exp(r.normal(4, 1.3)));
    prs.push([
      i,
      repoId,
      author,
      ts(date, openedMin),
      outcome === 'merged' ? ts(date, openedMin + hoursToClose) : null,
      outcome === 'closed' ? ts(date, openedMin + hoursToClose) : null,
      added,
      Math.round(added * r.f() * 0.7),
      outcome === 'open' ? r.int(0, 2) : r.int(1, 6),
    ]);
  }

  const deploys: Cell[][] = [];
  for (let i = 1; i <= 320; i++) {
    const repoId = r.int(1, repos.length);
    if (repos[repoId - 1][5]) continue;
    const date = day('2026-04-01', r.int(0, 90));
    const env = r.weighted([['production', 5], ['staging', 4]]);
    deploys.push([deploys.length + 1, repoId, env, ts(date, r.int(8 * 60, 22 * 60)), r.weighted([['success', 86], ['failed', 8], ['rolled_back', 6]]), r.int(45, 1400)]);
  }

  const incidents: Cell[][] = [];
  const prodBad = deploys.filter((d) => d[2] === 'production' && d[4] !== 'success');
  for (let i = 1; i <= 54; i++) {
    const caused = i <= prodBad.length && r.chance(0.7) ? prodBad[i - 1] : null;
    const repoId = caused ? (caused[1] as number) : r.int(1, repos.length);
    const opened = caused ? (caused[3] as string) : ts(day('2026-04-01', r.int(0, 90)), r.int(0, 1439));
    const sev = r.weighted([['SEV1', 1], ['SEV2', 3], ['SEV3', 6], ['SEV4', 5]]);
    const mins = sev === 'SEV1' ? r.int(20, 240) : sev === 'SEV2' ? r.int(30, 600) : r.int(60, 4000);
    const openedDate = opened.slice(0, 10);
    const openedMins = Number(opened.slice(11, 13)) * 60 + Number(opened.slice(14, 16)) + 7;
    incidents.push([i, repoId, sev, ts(openedDate, openedMins), r.chance(0.07) ? null : ts(openedDate, openedMins + mins), caused ? caused[0] : null]);
  }

  return {
    key: 'shipfast',
    name: 'ShipFast Engineering',
    domain: 'engineering',
    tagline: 'An engineering org in numbers — PRs, deploys, incidents and DORA metrics.',
    description:
      'Six product & platform teams. Pull requests are merged (merged_at), closed without merge (closed_at) or still open (both NULL). Deployments go to staging or production; incidents may be linked to the production deployment that caused them. Perfect for DORA-style metrics: lead time, change failure rate, MTTR.',
    source: { kind: 'synthetic', license: 'CC0' },
    version: '2026.11.1',
    tables: [
      { name: 'teams', description: 'Engineering teams', columns: [{ name: 'team_id', type: 'integer', pk: true }, { name: 'name', type: 'text' }, { name: 'org', type: 'text' }], rows: teams },
      { name: 'engineers', description: 'Engineers (lead_id is NULL for team leads)', columns: [{ name: 'engineer_id', type: 'integer', pk: true }, { name: 'full_name', type: 'text' }, { name: 'team_id', type: 'integer', ref: 'teams.team_id' }, { name: 'level', type: 'text', note: 'L3 (junior) … L7 (principal)' }, { name: 'joined_on', type: 'date' }, { name: 'lead_id', type: 'integer', nullable: true, ref: 'engineers.engineer_id' }], rows: engineers },
      { name: 'repos', description: 'Code repositories', columns: [{ name: 'repo_id', type: 'integer', pk: true }, { name: 'name', type: 'text' }, { name: 'language', type: 'text' }, { name: 'team_id', type: 'integer', ref: 'teams.team_id' }, { name: 'created_on', type: 'date' }, { name: 'is_archived', type: 'boolean' }], rows: repos },
      { name: 'pull_requests', description: 'Pull requests', columns: [{ name: 'pr_id', type: 'integer', pk: true }, { name: 'repo_id', type: 'integer', ref: 'repos.repo_id' }, { name: 'author_id', type: 'integer', ref: 'engineers.engineer_id' }, { name: 'opened_at', type: 'timestamp' }, { name: 'merged_at', type: 'timestamp', nullable: true }, { name: 'closed_at', type: 'timestamp', nullable: true, note: 'closed without merging' }, { name: 'lines_added', type: 'integer' }, { name: 'lines_deleted', type: 'integer' }, { name: 'review_count', type: 'integer' }], rows: prs },
      { name: 'deployments', description: 'Deployments per environment', columns: [{ name: 'deploy_id', type: 'integer', pk: true }, { name: 'repo_id', type: 'integer', ref: 'repos.repo_id' }, { name: 'environment', type: 'text', note: 'staging | production' }, { name: 'deployed_at', type: 'timestamp' }, { name: 'status', type: 'text', note: 'success | failed | rolled_back' }, { name: 'duration_sec', type: 'integer' }], rows: deploys },
      { name: 'incidents', description: 'Production incidents', columns: [{ name: 'incident_id', type: 'integer', pk: true }, { name: 'repo_id', type: 'integer', ref: 'repos.repo_id' }, { name: 'severity', type: 'text', note: 'SEV1 (worst) … SEV4' }, { name: 'opened_at', type: 'timestamp' }, { name: 'resolved_at', type: 'timestamp', nullable: true }, { name: 'caused_by_deploy_id', type: 'integer', nullable: true, ref: 'deployments.deploy_id' }], rows: incidents },
    ],
  };
}
