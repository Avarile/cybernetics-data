import fs from 'fs';
import { apiContext, deleteFixture, FIXTURE_FILE, readFixture } from './fixture';

export default async function globalTeardown() {
  if (!fs.existsSync(FIXTURE_FILE)) return;
  const api = await apiContext();
  await deleteFixture(api, readFixture());
  fs.rmSync(FIXTURE_FILE);
  await api.dispose();
}
