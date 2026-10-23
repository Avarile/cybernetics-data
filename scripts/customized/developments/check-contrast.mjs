#!/usr/bin/env node
// Contrast check for the theme tokens (plan step 07, design §8).
// Usage: node scripts/customized/developments/check-contrast.mjs [path/to/global.shadcn.css]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const file =
  process.argv[2] ?? join(here, '../../../packages/ui-lib/src/shadcn/global.shadcn.css');
const css = readFileSync(file, 'utf8');

const block = (selector) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in ${file}`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()])
  );
};

const hslToRgb = (value) => {
  const [h, s, l] = value.split('/')[0].trim().split(/\s+/).map(parseFloat);
  const sat = s / 100;
  const light = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
};
const luminance = ([r, g, b]) =>
  [r, g, b]
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => {
  const [l1, l2] = [luminance(hslToRgb(a)), luminance(hslToRgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

// [foreground token, background token, minimum ratio]
const PAIRS = [
  ['foreground', 'background', 4.5],
  ['foreground', 'background-secondary', 4.5],
  ['foreground', 'accent', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'background-secondary', 4.5],
  ['popover-foreground', 'popover', 4.5],
  ['primary-foreground', 'primary', 3],
  ['primary', 'background', 3],
  ['destructive', 'background', 3],
  // tertiary text is only used next to an icon or a value (design §8)
  ['foreground-tertiary', 'background', 2.5],
];

let failed = 0;
for (const [selector, light] of [[':root', true], ['.dark', false]]) {
  const tokens = { ...(light ? {} : block(':root')), ...block(selector) };
  for (const [fg, bg, min] of PAIRS) {
    const r = ratio(tokens[fg], tokens[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${selector.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)} (min ${min})`);
  }
}
if (failed) {
  console.error(`${failed} pair(s) below the minimum`);
  process.exit(1);
}
