import * as fs from 'fs';
import * as path from 'path';
import { SKILL_MD, SKILL_VERSION } from './skill-content.gen';

const {
  readSkillMarkdown,
  readSkillVersion,
  SKILL_PATH,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('../scripts/generate-skill-content.cjs') as {
  readSkillMarkdown: () => string;
  readSkillVersion: () => string;
  SKILL_PATH: string;
};

describe('embedded skill', () => {
  it('committed generated file matches packages/cli/skill/SKILL.md (drift guard)', () => {
    // If this fails, run `npm run gen --workspace=packages/cli` and commit.
    expect(SKILL_MD).toBe(readSkillMarkdown());
  });

  it('the generator reads the package skill, outside the repo .claude/skills/', () => {
    expect(SKILL_PATH).toBe(path.join(__dirname, '..', 'skill', 'SKILL.md'));
    expect(fs.existsSync(SKILL_PATH)).toBe(true);
  });

  it('ships the CLI version alongside the markdown', () => {
    expect(SKILL_VERSION).toBe(readSkillVersion());
  });

  it('embeds a usable skill: frontmatter name plus the commands it teaches', () => {
    expect(SKILL_MD).toContain('name: thinker-cli');
    expect(SKILL_MD).toContain('thinker doctor');
    expect(SKILL_MD).toContain('thinker provider refresh');
  });
});
