// Genera las capturas del README en docs/img/ con Playwright.
//
// Uso:
//   npm run build && npx vite preview --port 4173 &
//   npm run capturas
//
// Usa el navegador del sistema (Edge por defecto; CANAL=chrome para Chrome),
// así no hace falta descargar un Chromium aparte.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.URL_BASE ?? 'http://localhost:4173/simulador-circuitos/';
const OUT = 'docs/img';
mkdirSync(OUT, { recursive: true });

const shots = [
  { name: 'dc-wheatstone', hash: '#ejemplo=wheatstone', theme: 'light' },
  { name: 'transitorio-rlc', hash: '#ejemplo=rlc-escalon', theme: 'dark' },
  { name: 'alterna-bode', hash: '#ejemplo=filtro-rc', theme: 'light', scroll: 880 },
  { name: 'alterna-fasores', hash: '#ejemplo=rlc-resonante', theme: 'dark', scroll: 300 },
  { name: 'campos-electrostatica', hash: '#campos=electro', theme: 'light' },
  { name: 'campos-solenoide', hash: '#campos=magneto', theme: 'dark', click: 'Solenoide' },
  { name: 'campos-induccion', hash: '#campos=induccion', theme: 'light', wait: 2600 },
  { name: 'galeria', hash: '#ejemplo=divisor', theme: 'dark', click: 'Ejemplos' },
  { name: 'movil', hash: '#ejemplo=carga-capacitor', theme: 'light', width: 390, height: 844 },
];

const browser = await chromium.launch({ channel: process.env.CANAL ?? 'msedge' });
for (const s of shots) {
  const page = await browser.newPage({
    viewport: { width: s.width ?? 1360, height: s.height ?? 860 },
    deviceScaleFactor: 1,
  });
  await page.addInitScript((theme) => {
    try {
      localStorage.setItem('nodal:tema', theme);
    } catch {
      /* sin almacenamiento */
    }
  }, s.theme);
  await page.goto(BASE + s.hash);
  await page.waitForTimeout(800);
  if (s.click) {
    await page.getByText(s.click, { exact: true }).first().click();
    await page.waitForTimeout(600);
  }
  if (s.scroll) {
    await page
      .locator('.panel-body')
      .first()
      .evaluate((el, y) => el.scrollTo(0, y), s.scroll);
    await page.waitForTimeout(400);
  }
  if (s.wait) await page.waitForTimeout(s.wait);
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
  console.log('✓', s.name);
  await page.close();
}
await browser.close();
