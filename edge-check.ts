import { runCheck } from './runner.ts';

type Edge = {
  id: string;
  argv: string[];
  stdin: string | null;
  files: Record<string, string>;
  expect: { exit: number; stdout: string; changes: Record<string, string | null> };
};

const checks: Edge[] = [
  {
    id: 'unified-rejects-malformed-git-header-before-valid-section',
    argv: [],
    stdin: 'diff --git broken\ndiff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n',
    files: { 'x': 'a\n' },
    expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} },
  },
  {
    id: 'unified-rejects-unpaired-old-path-at-following-line',
    argv: [],
    stdin: 'diff --git a/x b/x\n--- a/x\nindex 1\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n',
    files: { 'x': 'a\n' },
    expect: { exit: 2, stdout: 'error: parse 3\n', changes: {} },
  },
  {
    id: 'v4a-checks-destination-safety-before-old-file-existence',
    argv: [],
    stdin: '*** Begin Patch\n*** Update File: missing.txt\n*** Move to: ../escape\n@@\n-a\n+b\n*** End Patch\n',
    files: {},
    expect: { exit: 1, stdout: 'error: unsafe ../escape\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    id: 'v4a-missing-end-patch-reports-one-past-last-line',
    argv: [],
    stdin: '*** Begin Patch\n*** Add File: x\n+ok\n',
    files: {},
    expect: { exit: 2, stdout: 'error: parse 4\n', changes: {} },
  },
  {
    id: 'v4a-failed-later-edit-prevents-all-writes',
    argv: [],
    stdin: '*** Begin Patch\n*** Add File: new.txt\n+ok\n*** Update File: missing.txt\n@@\n-a\n+b\n*** End Patch\n',
    files: {},
    expect: { exit: 1, stdout: 'error: missing missing.txt\nfailed: 1 of 2 edits\n', changes: {} },
  },
  {
    id: 'v4a-eof-skips-non-ending-exact-match-for-ending-tier-one-match',
    argv: [],
    stdin: '*** Begin Patch\n*** Update File: f\n@@\n-a\n+b\n*** End of File\n*** End Patch\n',
    files: { 'f': 'a\nx\na  \n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'a\nx\nb\n' } },
  },
  {
    id: 'search-inherits-path-when-next-block-has-no-path-line',
    argv: [],
    stdin: 'f\n<<<<<<< SEARCH\na\n=======\nA\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nb\n=======\nB\n>>>>>>> REPLACE\n',
    files: { 'f': 'a\nb\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'A\nB\n' } },
  },
  {
    id: 'v4a-strict-applies-to-anchor-matching',
    argv: ['--strict'],
    stdin: '*** Begin Patch\n*** Update File: f\n@@ anchor  \n-a\n+b\n*** End Patch\n',
    files: { 'f': 'anchor  \na\n' },
    expect: { exit: 1, stdout: 'error: no-match f\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    id: 'v4a-eof-without-chunk-reports-update-line',
    argv: [],
    stdin: '*** Begin Patch\n*** Update File: f\n*** End of File\n*** End Patch\n',
    files: { 'f': 'a\n' },
    expect: { exit: 2, stdout: 'error: parse 2\n', changes: {} },
  },
  {
    id: 'unified-pure-rename-without-hunks',
    argv: [],
    stdin: 'diff --git a/old b/new\nrename from old\nrename to new\n',
    files: { 'old': 'same\n' },
    expect: { exit: 0, stdout: 'R old -> new\nok: 1 file\n', changes: { 'old': null, 'new': 'same\n' } },
  },
  {
    id: 'unified-deletion-does-not-apply-hunks',
    argv: [],
    stdin: 'diff --git a/f b/f\ndeleted file mode 100644\n--- a/f\n+++ /dev/null\n@@ -1 +0,0 @@\n-not-present\n',
    files: { 'f': 'a\n' },
    expect: { exit: 0, stdout: 'D f\nok: 1 file\n', changes: { 'f': null } },
  },
  {
    id: 'search-first-block-without-path-reports-search-line',
    argv: [],
    stdin: '\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n',
    files: { 'f': 'a\n' },
    expect: { exit: 2, stdout: 'error: parse 2\n', changes: {} },
  },
  {
    id: 'json-overlapping-matches-are-ambiguous',
    argv: [],
    stdin: '[{"command":"str_replace","path":"f","old_str":"aa","new_str":"b"}]',
    files: { 'f': 'aaaa' },
    expect: { exit: 1, stdout: 'error: ambiguous f\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    id: 'json-insert-into-empty-file-keeps-no-final-break',
    argv: [],
    stdin: '[{"command":"insert","path":"f","insert_line":0,"new_str":"x"}]',
    files: { 'f': '' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'x' } },
  },
  {
    id: 'unified-equal-distance-takes-earlier-occurrence',
    argv: [],
    stdin: '--- f\n+++ f\n@@ -2 +2 @@\n-x\n+y\n',
    files: { 'f': 'x\nq\nx\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'y\nq\nx\n' } },
  },
  {
    id: 'unified-empty-old-insert-clamps-to-end',
    argv: [],
    stdin: '--- f\n+++ f\n@@ -99,0 +100,1 @@\n+x\n',
    files: { 'f': 'a\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'a\nx\n' } },
  },
  {
    id: 'unified-empty-old-insert-at-end-honors-no-newline-marker',
    argv: [],
    stdin: '--- f\n+++ f\n@@ -99,0 +100,1 @@\n+x\n\\ No newline at end of file\n',
    files: { 'f': 'a\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'a\nx' } },
  },
  {
    id: 'v4a-empty-chunk-inserts-after-anchor-cursor',
    argv: [],
    stdin: '*** Begin Patch\n*** Update File: f\n@@ anchor\n+x\n*** End Patch\n',
    files: { 'f': 'anchor\na\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'anchor\nx\na\n' } },
  },
  {
    id: 'search-unique-tier-zero-wins-over-extra-tier-one-match',
    argv: [],
    stdin: 'f\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n',
    files: { 'f': 'a\na  \n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'b\na  \n' } },
  },
  {
    id: 'v4a-add-empty-file',
    argv: [],
    stdin: '*** Begin Patch\n*** Add File: empty\n*** End Patch\n',
    files: {},
    expect: { exit: 0, stdout: 'A empty\nok: 1 file\n', changes: { 'empty': '' } },
  },
  {
    id: 'json-byte-identical-edit-is-noop',
    argv: [],
    stdin: '[{"command":"str_replace","path":"f","old_str":"a","new_str":"a"}]',
    files: { 'f': 'a\n' },
    expect: { exit: 0, stdout: 'ok: 0 files\n', changes: {} },
  },
];

let passed = 0;
for (const c of checks) {
  const want: Record<string, string> = { ...c.files };
  for (const [p, v] of Object.entries(c.expect.changes)) {
    if (v === null) delete want[p];
    else want[p] = v;
  }
  const got = runCheck(c);
  const why: string[] = [];
  if (got.exit !== c.expect.exit) why.push(`exit ${got.exit}, expected ${c.expect.exit}`);
  if (got.stdout !== c.expect.stdout) why.push(`stdout ${JSON.stringify(got.stdout)}, expected ${JSON.stringify(c.expect.stdout)}`);
  for (const p of new Set([...Object.keys(want), ...Object.keys(got.files)])) {
    if (want[p] === undefined) why.push(`${p} should not exist`);
    else if (got.files[p] === undefined) why.push(`${p} is missing`);
    else if (got.files[p] !== want[p]) why.push(`${p} differs: expected ${JSON.stringify(want[p])}, got ${JSON.stringify(got.files[p])}`);
  }
  if (why.length === 0) passed += 1;
  else process.stdout.write(`FAIL ${c.id}\n  ${why.join('\n  ')}\n`);
}
process.stdout.write(`${passed} of ${checks.length} edge checks passed\n`);
if (passed !== checks.length) process.exitCode = 1;
