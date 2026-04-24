import { pool } from '../src/db/pool';

// Forces the shared pool to close so jest doesn't report open handles after
// the last test file finishes.
export default async function globalTeardown(): Promise<void> {
  await pool.end();
}
