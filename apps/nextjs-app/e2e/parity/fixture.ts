import fs from 'fs';
import path from 'path';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, request } from '@playwright/test';

export const FIXTURE_FILE = path.join(__dirname, '../.out/parity/fixture.json');
const BASELINE_DIR = path.join(__dirname, 'baseline');

export interface IParityFixture {
  spaceId: string;
  baseId: string;
  tableId: string;
  viewId: string;
  fieldIds: Record<string, string>;
  recordIds: string[];
}

export const baseURL = () => process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export const apiContext = () =>
  request.newContext({ baseURL: baseURL(), storageState: process.env.E2E_STORAGE_STATE });

export const readFixture = (): IParityFixture => JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8'));

const URGENT = 'urgent';
const BACKLOG = 'backlog';
const IN_PROGRESS = 'in-progress';

export const FIXTURE_RECORDS = [
  { title: 'Define light and dark token sets', progress: 'done', priority: URGENT, estimate: 3 },
  { title: 'Bridge CSS variables into the grid', progress: IN_PROGRESS, priority: URGENT },
  { title: 'Re-skin row head controls', progress: IN_PROGRESS, priority: 'normal', estimate: 2 },
  { title: 'Tag palette with three intensities', progress: BACKLOG, priority: 'normal' },
  { title: 'Statistic row restyle', progress: BACKLOG, priority: 'can wait', estimate: 1 },
  { title: 'Parity suite for every control', progress: BACKLOG, priority: URGENT, done: true },
];

export const createFixture = async (api: APIRequestContext): Promise<IParityFixture> => {
  const spaceId = process.env.E2E_SPACE_ID ?? (await (await api.get('/api/space')).json())[0]?.id;
  if (!spaceId) throw new Error('No space found for the parity fixture');
  const base = await (
    await api.post('/api/base', {
      data: { spaceId, name: `ui-parity ${new Date().toISOString()}` },
    })
  ).json();
  const table = await (
    await api.post(`/api/base/${base.id}/table/`, {
      data: {
        name: 'tasks',
        fields: [
          { name: 'title', type: 'singleLineText' },
          {
            name: 'progress',
            type: 'singleSelect',
            options: {
              choices: [
                { name: BACKLOG, color: 'grayBright' },
                { name: IN_PROGRESS, color: 'blueBright' },
                { name: 'done', color: 'green' },
              ],
            },
          },
          {
            name: 'priority',
            type: 'singleSelect',
            options: {
              choices: [
                { name: URGENT, color: 'redDark1' },
                { name: 'normal', color: 'blue' },
                { name: 'can wait', color: 'greenLight1' },
              ],
            },
          },
          { name: 'done', type: 'checkbox' },
          { name: 'estimate', type: 'number' },
        ],
        records: FIXTURE_RECORDS.map((fields) => ({ fields })),
      },
    })
  ).json();
  if (!table.id) throw new Error(`Fixture table not created: ${JSON.stringify(table)}`);
  return {
    spaceId,
    baseId: base.id,
    tableId: table.id,
    viewId: table.defaultViewId,
    fieldIds: Object.fromEntries(
      table.fields.map((f: { name: string; id: string }) => [f.name, f.id])
    ),
    recordIds: table.records.map((r: { id: string }) => r.id),
  };
};

export const deleteFixture = async (api: APIRequestContext, fixture: IParityFixture) => {
  await api.delete(`/api/base/${fixture.baseId}/permanent`);
};

/** Undo view-level changes a test may leave behind (hidden fields), so tests stay independent. */
export const resetView = async (api: APIRequestContext, fixture: IParityFixture) => {
  await api.put(`/api/table/${fixture.tableId}/view/${fixture.viewId}/column-meta`, {
    data: Object.values(fixture.fieldIds).map((fieldId) => ({
      fieldId,
      columnMeta: { hidden: false },
    })),
  });
};

export const getRecords = async (api: APIRequestContext, fixture: IParityFixture) => {
  const res = await api.get(`/api/table/${fixture.tableId}/record`, {
    params: { viewId: fixture.viewId, fieldKeyType: 'name' },
  });
  return (await res.json()).records as { id: string; fields: Record<string, unknown> }[];
};

/* ---------- the contract: values recorded on the unchanged app, compared afterwards ---------- */

export const contract = (suite: string) => {
  const file = path.join(BASELINE_DIR, `${suite}.json`);
  const updating = process.env.UPDATE_PARITY === '1';
  const recorded: Record<string, unknown> = {};
  const baseline: Record<string, unknown> = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : {};
  return {
    check(name: string, value: unknown) {
      if (updating) {
        recorded[name] = value;
        return;
      }
      expect(name in baseline, `no baseline for "${name}"; run with UPDATE_PARITY=1 first`).toBe(
        true
      );
      expect(value, name).toEqual(baseline[name]);
    },
    save() {
      if (!updating) return;
      fs.mkdirSync(BASELINE_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ ...baseline, ...recorded }, null, 2) + '\n');
    },
  };
};

/* ---------- grid geometry: positions inside the canvas grid (design §7 keeps these fixed) ---------- */

export const ROW_HEAD_WIDTH = 70;
export const HEADER_HEIGHT = 32;
export const ROW_HEIGHT = 32;
export const COLUMN_WIDTH = 150;

export const gridBox = async (page: Page) => {
  // the container div has zero height; the canvas inside it carries the grid's box
  const grid = page.locator('[data-t-grid-container] canvas:visible').first();
  await expect(grid).toBeVisible();
  const box = await grid.boundingBox();
  if (!box) throw new Error('grid has no bounding box');
  return box;
};

/** Centre of a body cell; col 0 is the primary field. */
export const cellPoint = async (page: Page, row: number, col: number) => {
  const box = await gridBox(page);
  return {
    x: box.x + ROW_HEAD_WIDTH + col * COLUMN_WIDTH + COLUMN_WIDTH / 2,
    y: box.y + HEADER_HEIGHT + row * ROW_HEIGHT + ROW_HEIGHT / 2,
  };
};

export const headerPoint = async (page: Page, col: number, offset = COLUMN_WIDTH / 2) => {
  const box = await gridBox(page);
  return { x: box.x + ROW_HEAD_WIDTH + col * COLUMN_WIDTH + offset, y: box.y + HEADER_HEIGHT / 2 };
};

/** Row-head control slots: 0 drag, 1 checkbox, 2 expand (70px split in three). */
export const rowHeadPoint = async (page: Page, row: number, slot: 0 | 1 | 2) => {
  const box = await gridBox(page);
  return {
    x: box.x + (ROW_HEAD_WIDTH / 3) * (slot + 0.5),
    y: box.y + HEADER_HEIGHT + row * ROW_HEIGHT + 8 + 8,
  };
};

/** Visible item labels of the top-most open menu / popover / command list. */
export const openMenuItems = async (page: Page) => {
  const wrapper = page.locator('[data-radix-popper-content-wrapper], [role="dialog"]').last();
  await expect(wrapper).toBeVisible();
  const items = wrapper.locator('[cmdk-item], [role="menuitem"], [role="option"]');
  return await items.evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  );
};

/** The canvas resolves the region under the pointer on mouse-move, so always hover before acting. */
export const pointerAt = async (
  page: Page,
  p: { x: number; y: number },
  action: 'click' | 'dblclick' | 'right' | 'move' = 'click'
) => {
  await page.mouse.move(p.x - 4, p.y - 4);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.waitForTimeout(150);
  if (action === 'move') return;
  if (action === 'dblclick') await page.mouse.dblclick(p.x, p.y);
  else await page.mouse.click(p.x, p.y, action === 'right' ? { button: 'right' } : undefined);
  await page.waitForTimeout(400);
};

export const gotoFixture = async (page: Page, fixture: IParityFixture) => {
  await page.goto(`/base/${fixture.baseId}/table/${fixture.tableId}/${fixture.viewId}`);
  await gridBox(page);
  await page.waitForTimeout(1500);
};
