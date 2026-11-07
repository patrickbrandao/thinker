const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const script = join(__dirname, 'pin-deploy-image.sh');

test('pins every deploy template to the release minor tag', () => {
  const root = mkdtempSync(join(tmpdir(), 'pin-deploy-'));
  try {
    mkdirSync(join(root, 'deploy', 'koyeb'), { recursive: true });
    writeFileSync(join(root, 'Dockerfile.heroku'), 'FROM docker.io/tmsoftbrasil/thinker:0.1\n');
    writeFileSync(
      join(root, 'deploy', 'koyeb', 'TUTORIAL.md'),
      'image=docker.io%2Ftmsoftbrasil%2Fthinker%3A0.1&name=thinker\n' +
        'docker pull tmsoftbrasil/thinker:0.12.3 stays a full version\n',
    );
    execFileSync('bash', [script, '0.32', root]);
    assert.equal(
      readFileSync(join(root, 'Dockerfile.heroku'), 'utf8'),
      'FROM docker.io/tmsoftbrasil/thinker:0.32\n',
    );
    const koyeb = readFileSync(join(root, 'deploy', 'koyeb', 'TUTORIAL.md'), 'utf8');
    assert.match(koyeb, /thinker%3A0\.32&name/);
    assert.match(koyeb, /thinker:0\.12\.3 stays/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects anything but a major.minor tag', () => {
  assert.throws(() => execFileSync('bash', [script, 'latest', tmpdir()], { stdio: 'pipe' }));
});
