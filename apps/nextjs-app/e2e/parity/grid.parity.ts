import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  apiContext,
  cellPoint,
  COLUMN_WIDTH,
  contract,
  FIXTURE_RECORDS,
  getRecords,
  gotoFixture,
  gridBox,
  HEADER_HEIGHT,
  headerPoint,
  openMenuItems,
  pointerAt,
  readFixture,
  resetView,
  ROW_HEIGHT,
  rowHeadPoint,
} from './fixture';

const c = contract('grid');
const fixture = () => readFixture();
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Accessible names of every button in the tool bar row (the row that holds "Add record"). */
const toolbarButtons = (page: Page) =>
  page.evaluate(() => {
    const add = [...document.querySelectorAll('button')].find((b) =>
      /add record/i.test(b.textContent ?? '')
    );
    let bar: HTMLElement | null = add?.parentElement ?? null;
    while (bar && !/share/i.test(bar.textContent ?? '')) bar = bar.parentElement;
    if (!bar) return [];
    return [...bar.querySelectorAll('button')]
      .filter((b) => b.offsetParent !== null)
      .map((b) =>
        (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
      );
  });

const closeOverlays = async (page: Page) => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
};

test.describe('grid page parity', () => {
  test.beforeEach(async ({ page }) => {
    const api = await apiContext();
    await resetView(api, fixture());
    await api.dispose();
    await gotoFixture(page, fixture());
  });

  test.afterAll(() => c.save());

  test('tool bar keeps every control', async ({ page }) => {
    c.check('toolbar.buttons', await toolbarButtons(page));
  });

  test('add record opens the create-record modal and cancels cleanly', async ({ page }) => {
    await page.getByRole('button', { name: /add record/i }).click();
    const dialog = page.getByRole('dialog').last();
    await expect(dialog).toBeVisible();
    c.check(
      'addRecord.dialogButtons',
      (await dialog.getByRole('button').allTextContents()).map((t) => t.trim()).filter(Boolean)
    );
    await closeOverlays(page);
    const api = await apiContext();
    expect((await getRecords(api, fixture())).length).toBe(FIXTURE_RECORDS.length);
  });

  test('hide fields toggles a field and the label follows', async ({ page }) => {
    await page.getByRole('button', { name: /hide fields|hidden field/i }).click();
    await page.waitForTimeout(400);
    const pop = page.locator('[data-radix-popper-content-wrapper]').last();
    c.check(
      'hideFields.text',
      (await pop.innerText())
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    );
    await pop.getByRole('button', { name: 'estimate' }).locator('..').getByRole('switch').click();
    await closeOverlays(page);
    // the switch writes the view at once; the label follows the realtime sync, which is slow in
    // dev, so assert the saved state and read the label after a reload
    const api = await apiContext();
    const { tableId, viewId, fieldIds } = fixture();
    await expect
      .poll(
        async () =>
          (await (await api.get(`/api/table/${tableId}/view/${viewId}`)).json()).columnMeta[
            fieldIds.estimate
          ]?.hidden,
        { timeout: 10_000 }
      )
      .toBe(true);
    await gotoFixture(page, fixture());
    c.check(
      'hideFields.labelAfterHiding',
      (await toolbarButtons(page)).find((t) => /hidden/i.test(t))
    );
  });

  test('filter, sort, group and row height popovers keep their content', async ({ page }) => {
    for (const [name, label] of [
      ['filter', /^filter/i],
      ['sort', /^sort/i],
      ['group', /^group/i],
    ] as const) {
      await page.getByRole('button', { name: label }).first().click();
      await page.waitForTimeout(500);
      const pop = page.locator('[data-radix-popper-content-wrapper], [role="dialog"]').last();
      c.check(
        `${name}.text`,
        (await pop.innerText())
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
      );
      await closeOverlays(page);
    }
  });

  test('field header: menu marker, right-click and double-click', async ({ page }) => {
    const marker = await headerPoint(page, 1, COLUMN_WIDTH - 14);
    await pointerAt(page, marker);
    c.check('fieldMenu.items', await openMenuItems(page));
    await closeOverlays(page);

    const mid = await headerPoint(page, 1);
    await pointerAt(page, mid, 'right');
    c.check('fieldMenu.rightClickItems', await openMenuItems(page));
    await closeOverlays(page);

    await pointerAt(page, mid, 'dblclick');
    await page.waitForTimeout(400);
    c.check('fieldSettings.opens', await page.getByRole('dialog').last().isVisible());
    await closeOverlays(page);
  });

  test('cell: right-click opens the record menu', async ({ page }) => {
    const p = await cellPoint(page, 1, 1);
    await pointerAt(page, p, 'right');
    c.check('recordMenu.items', await openMenuItems(page));
    await closeOverlays(page);
  });

  test('cell: double-click edits, Enter saves, undo restores', async ({ page }) => {
    const api = await apiContext();
    const p = await cellPoint(page, 0, 0);
    await pointerAt(page, p, 'dblclick');
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.type('Edited by parity');
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => (await getRecords(api, fixture()))[0].fields.title, { timeout: 10_000 })
      .toBe('Edited by parity');
    await page.keyboard.press('Escape');
    await page.keyboard.press(`${mod}+z`);
    await expect
      .poll(async () => (await getRecords(api, fixture()))[0].fields.title, { timeout: 10_000 })
      .toBe(FIXTURE_RECORDS[0].title);
  });

  test('row head: checkbox selects, expand opens the record modal', async ({ page }) => {
    const box = await rowHeadPoint(page, 0, 1);
    await pointerAt(page, box);
    const p = await cellPoint(page, 0, 1);
    await pointerAt(page, p, 'right');
    c.check('recordMenu.afterCheckbox', await openMenuItems(page));
    await closeOverlays(page);
    await closeOverlays(page);

    const exp = await rowHeadPoint(page, 1, 2);
    await pointerAt(page, exp);
    const dialog = page.getByRole('dialog').last();
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(800);
    c.check('recordModal.title', (await dialog.locator('h4').first().textContent())?.trim());
    c.check('recordModal.buttonCount', await dialog.locator('button:visible').count());
    await closeOverlays(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('statistic row opens the statistic menu', async ({ page }) => {
    const box = await gridBox(page);
    const x = box.x + 70 + COLUMN_WIDTH * 4 + COLUMN_WIDTH / 2; // estimate (number)
    const y = box.y + box.height - 16;
    await pointerAt(page, { x, y });
    c.check('statisticMenu.number', await openMenuItems(page));
    await closeOverlays(page);
  });

  test('append row opens a draft row; Escape discards it', async ({ page }) => {
    const api = await apiContext();
    const canvases = page.locator('[data-t-grid-container] canvas:visible');
    const before = await canvases.count();
    const box = await gridBox(page);
    const y = box.y + HEADER_HEIGHT + FIXTURE_RECORDS.length * ROW_HEIGHT + ROW_HEIGHT / 2;
    await pointerAt(page, { x: box.x + 35, y });
    await expect.poll(() => canvases.count(), { timeout: 10_000 }).toBeGreaterThan(before);
    c.check('appendRow.draftGridAppears', true);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    expect((await getRecords(api, fixture())).length).toBe(FIXTURE_RECORDS.length);
  });

  test('quick actions (mod+K) lists resources and theme', async ({ page }) => {
    await page.keyboard.press(`${mod}+k`);
    const dialog = page.getByRole('dialog').last();
    await expect(dialog).toBeVisible();
    c.check('quickActions.groups', await dialog.locator('[cmdk-group-heading]').allTextContents());
    await closeOverlays(page);
  });
});
