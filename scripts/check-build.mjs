import fs from 'node:fs';
import path from 'node:path';
const required = ['index.html','admin.html','assets/app.js','assets/styles.css','assets/pdf/saffron-walls-catalogue.pdf','netlify/functions/api.mjs','netlify.toml'];
const missing = required.filter(f => !fs.existsSync(path.resolve(f)));
if (missing.length) { console.error('Missing deployment files:', missing.join(', ')); process.exit(1); }
console.log('Saffron Walls Netlify deployment files verified.');
