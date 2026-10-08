// The JSON Schema (schema/schedule-1.0.schema.json) and the website's
// validator must agree on every fixture:
// - valid fixtures and the shipped examples: both accept;
// - structural-* fixtures: both reject (and the validator reports the
//   expected paths);
// - semantic-* fixtures: the schema accepts them (they are only invalid
//   under the § 13 [V] rules) and the validator rejects them.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { parseScheduleText } from '../../src/lib/validate';

const ROOT = join(__dirname, '..', '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const TODAY = '2026-10-07';

const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'schedule-1.0.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const schemaValidate = ajv.compile(schema);

interface FixtureMeta {
  kind?: 'valid' | 'structural' | 'semantic';
  rule?: string;
  description?: string;
  expectedErrorPaths?: string[];
  expectedWarningPaths?: string[];
}

interface Fixture {
  file: string;
  text: string;
  data: unknown;
  meta: FixtureMeta;
}

function load(dir: string): Fixture[] {
  return readdirSync(join(FIXTURES, dir))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const text = readFileSync(join(FIXTURES, dir, file), 'utf8');
      const data = JSON.parse(text) as unknown;
      const meta =
        data && typeof data === 'object' && !Array.isArray(data) && 'x-fixture' in data
          ? ((data as Record<string, unknown>)['x-fixture'] as FixtureMeta)
          : {};
      return { file: `${dir}/${file}`, text, data, meta };
    });
}

const valid = load('valid');
const invalid = load('invalid');
const examples: Fixture[] = readdirSync(join(ROOT, 'examples'))
  .filter((f) => f.endsWith('.json'))
  .map((file) => {
    const text = readFileSync(join(ROOT, 'examples', file), 'utf8');
    return { file: `examples/${file}`, text, data: JSON.parse(text) as unknown, meta: {} };
  });

function schemaErrors(data: unknown): string {
  return (schemaValidate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join('; ') || String(data);
}

describe('fixture set', () => {
  it('has enough focused fixtures of each kind', () => {
    expect(valid.length).toBeGreaterThanOrEqual(10);
    expect(invalid.filter((f) => f.file.includes('/structural-')).length).toBeGreaterThanOrEqual(25);
    expect(invalid.filter((f) => f.file.includes('/semantic-')).length).toBeGreaterThanOrEqual(25);
  });

  it('names every invalid fixture structural-* or semantic-*, matching its x-fixture kind', () => {
    for (const f of invalid) {
      const kind = f.file.includes('/structural-') ? 'structural' : f.file.includes('/semantic-') ? 'semantic' : 'unnamed';
      expect(kind, f.file).not.toBe('unnamed');
      if (f.meta.kind) expect(f.meta.kind, f.file).toBe(kind);
    }
  });
});

describe.each([...examples, ...valid])('valid: $file', (fixture) => {
  it('is accepted by the JSON Schema', () => {
    expect(schemaValidate(fixture.data), schemaErrors(fixture.data)).toBe(true);
  });

  it('is accepted by validateDocument', () => {
    const result = parseScheduleText(fixture.text, { today: TODAY });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    for (const path of fixture.meta.expectedWarningPaths ?? []) {
      expect(result.warnings.map((w) => w.path), `warning at ${path}`).toContain(path);
    }
  });
});

describe.each(invalid)('invalid: $file', (fixture) => {
  const structural = fixture.file.includes('/structural-');

  it('is rejected by validateDocument at the expected paths', () => {
    const result = parseScheduleText(fixture.text, { today: TODAY });
    expect(result.ok).toBe(false);
    expect(result.doc).toBeUndefined();
    const paths = result.errors.map((e) => e.path);
    for (const path of fixture.meta.expectedErrorPaths ?? ['']) {
      expect(paths, `${fixture.meta.description ?? ''} → ${JSON.stringify(result.errors)}`).toContain(path);
    }
    for (const error of result.errors) expect(error.message.length).toBeGreaterThan(10);
  });

  if (structural) {
    it('is rejected by the JSON Schema too', () => {
      expect(schemaValidate(fixture.data)).toBe(false);
    });
  } else {
    it('is accepted by the JSON Schema (only a § 13 semantic rule is broken)', () => {
      expect(schemaValidate(fixture.data), schemaErrors(fixture.data)).toBe(true);
    });
  }
});
