const fs = require('fs');
const path = require('path');

const root = __dirname;
const publishDir = path.join(root, 'dist');
const functionsDir = path.join(root, 'netlify-functions');

fs.rmSync(publishDir, { recursive: true, force: true });
fs.rmSync(functionsDir, { recursive: true, force: true });
fs.mkdirSync(publishDir, { recursive: true });
fs.mkdirSync(functionsDir, { recursive: true });

for (const file of ['index.html', '404.html', 'styles.css', 'flpr-data.json']) {
  fs.copyFileSync(path.join(root, file), path.join(publishDir, file));
}

fs.copyFileSync(
  path.join(root, 'import-americano.js'),
  path.join(functionsDir, 'import-americano.js')
);

console.log('FLPR build completed: dist/ and netlify-functions/ generated.');
