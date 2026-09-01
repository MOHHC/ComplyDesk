// Downloads all-MiniLM-L6-v2's weights into apps/api/models/ once, at
// install/build time — not at request time. The running app sets
// env.allowRemoteModels = false (see src/ai/claude-ai-provider.service.ts),
// so if this script was never run, embedding calls fail loudly instead
// of silently reaching out to Hugging Face from inside a request.
import { pipeline, env } from '@xenova/transformers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localModelPath = path.join(__dirname, '..', 'models');
env.localModelPath = localModelPath;
env.cacheDir = localModelPath;
env.allowRemoteModels = true; // only this offline script is allowed to fetch

async function main() {
  console.log('Fetching all-MiniLM-L6-v2 weights into apps/api/models ...');
  await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('Done.');
}

main().catch((err) => {
  console.error('Failed to fetch embedding model weights:', err);
  process.exit(1);
});
