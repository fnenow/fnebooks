const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const directories = ['', 'routes', 'services', 'scripts', 'public'];
const files = [];

for (const directory of directories) {
  const full = path.join(root, directory);
  if (!fs.existsSync(full)) continue;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.join(full, entry.name));
  }
}

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

const categoryMaster = JSON.parse(fs.readFileSync(path.join(root, 'data', 'category_master.json'), 'utf8'));
const accountSeed = JSON.parse(fs.readFileSync(path.join(root, 'data', 'chart_accounts_seed.json'), 'utf8'));
if (categoryMaster.length !== 69) throw new Error(`Expected 69 categories, found ${categoryMaster.length}`);
if (accountSeed.length !== 69) throw new Error(`Expected 69 seeded accounts, found ${accountSeed.length}`);

console.log(`Syntax checked ${files.length} JavaScript files; verified 69 categories and 69 seeded accounts.`);
