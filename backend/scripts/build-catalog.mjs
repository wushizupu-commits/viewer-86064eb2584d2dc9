import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Only the two explicitly selected source files are read; no source code is imported.
const [dataPath, suppliedArticlesPath] = process.argv.slice(2);
const articlesPath = suppliedArticlesPath || fileURLToPath(new URL('../../assets/report-catalog.json', import.meta.url));
if (!dataPath) {
  console.error('Usage: node scripts/build-catalog.mjs /path/zongpu-data.js [path/report-catalog.json]');
  process.exit(1);
}
const sandbox = Object.create(null);
vm.runInNewContext(fs.readFileSync(dataPath, 'utf8'), sandbox, {
  timeout: 1000, contextCodeGeneration: { strings: false, wasm: false }
});
const pages = [
  ['home.html', '首页'], ['index.html', '世系族谱'], ['biographies.html', '族贤传略'],
  ['image_archive.html', '宗族图志'], ['family_customs.html', '家训礼俗'],
  ['revisions.html', '历代修谱'], ['source_migration.html', '源流迁徙']
].map(([id, title]) => ({ id, title }));
const people = sandbox.DATA.nodes.map(({ id, name }) => ({ id: String(id), name: String(name) }));
const articleData = JSON.parse(fs.readFileSync(articlesPath, 'utf8'));
const articles = (Array.isArray(articleData) ? articleData : articleData.articles).map(({ id, title, page }) => ({ id, title, page }));
if (new Set(people.map(p => p.id)).size !== people.length || people.some(p => !p.id || !p.name)) throw new Error('Invalid people catalog');
if (new Set(articles.map(p => p.id)).size !== articles.length || articles.some(p => !p.id || !p.title || !pages.some(page => page.id === p.page))) throw new Error('Invalid article catalog');
fs.writeFileSync(fileURLToPath(new URL('../src/catalog.json', import.meta.url)), JSON.stringify({ pages, articles, people }, null, 2) + '\n');
console.log(`Catalog: ${pages.length} pages, ${articles.length} articles, ${people.length} people (id/name only).`);
