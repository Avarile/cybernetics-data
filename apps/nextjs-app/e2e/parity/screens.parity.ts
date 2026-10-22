import path from 'path';
import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import {
  apiContext,
  cellPoint,
  COLUMN_WIDTH,
  gotoFixture,
  headerPoint,
  pointerAt,
  readFixture,
  resetView,
  rowHeadPoint,
} from './fixture';

/**
 * Before / after screenshots for the redesign (plan steps 03 and 26). Runs with E2E_SHOTS=<label>:
 *   E2E_SHOTS=before pnpm exec playwright test -c e2e/parity/parity.config.ts screens
 * Files land in scripts/customized/developments/redesign-baseline/ (git-ignored locally).
 */
const label = process.env.E2E_SHOTS;
test.skip(!label, 'set E2E_SHOTS=<label> to take screenshots');

const OUT = path.join(__dirname, '../../../../scripts/customized/developments/redesign-baseline');

const shot = (page: Page, scheme: string, name: string) =>
  page.screenshot({ path: path.join(OUT, `${label}-fixture-${scheme}-${name}.png`) });

for (const scheme of ['light', 'dark'] as const) {
  test(`screens (${scheme})`, async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const context = await browser.newContext({ colorScheme: scheme });
    const page = await context.newPage();
    const fixture = readFixture();
    const api = await apiContext();
    await resetView(api, fixture);
    const views = await (await api.get(`/api/table/${fixture.tableId}/view`)).json();
    let grouped = views.find((v: { name: string }) => v.name === 'By progress');
    let board = views.find((v: { name: string }) => v.name === 'Board');
    if (!grouped) {
      grouped = await (
        await api.post(`/api/table/${fixture.tableId}/view`, {
          data: {
            type: 'grid',
            name: 'By progress',
            group: [{ fieldId: fixture.fieldIds.progress, order: 'asc' }],
          },
        })
      ).json();
    }
    if (!board) {
      board = await (
        await api.post(`/api/table/${fixture.tableId}/view`, {
          data: {
            type: 'kanban',
            name: 'Board',
            options: { stackFieldId: fixture.fieldIds.progress },
          },
        })
      ).json();
    }

    await gotoFixture(page, fixture);
    await shot(page, scheme, 'grid');
    await pointerAt(page, await headerPoint(page, 1, COLUMN_WIDTH - 14));
    await shot(page, scheme, 'field-menu');
    await page.keyboard.press('Escape');
    await pointerAt(page, await cellPoint(page, 1, 1), 'right');
    await shot(page, scheme, 'record-menu');
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: /^filter/i })
      .first()
      .click();
    await page.waitForTimeout(500);
    await shot(page, scheme, 'filter');
    await page.keyboard.press('Escape');
    await pointerAt(page, await rowHeadPoint(page, 1, 2));
    await page.waitForTimeout(800);
    await shot(page, scheme, 'record-modal');
    await page.keyboard.press('Escape');

    await page.goto(`/base/${fixture.baseId}/table/${fixture.tableId}/${grouped.id}`);
    await page.waitForTimeout(2500);
    await shot(page, scheme, 'grid-grouped');
    await page.goto(`/base/${fixture.baseId}/table/${fixture.tableId}/${board.id}`);
    await page.waitForTimeout(2500);
    await shot(page, scheme, 'kanban');
    await page.goto(`/space/${fixture.spaceId}`);
    await page.waitForTimeout(2500);
    await shot(page, scheme, 'space');
    await context.close();
  });
}
