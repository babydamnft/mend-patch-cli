import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCheck } from './runner.ts';

const MAIN = join(dirname(fileURLToPath(import.meta.url)), 'main.ts');
let passed = 0;
const failures: string[] = [];

const conflict = runCheck({
  id: 'file-directory-conflict',
  argv: [],
  stdin: '{"command":"create","path":"a","file_text":"file"}\n{"command":"create","path":"a/b","file_text":"child"}\n',
  files: {},
});
if (conflict.exit !== 0 && conflict.files.a === undefined && conflict.files['a/b'] === undefined) passed += 1;
else failures.push(`conflict left a partial update: exit ${conflict.exit}, files ${JSON.stringify(Object.keys(conflict.files))}`);

const dryConflict = runCheck({
  id: 'file-directory-conflict-check',
  argv: ['--check'],
  stdin: '{"command":"create","path":"a","file_text":"file"}\n{"command":"create","path":"a/b","file_text":"child"}\n',
  files: {},
});
if (dryConflict.exit !== 0 && dryConflict.files.a === undefined && dryConflict.files['a/b'] === undefined) passed += 1;
else failures.push(`--check conflict left files: exit ${dryConflict.exit}, files ${JSON.stringify(Object.keys(dryConflict.files))}`);

const base = mkdtempSync(join(tmpdir(), 'mend-security-'));
try {
  const outside = join(base, 'outside');
  const root = join(base, 'root');
  const outsideFile = join(outside, 'secret.txt');
  const link = join(root, 'linked');
  const fs = await import('node:fs');
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(root, { recursive: true });
  writeFileSync(outsideFile, 'before\n');
  symlinkSync(outside, link, 'junction');
  const patch = JSON.stringify({ command: 'str_replace', path: 'linked/secret.txt', old_str: 'before', new_str: 'after' });
  const result = spawnSync(process.execPath, [MAIN, '--format=json'], { cwd: root, input: patch, encoding: 'utf8' });
  const after = readFileSync(outsideFile, 'utf8');
  if (result.status === 1 && result.stdout === 'error: unsafe linked/secret.txt\nfailed: 1 of 1 edits\n' && after === 'before\n') passed += 1;
  else failures.push(`junction escaped the tree: exit ${result.status}, stdout ${JSON.stringify(result.stdout)}, outside ${JSON.stringify(after)}`);
} finally {
  rmSync(base, { recursive: true, force: true });
}

process.stdout.write(failures.map((f) => `FAIL ${f}\n`).join(''));
process.stdout.write(`${passed} of 3 filesystem security checks passed\n`);
if (passed !== 3) process.exitCode = 1;
