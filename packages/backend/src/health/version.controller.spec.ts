import { VersionController } from './version.controller';
import { thinkerVersion } from '../common/utils/thinker-version';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('VersionController', () => {
  it('answers the canonical release version as JSON', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../../../thinker/package.json'), 'utf-8'),
    ) as { version: string };
    expect(new VersionController().getVersion()).toEqual({
      version: `thinker-${pkg.version}`,
      name: 'thinker',
    });
  });

  it('returns null when no packages/thinker/package.json is found upward', () => {
    expect(thinkerVersion('/')).toBeNull();
  });
});
