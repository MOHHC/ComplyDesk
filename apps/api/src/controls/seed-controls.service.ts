import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ControlSeed {
  code: string;
  category: string;
  title: string;
  description: string;
  evidence_guidance: string;
  refresh_interval_days: number;
}

const MAX_ANCESTOR_HOPS = 8;

/**
 * Loads the canonical seed control set from seeds/controls.json at the
 * repo root and caches it for the process lifetime — every signup reads
 * the same 18 controls, so there's no reason to hit the filesystem per
 * request.
 *
 * The file lives outside apps/api (it's shared scaffolding, not app
 * source), and its path relative to __dirname differs between ts-node
 * dev (src/controls/...) and the compiled build (Nest's outDir mirrors
 * src with no extra "src" segment, so dist/controls/...) — a hardcoded
 * relative path would need a different depth in each. Walking up from
 * __dirname looking for seeds/controls.json avoids hardcoding either
 * depth and keeps working if the build layout ever changes.
 */
@Injectable()
export class SeedControlsService implements OnModuleInit {
  private readonly logger = new Logger(SeedControlsService.name);
  private controls: ControlSeed[] = [];

  onModuleInit(): void {
    const path = this.findSeedFile(__dirname);
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    this.validate(raw, path);
    this.controls = raw;
    this.logger.log(`Loaded ${this.controls.length} seed controls from ${path}`);
  }

  getControls(): ControlSeed[] {
    return this.controls;
  }

  private findSeedFile(startDir: string): string {
    let dir = startDir;
    for (let i = 0; i < MAX_ANCESTOR_HOPS; i++) {
      const candidate = join(dir, 'seeds', 'controls.json');
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(
      `Could not locate seeds/controls.json by walking up from ${startDir} ` +
        `(checked ${MAX_ANCESTOR_HOPS} ancestor directories)`,
    );
  }

  private validate(raw: unknown, path: string): asserts raw is ControlSeed[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error(`${path} did not contain a non-empty array of controls`);
    }
    const requiredFields = [
      'code',
      'category',
      'title',
      'description',
      'evidence_guidance',
      'refresh_interval_days',
    ];
    for (const [index, entry] of raw.entries()) {
      for (const field of requiredFields) {
        if (entry?.[field] === undefined) {
          throw new Error(`${path}: entry ${index} is missing required field "${field}"`);
        }
      }
    }
    const codes = new Set(raw.map((c: ControlSeed) => c.code));
    if (codes.size !== raw.length) {
      throw new Error(`${path}: duplicate control codes found`);
    }
  }
}
