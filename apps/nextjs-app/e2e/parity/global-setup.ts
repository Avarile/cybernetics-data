import fs from 'fs';
import path from 'path';
import { apiContext, createFixture, FIXTURE_FILE } from './fixture';

export default async function globalSetup() {
  const api = await apiContext();
  const me = await api.get('/api/auth/user/me');
  if (!me.ok()) throw new Error(`Storage state is not signed in (${me.status()})`);
  const fixture = await createFixture(api);
  fs.mkdirSync(path.dirname(FIXTURE_FILE), { recursive: true });
  fs.writeFileSync(FIXTURE_FILE, JSON.stringify(fixture, null, 2));
  await api.dispose();
}
