import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PromptShield } from './filters/PromptShield.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const shield = new PromptShield();
const workspaceRoot = path.join(__dirname, '../../'); // Go up to workspace root

async function scanDirectory(dir: string) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    return;
  }

  for (const file of files) {
    const fullPath = path.join(dir, file);
    let stats;
    try {
      stats = fs.statSync(fullPath);
    } catch (e) {
      continue;
    }

    if (stats.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
        await scanDirectory(fullPath);
      }
    } else if (file.endsWith('.md') || file.endsWith('.txt') || file.endsWith('.json')) {
      // Skip stats.json and package.json to avoid self-hits
      if (file === 'stats.json' || file === 'package.json' || file === 'package-lock.json') continue;

      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.length > 50000) continue; // Skip very large files

      const result = await shield.scan(content, 'anonymous', 'guardian-scan');
      
      if ('safe' in result && !result.safe) {
        console.warn(`\x1b[31m[THREAT DETECTED]\x1b[0m File: ${path.relative(workspaceRoot, fullPath)}`);
        console.warn(`Patterns: ${result.matchedPatterns.join(', ')}`);
        console.warn(`Score: ${Math.round(result.score * 100)}%`);
        console.log('---');
      }
    }
  }
}

console.log('\n🛡️  \x1b[36m[GUARDIAN SENTINEL]\x1b[0m Workspace integrity scan initiated...');
console.log(`Root: ${workspaceRoot}\n`);

scanDirectory(workspaceRoot).then(() => {
  console.log('\n✅ \x1b[32m[SCAN COMPLETE]\x1b[0m Matrix integrity verified.');
}).catch(err => {
  console.error('\n❌ Guardian failure:', err);
});
