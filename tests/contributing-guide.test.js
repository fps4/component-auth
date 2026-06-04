// Spec-derived tests for the contributing-guide feature.
// Each test maps to an acceptance criterion in
// docs/product/specs/contributing-guide.md.
//
// The tests rely only on Node's standard library (node:test, node:fs,
// node:path) so they introduce no new dependencies.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CONTRIBUTING_PATH = path.join(REPO_ROOT, 'CONTRIBUTING.md');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');

function readContributing() {
  return fs.readFileSync(CONTRIBUTING_PATH, 'utf8');
}

// Return the body of a `## <heading>` section, up to the next `## ` or end of file.
function extractSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const startIdx = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`,
  );
  if (startIdx === -1) return null;
  const rest = lines.slice(startIdx + 1);
  const endRel = rest.findIndex((line) => /^##\s+/.test(line));
  const end = endRel === -1 ? rest.length : endRel;
  return rest.slice(0, end).join('\n');
}

function listTopLevelSections(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, '').trim());
}

// -------- AC-1 ---------------------------------------------------------
// WHEN a contributor navigates to the root of fps4/component-auth,
// THE SYSTEM SHALL present a file named CONTRIBUTING.md at that location.
test('AC-1: CONTRIBUTING.md exists at the repository root', () => {
  assert.ok(
    fs.existsSync(CONTRIBUTING_PATH),
    `Expected CONTRIBUTING.md at repo root (${CONTRIBUTING_PATH}) — AC-1 not satisfied`,
  );
  const stat = fs.statSync(CONTRIBUTING_PATH);
  assert.ok(stat.isFile(), 'CONTRIBUTING.md must be a regular file');
});

// -------- AC-2 ---------------------------------------------------------
// Prerequisites section must state Node.js 20 as the required runtime.
test('AC-2: Prerequisites section states Node.js 20', () => {
  const md = readContributing();
  const section = extractSection(md, 'Prerequisites');
  assert.ok(
    section !== null,
    'Missing "## Prerequisites" section — AC-2 not satisfied',
  );
  // Accept "Node.js 20", "Node 20", "Node.js v20", "Node 20.x", etc.
  const mentionsNode20 = /node(?:\.js)?\s*v?20(?:\.[\dx]+)?/i.test(section);
  assert.ok(
    mentionsNode20,
    `Prerequisites section does not state Node.js 20 — AC-2 not satisfied. Section was:\n${section}`,
  );
});

// -------- AC-3 ---------------------------------------------------------
// Build section must list `npm ci` first and `npm run build` second, in that order.
test('AC-3: Build section lists `npm ci` then `npm run build`, in that order', () => {
  const md = readContributing();
  const section = extractSection(md, 'Build');
  assert.ok(section !== null, 'Missing "## Build" section — AC-3 not satisfied');

  const ciIdx = section.indexOf('npm ci');
  const buildIdx = section.indexOf('npm run build');

  assert.notEqual(ciIdx, -1, 'Build section missing `npm ci` — AC-3 not satisfied');
  assert.notEqual(
    buildIdx,
    -1,
    'Build section missing `npm run build` — AC-3 not satisfied',
  );
  assert.ok(
    ciIdx < buildIdx,
    '`npm ci` must appear before `npm run build` in the Build section — AC-3 not satisfied',
  );
});

// -------- AC-4 ---------------------------------------------------------
// Test section must state `npm test` as the test command.
test('AC-4: Test section states `npm test` as the test command', () => {
  const md = readContributing();
  const section = extractSection(md, 'Test');
  assert.ok(section !== null, 'Missing "## Test" section — AC-4 not satisfied');
  assert.ok(
    section.includes('npm test'),
    `Test section does not state \`npm test\` — AC-4 not satisfied. Section was:\n${section}`,
  );
});

// -------- AC-5 ---------------------------------------------------------
// Only Prerequisites, Build, and Test sections at the `##` level
// (a top-level `#` title is allowed by the spec).
test('AC-5: only Prerequisites, Build, and Test sections are present', () => {
  const md = readContributing();
  const sections = listTopLevelSections(md);

  const expected = ['Prerequisites', 'Build', 'Test'];
  const expectedLower = expected.map((s) => s.toLowerCase());
  const actualLower = sections.map((s) => s.toLowerCase());

  // Every expected section must be present.
  for (const s of expectedLower) {
    assert.ok(
      actualLower.includes(s),
      `Missing required section "${s}" — AC-5 not satisfied. Found: ${JSON.stringify(sections)}`,
    );
  }

  // No additional `##` sections are allowed.
  const extras = sections.filter((s) => !expectedLower.includes(s.toLowerCase()));
  assert.deepEqual(
    extras,
    [],
    `Found extra top-level sections beyond Prerequisites/Build/Test: ${JSON.stringify(extras)} — AC-5 not satisfied`,
  );
});

// -------- AC-6 ---------------------------------------------------------
// Accuracy: the build commands documented must correspond to real scripts
// in package.json so a contributor following the guide on Node 20 can build.
// We cannot run `npm ci` and `npm run build` inside the unit-test process,
// but we can prove the guide is not lying: the `build` script must exist.
test('AC-6: Build commands in the guide are backed by package.json scripts', () => {
  assert.ok(
    fs.existsSync(PACKAGE_JSON_PATH),
    'Expected package.json at repo root to verify build script accuracy',
  );
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  const scripts = pkg.scripts || {};
  assert.ok(
    typeof scripts.build === 'string' && scripts.build.trim().length > 0,
    'package.json `scripts.build` is missing — `npm run build` in CONTRIBUTING.md would fail. AC-6 not satisfied',
  );

  // The guide itself must mention both commands.
  const md = readContributing();
  const buildSection = extractSection(md, 'Build');
  assert.ok(buildSection !== null, 'Missing Build section — AC-6 not satisfied');
  assert.ok(
    buildSection.includes('npm ci'),
    'Build section must document `npm ci` — AC-6 not satisfied',
  );
  assert.ok(
    buildSection.includes('npm run build'),
    'Build section must document `npm run build` — AC-6 not satisfied',
  );
});

// -------- AC-7 ---------------------------------------------------------
// Accuracy: the `npm test` command must be backed by a real `test` script
// in package.json. If the script is missing or set to the npm default
// ("Error: no test specified"), the guide is inaccurate.
test('AC-7: `npm test` is backed by a real package.json test script', () => {
  assert.ok(
    fs.existsSync(PACKAGE_JSON_PATH),
    'Expected package.json at repo root to verify test script accuracy',
  );
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  const scripts = pkg.scripts || {};
  const testScript = scripts.test;

  assert.ok(
    typeof testScript === 'string' && testScript.trim().length > 0,
    'package.json `scripts.test` is missing — `npm test` would not run a real suite. AC-7 not satisfied',
  );
  assert.ok(
    !/no test specified/i.test(testScript),
    'package.json `scripts.test` is the npm default placeholder — `npm test` would exit non-zero. AC-7 not satisfied',
  );
});
