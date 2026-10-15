#!/usr/bin/env node
// Charge la boutique de démonstration dans une base : rayons, catalogue,
// pages, menus et réglages.
//
//   node client/demo/seed.mjs                         # base locale (npm run dev / preview)
//   node client/demo/seed.mjs --remote --env staging  # base déployée
//
// Rejouable. Le catalogue passe par `shopctl catalog import`, idempotent par
// référence ; les pages sont mises à jour par leur slug ; les deux menus sont
// réécrits en entier, ce qui écrase une navigation retouchée dans
// l'administration. Le contenu vit dans ce dossier : pages/*.md et
// catalog-extras.json.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const envIndex = args.indexOf('--env');
const env = envIndex === -1 ? null : args[envIndex + 1];
if (remote && !env) {
  console.error('--remote exige --env <staging|production>.');
  process.exit(2);
}

const CATEGORIES = [
  ['femme', 'Femme', null],
  ['homme', 'Homme', null],
  ['chaussures', 'Chaussures', null],
  ['accessoires', 'Accessoires', null],
  ['femme-manteaux-vestes', 'Manteaux et vestes', 'femme'],
  ['femme-mailles', 'Pulls et cardigans', 'femme'],
  ['femme-chemises-tops', 'Chemises et tops', 'femme'],
  ['femme-robes-jupes', 'Robes et jupes', 'femme'],
  ['femme-pantalons-jeans', 'Pantalons et jeans', 'femme'],
  ['homme-manteaux-vestes', 'Manteaux et vestes', 'homme'],
  ['homme-mailles', 'Pulls', 'homme'],
  ['homme-chemises-tshirts', 'Chemises et t-shirts', 'homme'],
  ['homme-pantalons-jeans', 'Pantalons et jeans', 'homme'],
  ['chaussures-femme', 'Chaussures femme', 'chaussures'],
  ['chaussures-homme', 'Chaussures homme', 'chaussures'],
  ['sacs', 'Sacs', 'accessoires'],
  ['petite-maroquinerie', 'Petite maroquinerie', 'accessoires'],
  ['echarpes-bonnets', 'Écharpes, foulards et bonnets', 'accessoires'],
  ['lunettes', 'Lunettes de soleil', 'accessoires'],
];

const HEADER_MENU = [
  ['category', 'femme'],
  ['category', 'homme'],
  ['category', 'chaussures'],
  ['category', 'accessoires'],
  ['page', 'lookbook', 'Lookbook'],
];

const FOOTER_MENU = [
  ['category', 'femme'],
  ['category', 'homme'],
  ['category', 'chaussures'],
  ['category', 'accessoires'],
  ['page', 'notre-maison'],
  ['page', 'nos-matieres'],
  ['page', 'lookbook', 'Lookbook'],
  ['page', 'guide-des-tailles'],
  ['page', 'livraison-et-retours'],
  ['page', 'questions-frequentes'],
  ['page', 'contact'],
  ['page', 'conditions-generales-de-vente', 'CGV'],
  ['page', 'mentions-legales'],
  ['page', 'politique-de-confidentialite', 'Confidentialité'],
  ['page', 'droit-de-retractation'],
];

const SETTINGS = {
  store_name: 'Maison Démo',
  time_zone: 'Europe/Paris',
  announcement: 'Livraison offerte dès 150 € et retours gratuits sous 30 jours',
  announcement_href: '/pages/livraison-et-retours',
};

const q = (value) => (value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`);
const publicId = (prefix) => `'${prefix}_' || lower(hex(randomblob(5)))`;

/** Front matter, then Markdown. Only the two keys the pages use. */
function readPage(file) {
  const text = readFileSync(join(HERE, 'pages', file), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${file} : en-tête --- manquant.`);
  const meta = Object.fromEntries(
    match[1].split('\n').map((line) => line.split(/:\s*/, 2)).map(([key, ...rest]) => [key.trim(), rest.join(':').trim()]),
  );
  return { slug: file.replace(/\.md$/, ''), title: meta.title, layout: meta.layout ?? 'standard', body: match[2].trim() };
}

function categoriesSql() {
  return CATEGORIES.map(([slug, name, parent]) =>
    `INSERT INTO categories (name, slug, parent_id, public_id)
  SELECT ${q(name)}, ${q(slug)}, ${parent ? `(SELECT id FROM categories WHERE slug = ${q(parent)})` : 'NULL'}, ${publicId('cat')}
   WHERE NOT EXISTS (SELECT 1 FROM categories WHERE slug = ${q(slug)});
UPDATE categories SET name = ${q(name)}, parent_id = ${parent ? `(SELECT id FROM categories WHERE slug = ${q(parent)})` : 'NULL'} WHERE slug = ${q(slug)};`,
  ).join('\n');
}

function contentSql() {
  const out = [];

  for (const [key, value] of Object.entries(SETTINGS)) {
    out.push(`INSERT INTO settings (key, value) VALUES (${q(key)}, ${q(value)})
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now');`);
  }

  for (const file of readdirSync(join(HERE, 'pages')).filter((f) => f.endsWith('.md')).sort()) {
    const page = readPage(file);
    out.push(`INSERT INTO pages (title, slug, body_markdown, published, layout, public_id)
  VALUES (${q(page.title)}, ${q(page.slug)}, ${q(page.body)}, 1, ${q(page.layout)}, ${publicId('page')})
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, body_markdown = excluded.body_markdown,
    published = 1, layout = excluded.layout, updated_at = datetime('now');`);
  }

  out.push('DELETE FROM menu_items;');
  const menu = (location, items) =>
    items.forEach(([type, slug, label], position) => {
      const table = type === 'category' ? 'categories' : 'pages';
      out.push(`INSERT INTO menu_items (location, target_type, target_id, label, position, public_id)
  SELECT ${q(location)}, ${q(type)}, id, ${q(label ?? null)}, ${position}, ${publicId('nav')} FROM ${table} WHERE slug = ${q(slug)};`);
    });
  menu('header', HEADER_MENU);
  menu('footer', FOOTER_MENU);

  // L'ordre des nouveautés, et le texte alternatif de chaque photographie.
  const extras = JSON.parse(readFileSync(join(HERE, 'catalog-extras.json'), 'utf8'));
  for (const product of extras.products) {
    const id = `(SELECT id FROM products WHERE sku = ${q(product.sku)})`;
    out.push(`UPDATE products SET created_at = datetime('now', '-${Number(product.createdDaysAgo)} days') WHERE sku = ${q(product.sku)};`);
    product.alts.forEach((alt, index) => {
      out.push(`UPDATE product_images SET alt = ${q(alt)}
  WHERE id = (SELECT id FROM product_images WHERE product_id = ${id} ORDER BY position, id LIMIT 1 OFFSET ${index});`);
    });
  }
  return out.join('\n');
}

const target = remote ? ['--remote'] : ['--local'];

// À distance, wrangler.jsonc doit décrire l'environnement visé : c'est
// `shopctl deploy --env <env>` qui le rend ainsi, avec le vrai identifiant de
// la base. Sinon, on écrirait dans une base qui n'est pas celle du site.
if (remote) {
  const config = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');
  if (!config.includes(`-${env}-db`) || config.includes('00000000-0000-0000-0000-000000000000')) {
    console.error(`wrangler.jsonc ne décrit pas l'environnement ${env}.`);
    console.error(`Lancez d'abord : npm run shopctl -- deploy --env ${env}`);
    process.exit(4);
  }
}

function run(command, commandArgs) {
  execFileSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit' });
}

function executeSql(name, sql) {
  const directory = mkdtempSync(join(tmpdir(), 'maison-demo-seed-'));
  const file = join(directory, `${name}.sql`);
  try {
    writeFileSync(file, `${sql}\n`, 'utf8');
    // wrangler répond par un document par instruction : on n'en garde que le compte.
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', ...target, '--file', file, '--yes'], {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    console.log(`✓ ${name} : ${sql.split(/;\n/).length} instruction(s)`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

console.log('▸ Rayons');
executeSql('categories', categoriesSql());

console.log('▸ Catalogue');
run('node', ['shopctl/bin/shopctl.mjs', 'catalog', 'import', 'imports/catalog.csv', ...(remote ? ['--remote', '--env', env] : [])]);

console.log('▸ Pages, menus, réglages');
executeSql('content', contentSql());

console.log('✓ Boutique de démonstration chargée.');
