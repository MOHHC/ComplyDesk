import path from 'node:path';

export type EmbeddingPipeline = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array }>;

let cachedPipeline: EmbeddingPipeline | null = null;

// @xenova/transformers ships ESM-only ("type": "module", no CJS build).
// This project compiles to CommonJS, and a plain top-level `import`
// (or a TS-downleveled dynamic `import()`) gets compiled to `require()`,
// which cannot parse the package's `export`/`import` syntax. Routing
// through the Function constructor hides the import() call from TS's
// CommonJS downleveling, so it survives as a genuine native dynamic
// import at runtime — which Node can use to load an ESM package from a
// CommonJS module. This also means nothing here runs (and nothing about
// the model is touched) unless getLocalEmbeddingPipeline() is actually
// called, which the spec for embedWithPipeline never does.
const importXenova = new Function('return import("@xenova/transformers")') as () => Promise<
  typeof import('@xenova/transformers')
>;

export async function getLocalEmbeddingPipeline(): Promise<EmbeddingPipeline> {
  if (!cachedPipeline) {
    const { env, pipeline } = await importXenova();

    // No runtime network fetch: only Task 2's build-time script is
    // allowed to reach Hugging Face. If the weights are missing here,
    // this should fail loudly rather than silently phoning home from
    // inside a request.
    env.allowRemoteModels = false;
    env.localModelPath = path.join(__dirname, '..', '..', 'models');

    cachedPipeline = (await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
    )) as unknown as EmbeddingPipeline;
  }
  return cachedPipeline;
}

export async function embedWithPipeline(fn: EmbeddingPipeline, text: string): Promise<number[]> {
  const output = await fn(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}
