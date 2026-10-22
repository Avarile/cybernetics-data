import { test } from '@playwright/test';
import { apiContext, gridBox, readFixture } from './fixture';

/**
 * Grid frame-time benchmark (plan steps 04 and 27). Slow, so it only runs with E2E_FPS=1:
 *   E2E_FPS=1 pnpm exec playwright test -c e2e/parity/parity.config.ts fps
 * Adds 10k rows to its own table in the fixture base, scrolls for 10 s and prints p50 / p95.
 */
test.skip(process.env.E2E_FPS !== '1', 'set E2E_FPS=1 to run the frame-time benchmark');

const ROWS = 10_000;
const BATCH = 1_000;

test('grid scroll frame times with 10k rows', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const api = await apiContext();
  const { baseId } = readFixture();
  const table = await (
    await api.post(`/api/base/${baseId}/table/`, {
      data: {
        name: 'fps',
        fields: [
          { name: 'title', type: 'singleLineText' },
          {
            name: 'state',
            type: 'singleSelect',
            options: {
              choices: [
                { name: 'a', color: 'blueBright' },
                { name: 'b', color: 'redDark1' },
              ],
            },
          },
          { name: 'n', type: 'number' },
          { name: 'ok', type: 'checkbox' },
          { name: 'note', type: 'longText' },
        ],
      },
    })
  ).json();
  for (let start = 0; start < ROWS; start += BATCH) {
    await api.post(`/api/table/${table.id}/record`, {
      data: {
        fieldKeyType: 'name',
        records: Array.from({ length: BATCH }, (_, i) => ({
          fields: {
            title: `Row ${start + i}`,
            state: (start + i) % 2 ? 'a' : 'b',
            n: start + i,
            ok: i % 3 === 0,
            note: 'Lorem ipsum dolor sit amet',
          },
        })),
      },
    });
  }

  await page.goto(`/base/${baseId}/table/${table.id}/${table.defaultViewId}`);
  const box = await gridBox(page);
  await page.waitForTimeout(3000);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __run: boolean };
    w.__frames = [];
    w.__run = true;
    let last = performance.now();
    const tick = (now: number) => {
      w.__frames.push(now - last);
      last = now;
      if (w.__run) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const end = Date.now() + 10_000;
  let dir = 1;
  while (Date.now() < end) {
    await page.mouse.wheel(0, 400 * dir);
    await page.waitForTimeout(16);
    if (Math.random() < 0.02) dir = -dir;
  }
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __run: boolean };
    w.__run = false;
    return w.__frames.slice(5);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  console.log(
    `FPS benchmark: ${frames.length} frames, p50 ${pct(0.5).toFixed(1)} ms, p95 ${pct(0.95).toFixed(1)} ms, max ${sorted[sorted.length - 1].toFixed(1)} ms`
  );
});
