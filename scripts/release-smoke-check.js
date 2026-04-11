const fs = require('fs');
const path = require('path');

const root = process.cwd();

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(root, relPath), 'utf8'));
}

const failures = [];
const warnings = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function warn(condition, message) {
  if (!condition) warnings.push(message);
}

check(exists('electron/main.ts'), 'Missing Electron main entry: electron/main.ts');
check(exists('electron/preload.ts'), 'Missing Electron preload entry: electron/preload.ts');
check(exists('src/App.tsx'), 'Missing renderer app entry: src/App.tsx');
check(exists('src/pages/Login.tsx'), 'Missing login page: src/pages/Login.tsx');
check(exists('src/pages/POS.tsx'), 'Missing POS page: src/pages/POS.tsx');
check(exists('src/pages/Sales.tsx'), 'Missing Sales History page: src/pages/Sales.tsx');
check(exists('src/pages/Settings.tsx'), 'Missing Settings page: src/pages/Settings.tsx');
check(exists('src/services/print.service.ts'), 'Missing print service: src/services/print.service.ts');
check(exists('prisma/schema.prisma'), 'Missing Prisma schema: prisma/schema.prisma');
check(exists('build/icon.ico'), 'Missing Windows app icon: build/icon.ico');
check(exists('build/installer.nsh'), 'Missing NSIS include file: build/installer.nsh');

const pkg = readJson('package.json');
check(pkg?.main === 'dist-electron/main.js', 'package.json main must point to dist-electron/main.js');
check(pkg?.build?.appId, 'Missing electron-builder appId');
check(pkg?.build?.productName, 'Missing electron-builder productName');
check(Array.isArray(pkg?.build?.files) && pkg.build.files.length > 0, 'electron-builder files list is missing');
check(Array.isArray(pkg?.build?.extraResources) && pkg.build.extraResources.length > 0, 'electron-builder extraResources list is missing');

warn(exists('dist/index.html'), 'Renderer build output does not exist yet. Run npm run build before packaging.');
warn(exists('dist-electron/main.js'), 'Electron build output does not exist yet. Run npm run build before packaging.');
warn(exists('prisma/pos.db'), 'Bundled database file prisma/pos.db is missing.');

if (failures.length > 0) {
  console.error('Release smoke check failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  if (warnings.length > 0) {
    console.error('\nWarnings:');
    for (const warning of warnings) {
      console.error(`- ${warning}`);
    }
  }
  process.exit(1);
}

console.log('Release smoke check passed.');

if (warnings.length > 0) {
  console.log('\nWarnings:');
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}
