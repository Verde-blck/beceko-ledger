import assert from 'node:assert/strict';
import test from 'node:test';
import { brandCss, loadBrand, manifest, PRODUCT_NAME, renderIndex } from '../src/brand.js';

test('every brand folder in the repo is complete', () => {
  for (const id of ['beceko', 'iwe-oja']) {
    const brand = loadBrand(id);
    assert.ok(brand.appName);
    assert.match(brand.accent, /^#[0-9a-f]{6}$/i);
  }
});

test('the product brand never says it runs on itself, other brands can', () => {
  assert.equal(loadBrand('iwe-oja').poweredBy, '');
  assert.equal(loadBrand('beceko').poweredBy, '');
  assert.equal(PRODUCT_NAME, 'Ìwé Ọjà');
});

test('brand values reach the page, manifest and colours, safely escaped', () => {
  const brand = { ...loadBrand('beceko'), appName: 'Mama <b>& Sons</b>', shortName: 'Mama', poweredBy: 'Ìwé Ọjà' };
  const page = renderIndex('<title>{{APP_NAME}}</title><a>{{APP_NAME}}</a><meta content="{{SHORT_NAME}}"><meta content="{{POWERED_BY}}">', brand);
  assert.equal(page, '<title>Mama &lt;b&gt;&amp; Sons&lt;/b&gt;</title><a>Mama &lt;b&gt;&amp; Sons&lt;/b&gt;</a><meta content="Mama"><meta content="Ìwé Ọjà">');

  const parsed = JSON.parse(manifest(brand));
  assert.equal(parsed.name, 'Mama <b>& Sons</b>');
  assert.equal(parsed.short_name, 'Mama');
  assert.match(brandCss(brand), /--accent: #2348a8;[\s\S]*--accent: #8eaeff;/);
});
