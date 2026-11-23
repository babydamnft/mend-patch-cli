// main.ts is mend, the CLI SPEC.md specifies, and this is the kit's starting point for it (MIT). It does sections 1 to 4, 9 and 10 of SPEC.md: the command line, the output and
// exit codes, safe paths, format detection, JSON edits and the all-or-nothing write. The other three formats are
// detected and then read as holding no edit, so they answer `error: parse 1`: reading unified diffs (section 6),
// SEARCH/REPLACE blocks (section 7) and V4A patches (section 8), and matching lines at three tiers (section 5), are
// yours to write. Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  readonly moves = new Map<string, string>();
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

type FileLines = { lines: string[]; br: string; finalBreak: boolean };

function fileLines(text: string): FileLines {
  if (text === '') return { lines: [], br: '\n', finalBreak: false };
  const firstLf = text.indexOf('\n');
  const br = firstLf > 0 && text[firstLf - 1] === '\r' ? '\r\n' : '\n';
  const finalBreak = text.endsWith(br);
  const lines = text.split(br);
  if (finalBreak) lines.pop();
  return { lines, br, finalBreak };
}

function joinFile(state: FileLines): string {
  if (state.lines.length === 0) return '';
  return state.lines.join(state.br) + (state.finalBreak ? state.br : '');
}

type UnifiedHunk = { a: number; oldLines: string[]; newLines: string[]; contextAt: number[]; noBreak: boolean };
type UnifiedSection = { oldPath: string; newPath: string; hunks: UnifiedHunk[]; create: boolean; deletion: boolean; hasPair: boolean };

function unifiedPath(raw: string): string {
  let p = raw.split('\t', 1)[0]!.trim();
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
}

function occurrences(lines: string[], oldLines: string[], tier: number): number[] {
  const found: number[] = [];
  if (oldLines.length === 0) return found;
  const normalize = (s: string): string => tier === 0 ? s : tier === 1 ? s.replace(/[ \t]+$/g, '') : s.replace(/^[ \t]+|[ \t]+$/g, '');
  outer: for (let i = 0; i + oldLines.length <= lines.length; i += 1) {
    for (let j = 0; j < oldLines.length; j += 1) if (normalize(lines[i + j]!) !== normalize(oldLines[j]!)) continue outer;
    found.push(i);
  }
  return found;
}

function matchingOccurrences(lines: string[], oldLines: string[], strict = false): { at: number[]; tier: number } {
  for (let tier = 0; tier <= (strict ? 0 : 2); tier += 1) {
    const at = occurrences(lines, oldLines, tier);
    if (at.length > 0) return { at, tier };
  }
  return { at: [], tier: -1 };
}

function unifiedEdits(lines: string[], strict = false): Edit[] {
  const sections: UnifiedSection[] = [];
  let section: UnifiedSection | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const git = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
    if ((line.startsWith('diff --git ') || line === 'diff --git') && git === null) throw new Exit2(`error: parse ${i + 1}`);
    if (git !== null) {
      section = { oldPath: git[1]!, newPath: git[2]!, hunks: [], create: false, deletion: false, hasPair: false };
      sections.push(section);
      continue;
    }
    if (section !== null && section.hunks.length === 0 && line.startsWith('--- ') && !(lines[i + 1] ?? '').startsWith('+++ ')) throw new Exit2(`error: parse ${i + 2}`);
    if (line.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      if (section === null || section.hasPair || section.hunks.length > 0) {
        section = { oldPath: '', newPath: '', hunks: [], create: false, deletion: false, hasPair: false };
        sections.push(section);
      }
      section.oldPath = unifiedPath(line.slice(4));
      section.newPath = unifiedPath(lines[i + 1]!.slice(4));
      section.hasPair = true;
      i += 1;
      continue;
    }
    if (section !== null && line.startsWith('rename from ')) {
      if (!section.hasPair) section.oldPath = line.slice(12).trim();
      continue;
    }
    if (section !== null && line.startsWith('rename to ')) {
      if (!section.hasPair) section.newPath = line.slice(10).trim();
      continue;
    }
    if (section !== null && line.startsWith('new file mode')) {
      section.create = true;
      continue;
    }
    if (section !== null && line.startsWith('deleted file mode')) {
      section.deletion = true;
      continue;
    }
    if (line.startsWith('@@')) {
      const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (head === null || section === null) throw new Exit2(`error: parse ${i + 1}`);
      const hunk: UnifiedHunk = { a: Number(head[1]), oldLines: [], newLines: [], contextAt: [], noBreak: false };
      section.hunks.push(hunk);
      let previous = '';
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!;
        if (next.startsWith('diff --git ') || (next.startsWith('--- ') && (lines[i + 2] ?? '').startsWith('+++ '))) break;
        if (next === '') {
          let j = i + 1;
          while (lines[j] === '') j += 1;
          const after = lines[j];
          const continues = after !== undefined && (after[0] === ' ' || after[0] === '-' || after[0] === '+' || after[0] === '\\');
          if (!continues) break;
          hunk.contextAt.push(hunk.oldLines.length);
          hunk.oldLines.push('');
          hunk.newLines.push('');
          hunk.noBreak = false;
          previous = ' ';
          i += 1;
          continue;
        }
        const prefix = next[0];
        if (prefix !== ' ' && prefix !== '-' && prefix !== '+' && prefix !== '\\') break;
        i += 1;
        if (prefix === '\\') {
          hunk.noBreak = previous === ' ' || previous === '+';
          previous = '\\';
          continue;
        }
        hunk.noBreak = false;
        previous = prefix;
        if (prefix === ' ') {
          hunk.contextAt.push(hunk.oldLines.length);
          hunk.oldLines.push(next.slice(1));
          hunk.newLines.push(next.slice(1));
        } else if (prefix === '-') hunk.oldLines.push(next.slice(1));
        else if (prefix === '+') {
          hunk.newLines.push(next.slice(1));
          hunk.contextAt.push(-1);
        }
      }
    }
  }
  return sections.filter((s) => s.hunks.length > 0 || s.create || s.deletion || s.oldPath !== s.newPath).map((s) => (tree: Tree): void => {
    const creation = s.create || s.oldPath === '/dev/null';
    const deletion = s.deletion || s.newPath === '/dev/null';
    if (creation) {
      if (!safe(s.newPath)) throw new Fail('unsafe', s.newPath);
      if (tree.get(s.newPath) !== null) throw new Fail('exists', s.newPath);
      const created: string[] = [];
      let finalBreak = true;
      for (const hunk of s.hunks) {
        let hasPlus = false;
        for (let j = 0; j < hunk.newLines.length; j += 1) {
          if (hunk.contextAt[j] === -1) {
            created.push(hunk.newLines[j]!);
            hasPlus = true;
          }
        }
        if (hasPlus) finalBreak = !hunk.noBreak;
      }
      tree.now.set(s.newPath, joinFile({ lines: created, br: '\n', finalBreak }));
      return;
    }
    if (deletion) {
      if (!safe(s.oldPath)) throw new Fail('unsafe', s.oldPath);
      if (tree.get(s.oldPath) === null) throw new Fail('missing', s.oldPath);
      tree.now.set(s.oldPath, null);
      return;
    }
    if (!safe(s.oldPath)) throw new Fail('unsafe', s.oldPath);
    if (!safe(s.newPath)) throw new Fail('unsafe', s.newPath);
    const before = tree.get(s.oldPath);
    if (before === null) throw new Fail('missing', s.oldPath);
    if (s.oldPath !== s.newPath && tree.get(s.newPath) !== null) throw new Fail('exists', s.newPath);
    const state = fileLines(before);
    let delta = 0;
    for (const hunk of s.hunks) {
      let at: number;
      let replacement: string[];
      if (hunk.oldLines.length === 0) {
        at = Math.min(hunk.a + delta, state.lines.length);
        replacement = [...hunk.newLines];
      } else {
        const match = matchingOccurrences(state.lines, hunk.oldLines, strict);
        if (match.at.length === 0) throw new Fail('no-match', s.oldPath);
        const target = hunk.a - 1 + delta;
        match.at.sort((x, y) => Math.abs(x - target) - Math.abs(y - target) || x - y);
        at = match.at[0]!;
        replacement = hunk.newLines.map((line, j) => {
          if (hunk.contextAt[j]! >= 0) return state.lines[at + hunk.contextAt[j]!]!;
          if (match.tier !== 2 || line.trim() === '') return line;
          const fileIndent = /^[ \t]*/.exec(state.lines[at] ?? '')![0];
          const patchIndent = /^[ \t]*/.exec(hunk.oldLines[0] ?? '')![0];
          return line.startsWith(patchIndent) ? fileIndent + line.slice(patchIndent.length) : line;
        });
      }
      const touchesEnd = hunk.oldLines.length === 0 ? at === state.lines.length : at + hunk.oldLines.length === state.lines.length;
      state.lines.splice(at, hunk.oldLines.length, ...replacement);
      if (touchesEnd) state.finalBreak = !hunk.noBreak;
      delta += hunk.newLines.length - hunk.oldLines.length;
    }
    const result = joinFile(state);
    if (s.oldPath !== s.newPath) {
      tree.now.set(s.oldPath, null);
      tree.now.set(s.newPath, result);
      tree.moves.set(s.oldPath, s.newPath);
    } else tree.now.set(s.oldPath, result);
  });
}

type V4AChunk = { anchor: string; eof: boolean; oldLines: string[]; newLines: string[]; contextAt: number[] };
type V4ASection = { kind: 'add' | 'delete' | 'update'; path: string; line: number; moveTo: string | null; lines: string[]; chunks: V4AChunk[] };

function v4aEdits(lines: string[], strict = false): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = lines.length - 1;
  while (last >= 0 && blank(lines[last]!)) last -= 1;
  if (last < 0 || lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const sections: V4ASection[] = [];
  for (let i = first + 1; i < last;) {
    if (blank(lines[i]!)) {
      i += 1;
      continue;
    }
    const header = lines[i]!;
    const kind = header.startsWith('*** Add File: ') ? 'add' : header.startsWith('*** Delete File: ') ? 'delete' : header.startsWith('*** Update File: ') ? 'update' : null;
    if (kind === null) throw new Exit2(`error: parse ${i + 1}`);
    const prefix = kind === 'add' ? 14 : kind === 'delete' ? 17 : 17;
    const section: V4ASection = { kind, path: header.slice(prefix).trim(), line: i + 1, moveTo: null, lines: [], chunks: [] };
    const start = ++i;
    while (i < last && !lines[i]!.startsWith('*** Add File: ') && !lines[i]!.startsWith('*** Delete File: ') && !lines[i]!.startsWith('*** Update File: ')) i += 1;
    let end = i;
    while (end > start && blank(lines[end - 1]!)) end -= 1;
    const body = lines.slice(start, end);
    const bodyLine = (k: number): number => start + k + 1;
    if (kind === 'add') {
      for (let k = 0; k < body.length; k += 1) {
        const line = body[k]!;
        if (line === '') section.lines.push('');
        else if (line.startsWith('+')) section.lines.push(line.slice(1));
        else throw new Exit2(`error: parse ${bodyLine(k)}`);
      }
    } else if (kind === 'delete') {
      if (body.length > 0) throw new Exit2(`error: parse ${bodyLine(0)}`);
    } else {
      let k = 0;
      if (body[0]?.startsWith('*** Move to: ')) {
        section.moveTo = body[0]!.slice(13).trim();
        k = 1;
      }
      let chunk: V4AChunk | null = null;
      for (; k < body.length; k += 1) {
        const line = body[k]!;
        if (line.startsWith('@@')) {
          chunk = { anchor: line.slice(2).trim(), eof: false, oldLines: [], newLines: [], contextAt: [] };
          section.chunks.push(chunk);
          continue;
        }
        if (line === '*** End of File') {
          if (chunk === null) {
            if (section.chunks.length === 0 && section.moveTo === null) throw new Exit2(`error: parse ${section.line}`);
            throw new Exit2(`error: parse ${bodyLine(k)}`);
          }
          chunk.eof = true;
          chunk = null;
          continue;
        }
        const prefixChar = line[0];
        if (line !== '' && prefixChar !== ' ' && prefixChar !== '-' && prefixChar !== '+') throw new Exit2(`error: parse ${bodyLine(k)}`);
        if (chunk === null) {
          chunk = { anchor: '', eof: false, oldLines: [], newLines: [], contextAt: [] };
          section.chunks.push(chunk);
        }
        if (line === '' || prefixChar === ' ') {
          chunk.contextAt.push(chunk.oldLines.length);
          chunk.oldLines.push(line === '' ? '' : line.slice(1));
          chunk.newLines.push(line === '' ? '' : line.slice(1));
        } else if (prefixChar === '-') chunk.oldLines.push(line.slice(1));
        else {
          chunk.newLines.push(line.slice(1));
          chunk.contextAt.push(-1);
        }
      }
      if (section.chunks.length === 0 && section.moveTo === null) throw new Exit2(`error: parse ${section.line}`);
    }
    sections.push(section);
  }
  return sections.map((s) => (tree: Tree): void => {
    if (!safe(s.path)) throw new Fail('unsafe', s.path);
    if (s.kind === 'add') {
      if (tree.get(s.path) !== null) throw new Fail('exists', s.path);
      tree.now.set(s.path, joinFile({ lines: [...s.lines], br: '\n', finalBreak: true }));
      return;
    }
    const destination = s.moveTo ?? s.path;
    if (!safe(destination)) throw new Fail('unsafe', destination);
    const before = tree.get(s.path);
    if (before === null) throw new Fail('missing', s.path);
    if (s.kind === 'delete') {
      tree.now.set(s.path, null);
      return;
    }
    if (destination !== s.path && tree.get(destination) !== null) throw new Fail('exists', destination);
    const state = fileLines(before);
    let cursor = 0;
    for (const chunk of s.chunks) {
      if (chunk.anchor !== '') {
        const anchor = matchingOccurrences(state.lines.slice(cursor), [chunk.anchor], strict);
        if (anchor.at.length === 0) throw new Fail('no-match', s.path);
        cursor += anchor.at[0]! + 1;
      }
      let at = chunk.eof && chunk.oldLines.length === 0 ? state.lines.length : cursor;
      let tier = 0;
      if (chunk.oldLines.length > 0) {
        let found = -1;
        for (tier = 0; tier <= (strict ? 0 : 2); tier += 1) {
          const candidates = occurrences(state.lines.slice(cursor), chunk.oldLines, tier);
          const chosen = candidates.find((p) => !chunk.eof || cursor + p + chunk.oldLines.length === state.lines.length);
          if (chosen !== undefined) {
            found = chosen;
            break;
          }
        }
        if (found < 0) throw new Fail('no-match', s.path);
        at = cursor + found;
      }
      const replacement = chunk.newLines.map((line, j) => {
        if (chunk.contextAt[j]! >= 0) return state.lines[at + chunk.contextAt[j]!]!;
        if (tier !== 2 || line.trim() === '') return line;
        const fileIndent = /^[ \t]*/.exec(state.lines[at] ?? '')![0];
        const patchIndent = /^[ \t]*/.exec(chunk.oldLines[0] ?? '')![0];
        return line.startsWith(patchIndent) ? fileIndent + line.slice(patchIndent.length) : line;
      });
      state.lines.splice(at, chunk.oldLines.length, ...replacement);
      cursor = at + replacement.length;
    }
    const result = joinFile(state);
    if (destination !== s.path) {
      tree.now.set(s.path, null);
      tree.now.set(destination, result);
      tree.moves.set(s.path, destination);
    } else tree.now.set(s.path, result);
  });
}

function searchEdits(lines: string[], strict = false): Edit[] {
  const edits: Edit[] = [];
  let previousPath: string | null = null;
  let previousEnd = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.trimEnd() !== '<<<<<<< SEARCH') continue;
    const searchLine = i;
    let path: string | null = null;
    for (let j = i - 1; j > previousEnd; j -= 1) {
      const candidate = lines[j]!.trim();
      if (candidate !== '' && !candidate.startsWith('```')) {
        path = candidate;
        break;
      }
    }
    path ??= previousPath;
    if (path === null) throw new Exit2(`error: parse ${searchLine + 1}`);
    let divider = i + 1;
    while (divider < lines.length && lines[divider]!.trimEnd() !== '=======' && lines[divider]!.trimEnd() !== '>>>>>>> REPLACE') divider += 1;
    if (divider >= lines.length || lines[divider]!.trimEnd() !== '=======') throw new Exit2(`error: parse ${searchLine + 1}`);
    let end = divider + 1;
    while (end < lines.length && lines[end]!.trimEnd() !== '>>>>>>> REPLACE') end += 1;
    if (end >= lines.length) throw new Exit2(`error: parse ${searchLine + 1}`);
    const oldLines = lines.slice(i + 1, divider);
    const newLines = lines.slice(divider + 1, end);
    previousPath = path;
    previousEnd = end;
    i = end;
    edits.push((tree: Tree): void => {
      if (!safe(path)) throw new Fail('unsafe', path);
      const before = tree.get(path);
      if (oldLines.length === 0) {
        if (before !== null) throw new Fail('exists', path);
        tree.now.set(path, joinFile({ lines: [...newLines], br: '\n', finalBreak: true }));
        return;
      }
      if (before === null) throw new Fail('missing', path);
      const state = fileLines(before);
      const match = matchingOccurrences(state.lines, oldLines, strict);
      if (match.at.length === 0) throw new Fail('no-match', path);
      if (match.at.length > 1) throw new Fail('ambiguous', path);
      const at = match.at[0]!;
      const replacement = newLines.map((line) => {
        if (match.tier !== 2 || line.trim() === '') return line;
        const fileIndent = /^[ \t]*/.exec(state.lines[at] ?? '')![0];
        const patchIndent = /^[ \t]*/.exec(oldLines[0] ?? '')![0];
        return line.startsWith(patchIndent) ? fileIndent + line.slice(patchIndent.length) : line;
      });
      state.lines.splice(at, oldLines.length, ...replacement);
      tree.now.set(path, joinFile(state));
    });
  }
  return edits;
}

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    edits = kind === 'json' ? jsonEdits(text, lines) : kind === 'unified' ? unifiedEdits(lines, strict) : kind === 'search-replace' ? searchEdits(lines, strict) : v4aEdits(lines, strict);
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const entries: { path: string; row: string }[] = [];
  const moveOld = new Set<string>();
  const moveNew = new Set<string>();
  for (const [oldPath, newPath] of tree.moves) {
    if (tree.original(oldPath) !== null && tree.get(oldPath) === null && tree.original(newPath) === null && tree.get(newPath) !== null) {
      moveOld.add(oldPath);
      moveNew.add(newPath);
      entries.push({ path: newPath, row: `R ${oldPath} -> ${newPath}` });
    }
  }
  for (const p of tree.now.keys()) {
    if (moveOld.has(p) || moveNew.has(p)) continue;
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    entries.push({ path: p, row: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  if (!check) {
    for (const [p, now] of tree.now) {
      if (tree.original(p) === now) continue;
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }
  const rows = entries.map((e) => e.row);
  return { code: 0, out: [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
