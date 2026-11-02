// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const publicDir = resolve(import.meta.dirname, '../public');
const brand = resolve(publicDir, 'brand');

function pngSize(path: string): [number, number] {
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe('brand assets', () => {
  it('ships a square symbol', () => {
    expect(pngSize(resolve(brand, 'thinker-mark.png'))).toEqual([256, 256]);
  });

  it('ships both logo variants at the same size, 128px tall', () => {
    const light = pngSize(resolve(brand, 'thinker-logo.png'));
    expect(light[1]).toBe(128);
    expect(pngSize(resolve(brand, 'thinker-logo-dark.png'))).toEqual(light);
  });

  it('ships the README copies unchanged from the brand folder', () => {
    for (const name of ['thinker-logo.png', 'thinker-logo-dark.png']) {
      expect(readFileSync(resolve(root, '.github/assets', name))).toEqual(
        readFileSync(resolve(brand, name)),
      );
    }
  });

  it('renders the PNG icons at 32px and 180px', () => {
    expect(pngSize(resolve(brand, 'favicon-32.png'))).toEqual([32, 32]);
    expect(pngSize(resolve(brand, 'apple-touch-icon.png'))).toEqual([180, 180]);
  });

  it('ships the email logo', () => {
    expect(pngSize(resolve(publicDir, 'thinker-logo.png'))[1]).toBe(256);
  });
});
