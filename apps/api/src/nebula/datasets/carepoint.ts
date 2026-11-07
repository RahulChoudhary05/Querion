import type { Cell, Dataset } from '@querion/engine';
import { CITIES, day, makeRand, round2, ts, uniqueNames } from './lib';

/** Outpatient hospital network: departments, doctors, patients, appointments and prescriptions. */
export function carepoint(): Dataset {
  const r = makeRand(1337);
  const deptDefs: [string, number][] = [['Cardiology', 3], ['Orthopedics', 4], ['Pediatrics', 2], ['Dermatology', 1], ['Neurology', 3], ['General Medicine', 1]];
  const departments: Cell[][] = deptDefs.map(([n, f], i) => [i + 1, n, f]);

  const docNames = uniqueNames(r, 22);
  const doctors: Cell[][] = docNames.map((n, i) => {
    const dept = (i % deptDefs.length) + 1;
    return [i + 1, `Dr. ${n}`, dept, r.int(2, 30), 600 + deptDefs[dept - 1][1] * 250 + r.int(0, 6) * 50];
  });

  const patNames = uniqueNames(r, 180);
  const patients: Cell[][] = patNames.map((n, i) => [
    i + 1,
    n,
    day('1950-01-01', r.int(0, 26000)),
    r.weighted([['F', 51], ['M', 48], ['X', 1]]),
    r.pick(CITIES),
    r.weighted([['private', 5], ['public', 4], ['none', 2]]),
    day('2024-01-01', r.int(0, 800)),
  ]);

  const appointments: Cell[][] = [];
  for (let i = 1; i <= 620; i++) {
    const patient = r.int(1, patients.length);
    const doc = r.int(1, doctors.length);
    const date = day('2026-01-05', r.int(0, 150));
    const status = r.weighted([['completed', 80], ['no_show', 9], ['cancelled', 11]]);
    const fee = status === 'completed' ? (doctors[doc - 1][4] as number) : 0;
    appointments.push([i, patient, doc, ts(date, r.int(9 * 4, 18 * 4) * 15), status, fee, status === 'completed' ? r.weighted([[null, 6], [r.int(1, 5), 4]] as [number | null, number][]) : null]);
  }

  const meds: [string, number[]][] = [
    ['Atorvastatin', [10, 20, 40]], ['Metformin', [500, 850, 1000]], ['Amoxicillin', [250, 500]], ['Paracetamol', [500, 650]],
    ['Ibuprofen', [200, 400]], ['Cetirizine', [10]], ['Amlodipine', [5, 10]], ['Levetiracetam', [250, 500]], ['Azithromycin', [250, 500]], ['Pantoprazole', [40]],
  ];
  const prescriptions: Cell[][] = [];
  for (const a of appointments) {
    if (a[4] !== 'completed') continue;
    const n = r.weighted([[0, 3], [1, 5], [2, 3], [3, 1]]);
    for (let k = 0; k < n; k++) {
      const [m, doses] = r.pick(meds);
      prescriptions.push([prescriptions.length + 1, a[0], m, r.pick(doses), r.pick([3, 5, 7, 10, 14, 30, 90]), round2(r.int(20, 900) + r.f())]);
    }
  }

  return {
    key: 'carepoint',
    name: 'CarePoint Health',
    domain: 'health',
    tagline: 'Outpatient clinics — doctors, patients, appointments, no-shows and prescriptions.',
    description:
      'Five months of outpatient appointments across six departments. Fees are only charged for completed visits. satisfaction is a 1–5 rating given after some completed visits (NULL otherwise). Patients are synthetic; no real health data is used.',
    source: { kind: 'synthetic', license: 'CC0' },
    version: '2026.11.1',
    tables: [
      { name: 'departments', description: 'Clinical departments', columns: [{ name: 'department_id', type: 'integer', pk: true }, { name: 'name', type: 'text' }, { name: 'floor', type: 'integer' }], rows: departments },
      { name: 'doctors', description: 'Consulting doctors', columns: [{ name: 'doctor_id', type: 'integer', pk: true }, { name: 'full_name', type: 'text' }, { name: 'department_id', type: 'integer', ref: 'departments.department_id' }, { name: 'years_experience', type: 'integer' }, { name: 'consultation_fee', type: 'integer' }], rows: doctors },
      { name: 'patients', description: 'Registered patients', columns: [{ name: 'patient_id', type: 'integer', pk: true }, { name: 'full_name', type: 'text' }, { name: 'birth_date', type: 'date' }, { name: 'sex', type: 'text' }, { name: 'city', type: 'text' }, { name: 'insurance', type: 'text', note: 'private | public | none' }, { name: 'registered_on', type: 'date' }], rows: patients },
      { name: 'appointments', description: 'Appointments', columns: [{ name: 'appointment_id', type: 'integer', pk: true }, { name: 'patient_id', type: 'integer', ref: 'patients.patient_id' }, { name: 'doctor_id', type: 'integer', ref: 'doctors.doctor_id' }, { name: 'scheduled_at', type: 'timestamp' }, { name: 'status', type: 'text', note: 'completed | no_show | cancelled' }, { name: 'fee_charged', type: 'integer' }, { name: 'satisfaction', type: 'integer', nullable: true, note: '1–5' }], rows: appointments },
      { name: 'prescriptions', description: 'Medicines prescribed at a completed appointment', columns: [{ name: 'prescription_id', type: 'integer', pk: true }, { name: 'appointment_id', type: 'integer', ref: 'appointments.appointment_id' }, { name: 'medication', type: 'text' }, { name: 'dose_mg', type: 'integer' }, { name: 'days', type: 'integer' }, { name: 'price', type: 'numeric(8,2)' }], rows: prescriptions },
    ],
  };
}
