import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCT_NAME = 'Ìwé Ọjà';
export const DEFAULT_BRAND = 'iwe-oja';

const BRANDS_DIR = fileURLToPath(new URL('../brands/', import.meta.url));
const COLOUR = /^#[0-9a-f]{6}$/i;
const REQUIRED_FILES = [
  'icon.svg',
  'favicon.ico',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);

export function loadBrand(id = DEFAULT_BRAND) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`BRAND "${id}" must be a folder name in brands/, such as beceko.`);
  const dir = join(BRANDS_DIR, id);
  const file = join(dir, 'brand.json');
  if (!existsSync(file)) throw new Error(`BRAND "${id}" was not found. Expected brands/${id}/brand.json.`);

  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const problems = [];
  if (!raw.appName) problems.push('appName is missing');
  for (const key of ['accent', 'accentDark']) {
    if (!COLOUR.test(raw[key] ?? '')) problems.push(`${key} must be a colour such as #2348a8`);
  }
  for (const name of REQUIRED_FILES) {
    if (!existsSync(join(dir, name))) problems.push(`${name} is missing`);
  }
  if (problems.length > 0) throw new Error(`Brand "${id}": ${problems.join('; ')}.`);

  return {
    id,
    dir,
    appName: raw.appName,
    shortName: raw.shortName || raw.appName,
    description: raw.description || `${raw.appName}: customers, sales and payments.`,
    accent: raw.accent,
    accentDark: raw.accentDark,
    poweredBy: raw.appName !== PRODUCT_NAME && raw.showPoweredBy !== false ? PRODUCT_NAME : '',
  };
}

export const manifest = (brand) =>
  JSON.stringify(
    {
      id: '/',
      name: brand.appName,
      short_name: brand.shortName,
      description: brand.description,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#fbfcfe',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  );

export const brandCss = (brand) => `:root {
  --accent: ${brand.accent};
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --accent: ${brand.accentDark};
  }
}

:root[data-theme='dark'] {
  --accent: ${brand.accentDark};
}
`;

export const renderIndex = (template, brand) =>
  template
    .replaceAll('{{APP_NAME}}', escapeHtml(brand.appName))
    .replaceAll('{{SHORT_NAME}}', escapeHtml(brand.shortName))
    .replaceAll('{{POWERED_BY}}', escapeHtml(brand.poweredBy));
