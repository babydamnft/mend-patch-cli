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
  {
    id: 'unified-backslash-after-minus-midfile-keeps-final-break',
    argv: [],
    stdin: '--- a/f\n+++ b/f\n@@ -1,3 +1,2 @@\n a\n-b\n\\ No newline at end of file\n c\n',
    files: { 'f': 'a\nb\nc\nd\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'a\nc\nd\n' } },
  },
  {
    id: 'unified-backslash-on-non-eof-hunk-keeps-final-break',
    argv: [],
    stdin: '--- f\n+++ f\n@@ -1 +1 @@\n-a\n+x\n\\ No newline at end of file\n',
    files: { 'f': 'a\nb\nc\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'x\nb\nc\n' } },
  },
  {
    id: 'unified-created-file-honors-no-newline-marker',
    argv: [],
    stdin: 'diff --git a/new b/new\nnew file mode 100644\n--- /dev/null\n+++ b/new\n@@ -0,0 +1,2 @@\n+a\n+b\n\\ No newline at end of file\n',
    files: {},
    expect: { exit: 0, stdout: 'A new\nok: 1 file\n', changes: { 'new': 'a\nb' } },
  },
  {
    id: 'unified-backslash-after-last-context-at-eof-removes-break',
    argv: [],
    stdin: '--- f\n+++ f\n@@ -1,2 +1,2 @@\n a\n b\n\\ No newline at end of file\n',
    files: { 'f': 'a\nb\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'a\nb' } },
  },
  {
    id: 'unified-backslash-after-minus-at-eof-adds-break',
    argv: [],
    stdin: '--- f\n+++ f\n@@ -1,2 +1,1 @@\n a\n-b\n\\ No newline at end of file\n',
    files: { 'f': 'a\nb' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'a\n' } },
  },
  {
    id: 'v4a-cursor-past-anchor-uses-later-occurrence',
    argv: [],
    stdin: '*** Begin Patch\n*** Update File: f\n@@ two\n-three\n+3\n@@\n-one\n+1\n*** End Patch\n',
    files: { 'f': 'one\ntwo\nthree\none\nfour\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'one\ntwo\n3\n1\nfour\n' } },
  },
  {
    id: 'v4a-anchor-promotes-to-tier-two',
    argv: [],
    stdin: '*** Begin Patch\n*** Update File: f\n@@ indented\n-value\n+V\n*** End Patch\n',
    files: { 'f': '  indented\nvalue\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': '  indented\nV\n' } },
  },
  {
    id: 'v4a-eof-chunk-rejects-nonending-match',
    argv: [],
    stdin: '*** Begin Patch\n*** Update File: f\n@@\n-a\n+x\n*** End of File\n*** End Patch\n',
    files: { 'f': 'a\nb\nc\n' },
    expect: { exit: 1, stdout: 'error: no-match f\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    id: 'v4a-empty-old-chunks-use-cursor-then-eof',
    argv: [],
    stdin: '*** Begin Patch\n*** Update File: f\n@@ b\n+a\n@@\n+x\n*** End of File\n*** End Patch\n',
    files: { 'f': 'a\nb\nc\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'a\nb\na\nc\nx\n' } },
  },
  {
    id: 'json-array-rejects-invalid-element-at-array-line',
    argv: [],
    stdin: '[{"command":"create","path":"ok","file_text":"x"},{"nope":1}]',
    files: {},
    expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} },
  },
  {
    id: 'jsonl-rejects-nonobject-line',
    argv: ['--format=json'],
    stdin: '5\n{"command":"create","path":"ok","file_text":"x"}\n',
    files: {},
    expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} },
  },
  {
    id: 'json-ignores-unknown-keys',
    argv: [],
    stdin: '{"command":"str_replace","path":"f","old_str":"a","new_str":"b","priority":9}\n',
    files: { 'f': 'a\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'b\n' } },
  },
  {
    id: 'json-absent-new-str-deletes-match',
    argv: [],
    stdin: '{"command":"str_replace","path":"f","old_str":"x"}\n',
    files: { 'f': 'xab\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'ab\n' } },
  },
  {
    id: 'json-create-is-byte-for-byte-without-final-break',
    argv: [],
    stdin: '{"command":"create","path":"f","file_text":"x"}\n',
    files: {},
    expect: { exit: 0, stdout: 'A f\nok: 1 file\n', changes: { 'f': 'x' } },
  },
  {
    id: 'json-insert-at-line-count-appends',
    argv: [],
    stdin: '{"command":"insert","path":"f","insert_line":2,"new_str":"t"}\n',
    files: { 'f': 'a\nb\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'a\nb\nt\n' } },
  },
  {
    id: 'json-insert-past-line-count-is-no-match',
    argv: [],
    stdin: '{"command":"insert","path":"f","insert_line":3,"new_str":"t"}\n',
    files: { 'f': 'a\nb\n' },
    expect: { exit: 1, stdout: 'error: no-match f\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    id: 'json-insert-trailing-newline-does-not-add-empty-line',
    argv: [],
    stdin: '{"command":"insert","path":"f","insert_line":1,"new_str":"t\\n"}\n',
    files: { 'f': 'a\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'a\nt\n' } },
  },
  {
    id: 'json-crlf-normalizes-crlf-inside-old-str',
    argv: [],
    stdin: '{"command":"str_replace","path":"f","old_str":"a\\r\\nb","new_str":"c"}\n',
    files: { 'f': 'a\r\nb\r\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'c\r\n' } },
  },
  {
    id: 'unified-unsafe-new-path-after-prefix-removal',
    argv: [],
    stdin: '--- a/f\n+++ b/../evil.txt\n@@ -1 +1 @@\n-a\n+b\n',
    files: { 'f': 'a\n' },
    expect: { exit: 1, stdout: 'error: unsafe ../evil.txt\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    id: 'v4a-add-rejects-dot-segment',
    argv: [],
    stdin: '*** Begin Patch\n*** Add File: ./x\n+data\n*** End Patch\n',
    files: {},
    expect: { exit: 1, stdout: 'error: unsafe ./x\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    id: 'json-unsafe-second-edit-prevents-earlier-create',
    argv: [],
    stdin: '{"command":"create","path":"ok","file_text":"x"}\n{"command":"create","path":"../evil","file_text":"x"}\n',
    files: {},
    expect: { exit: 1, stdout: 'error: unsafe ../evil\nfailed: 1 of 2 edits\n', changes: {} },
  },
  {
    id: 'json-failure-then-successes-remains-atomic',
    argv: [],
    stdin: '{"command":"str_replace","path":"f","old_str":"z"}\n{"command":"create","path":"ok","file_text":"x"}\n{"command":"str_replace","path":"f","old_str":"a","new_str":"b"}\n',
    files: { 'f': 'a\n' },
    expect: { exit: 1, stdout: 'error: no-match f\nfailed: 1 of 3 edits\n', changes: {} },
  },
  {
    id: 'json-check-failure-then-successes-remains-atomic',
    argv: ['--check'],
    stdin: '{"command":"str_replace","path":"f","old_str":"z"}\n{"command":"create","path":"ok","file_text":"x"}\n{"command":"str_replace","path":"f","old_str":"a","new_str":"b"}\n',
    files: { 'f': 'a\n' },
    expect: { exit: 1, stdout: 'error: no-match f\nfailed: 1 of 3 edits\n', changes: {} },
  },
  {
    id: 'unified-earlier-rename-does-not-write-when-later-section-fails',
    argv: [],
    stdin: 'diff --git a/x b/y\nrename from x\nrename to y\ndiff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n',
    files: { 'x': 'x\n' },
    expect: { exit: 1, stdout: 'error: missing f\nfailed: 1 of 2 edits\n', changes: {} },
  },
  {
    id: 'mixed-output-sort-includes-add-modify-and-rename',
    argv: [],
    stdin: 'diff --git a/a b/z\nrename from a\nrename to z\ndiff --git a/b b/b\nnew file mode 100644\n--- /dev/null\n+++ b/b\n@@ -0,0 +1 @@\n+B\ndiff --git a/m b/m\n--- a/m\n+++ b/m\n@@ -1 +1 @@\n-old\n+new\n',
    files: { 'a': 'a\n', 'm': 'old\n' },
    expect: { exit: 0, stdout: 'A b\nM m\nR a -> z\nok: 3 files\n', changes: { 'a': null, 'z': 'a\n', 'b': 'B\n', 'm': 'new\n' } },
  },
  {
    id: 'unified-move-with-failing-hunk-changes-nothing',
    argv: [],
    stdin: 'diff --git a/a b/b\nrename from a\nrename to b\n--- a/a\n+++ b/b\n@@ -1 +1 @@\n-nope\n+yes\n',
    files: { 'a': 'a\n' },
    expect: { exit: 1, stdout: 'error: no-match a\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    id: 'unified-rename-onto-existing-is-exists',
    argv: [],
    stdin: 'diff --git a/a b/b\nrename from a\nrename to b\n',
    files: { 'a': 'a\n', 'b': 'b\n' },
    expect: { exit: 1, stdout: 'error: exists b\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    id: 'unified-hunk-before-section-is-parse-error',
    argv: ['--format=unified'],
    stdin: '@@ -1 +1 @@\n-a\n+b\n',
    files: { 'f': 'a\n' },
    expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} },
  },
  {
    id: 'unified-hunk-header-allows-trailing-text',
    argv: [],
    stdin: '--- f\n+++ f\n@@ -1 +1 @@ func f()\n-a\n+b\n',
    files: { 'f': 'a\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'b\n' } },
  },
  {
    id: 'cli-double-dash-allows-option-looking-patch-path',
    argv: ['--', '-weird.patch'],
    stdin: null,
    files: { '-weird.patch': '--- f\n+++ f\n@@ -1 +1 @@\n-a\n+b\n', 'f': 'a\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'b\n' } },
  },
  {
    id: 'cli-double-dash-followed-by-two-positionals-is-usage',
    argv: ['--', '--strict', 'extra'],
    stdin: null,
    files: {},
    expect: { exit: 2, stdout: 'error: usage\n', changes: {} },
  },
  {
    id: 'cli-duplicate-option-wins-over-missing-patch',
    argv: ['--check', '--check', 'missing'],
    stdin: null,
    files: {},
    expect: { exit: 2, stdout: 'error: usage\n', changes: {} },
  },
  {
    id: 'cli-empty-stdin-auto-has-no-format',
    argv: [],
    stdin: '',
    files: {},
    expect: { exit: 2, stdout: 'error: format\n', changes: {} },
  },
  {
    id: 'cli-empty-stdin-forced-json-has-no-edit',
    argv: ['--format=json'],
    stdin: '',
    files: {},
    expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} },
  },
  {
    id: 'search-markers-allow-trailing-whitespace',
    argv: [],
    stdin: 'f\n<<<<<<< SEARCH   \na\n======= \nb\n>>>>>>> REPLACE\t\n',
    files: { 'f': 'a\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { 'f': 'b\n' } },
  },
  {
    id: 'v4a-move-to-same-existing-path-is-exists',
    argv: [],
    stdin: '*** Begin Patch\n*** Update File: f\n*** Move to: f\n*** End Patch\n',
    files: { 'f': 'a\n' },
    expect: { exit: 1, stdout: 'error: exists f\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    id: 'v4a-body-after-eof-cannot-start-chunk-without-marker',
    argv: [],
    stdin: '*** Begin Patch\n*** Update File: f\n@@\n+x\n*** End of File\n+y\n*** End Patch\n',
    files: { 'f': 'a\n' },
    expect: { exit: 2, stdout: 'error: parse 6\n', changes: {} },
  },
  {
    id: 'unified-header-only-section-reports-missing-file',
    argv: [],
    stdin: 'diff --git a/absent.txt b/absent.txt\n',
    files: {},
    expect: { exit: 1, stdout: 'error: missing absent.txt\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    id: 'unified-header-only-section-can-be-noop',
    argv: [],
    stdin: 'diff --git a/f b/f\n',
    files: { 'f': 'a\n' },
    expect: { exit: 0, stdout: 'ok: 0 files\n', changes: {} },
  },
];

for (const path of ['../escape.txt', 'a/./b.txt', 'a//b.txt', 'subdir\\evil.txt']) {
  checks.push({
    id: `json-unsafe-path-${path}`,
    argv: [],
    stdin: JSON.stringify({ command: 'create', path, file_text: 'x' }),
    files: {},
    expect: { exit: 1, stdout: `error: unsafe ${path}\nfailed: 1 of 1 edits\n`, changes: {} },
  });
}

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
