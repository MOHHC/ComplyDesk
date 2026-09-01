// Downloads all-MiniLM-L6-v2's weights into apps/api/models/ once, at
// install/build time — not at request time. The running app sets
// env.allowRemoteModels = false (see src/ai/claude-ai-provider.service.ts),
// so if this script was never run, embedding calls fail loudly instead
// of silently reaching out to Hugging Face from inside a request.
import { pipeline, env } from '@xenova/transformers';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localModelPath = path.join(__dirname, '..', 'models');
const cacheDir = path.join(path.dirname(path.dirname(__dirname)), 'node_modules', '@xenova', 'transformers', '.cache');

env.allowRemoteModels = true; // only this offline script is allowed to fetch

async function main() {
  console.log('Fetching all-MiniLM-L6-v2 weights into apps/api/models ...');

  // Download the model (cached to node_modules/.cache by @xenova/transformers)
  await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  // Copy from cache to the target location
  const sourcePath = path.join(cacheDir, 'Xenova');

  if (fs.existsSync(sourcePath)) {
    // Create target directory structure if it doesn't exist
    if (!fs.existsSync(localModelPath)) {
      fs.mkdirSync(localModelPath, { recursive: true });
    }

    // Copy Xenova directory with all model files
    const targetPath = path.join(localModelPath, 'Xenova');
    if (!fs.existsSync(targetPath)) {
      fs.cpSync(sourcePath, targetPath, { recursive: true });
    }
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('Failed to fetch embedding model weights:', err);
  process.exit(1);
});
