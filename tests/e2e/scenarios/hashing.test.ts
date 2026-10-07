import { expect } from 'vitest';
import { scenario, type Repo } from '../harness/index.ts';

const fixture = 'crlf-and-license';

async function expectVerdict(repo: Repo, label: string, exit: number): Promise<void> {
  const result = await repo.run([], { label, snapshot: false });
  expect(result.exit, label).toBe(exit);
}

const toCrlf = (text: string): string => text.replaceAll('\n', '\r\n');

scenario('§10.2 CRLF and LF text hash the same', { fixture }, async (repo) => {
  await repo.run(['update', '--all'], { expectExit: 0 });
  const verdict = (label: string, exit: number) => expectVerdict(repo, label, exit);

  repo.write('src/text.txt', toCrlf(repo.read('src/text.txt')));
  await verdict('LF converted to CRLF', 0);

  repo.write('src/text.txt', 'line one\r\nline two\n');
  await verdict('mixed CRLF and LF', 0);

  repo.write('src/licensed.ts', toCrlf(repo.read('src/licensed.ts')));
  await verdict('CRLF in a source file', 0);

  const result = await repo.run([], { label: 'CRLF checkout of every dependency' });
  expect(result).toMatchObject({ exit: 0, stdout: '1 ok, 0 stale, 0 invalid\n' });
});

scenario('§10.2 only CR LF pairs are normalized', { fixture }, async (repo) => {
  await repo.run(['update', '--all'], { expectExit: 0 });
  const verdict = (label: string, exit: number) => expectVerdict(repo, label, exit);
  const original = repo.read('src/text.txt');

  repo.write('src/text.txt', original.replaceAll('\n', '\r'));
  await verdict('lone CR is content', 1);
  repo.write('src/text.txt', original);
  await verdict('restored', 0);

  repo.write('src/text.txt', `﻿${original}`);
  await verdict('a byte order mark is content', 1);
  repo.write('src/text.txt', original);

  repo.write('src/text.txt', original.trimEnd());
  await verdict('a missing final newline is content', 1);
  repo.write('src/text.txt', original);

  repo.write('src/text.txt', original.replace('one', 'ONE'));
  await verdict('a changed character', 1);
  repo.write('src/text.txt', original);
  await verdict('back to the recorded content', 0);
});

scenario(
  '§10.2 a changed license header is a content change, not normalized away',
  { fixture },
  async (repo) => {
    await repo.run(['update', '--all'], { expectExit: 0 });
    const licensed = repo.read('src/licensed.ts');
    repo.write('src/licensed.ts', licensed.replace('2026', '2027'));
    const result = await repo.run([], { label: 'only the copyright year changed' });
    expect(result.exit).toBe(1);
    expect(result.stdout).toContain('DOC.md  (content-changed)');

    repo.write('src/licensed.ts', licensed.slice(licensed.indexOf('export')));
    expect((await repo.run([], { label: 'header removed' })).exit).toBe(1);
  },
);

scenario('§10.1 binary content is hashed byte for byte', { fixture }, async (repo) => {
  const binary = (separator: string) => Buffer.from(`a\0b${separator}c\0`, 'latin1');
  repo.write('src/blob.bin', binary('\r\n'));
  await repo.run(['update', '--all'], { expectExit: 0 });
  const verdict = (label: string, exit: number) => expectVerdict(repo, label, exit);

  repo.write('src/blob.bin', binary('\n'));
  await verdict('CRLF to LF inside a file with a NUL byte', 1);
  repo.write('src/blob.bin', binary('\r\n'));
  await verdict('restored', 0);

  const utf16 = (text: string) => Buffer.from(text, 'utf16le');
  repo.write('src/wide.txt', utf16('one\r\ntwo\r\n'));
  await repo.run(['update', '--all'], { expectExit: 0 });
  repo.write('src/wide.txt', utf16('one\ntwo\n'));
  await verdict('UTF-16 text is binary, so CRLF counts', 1);
});

scenario(
  '§10.1 a NUL byte after the first 8192 bytes does not make a file binary',
  { fixture },
  async (repo) => {
    const body = (separator: string) =>
      Buffer.concat([Buffer.alloc(8192, 'a'), Buffer.from(`\0x${separator}y${separator}`)]);
    repo.write('src/late-nul.txt', body('\r\n'));
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.write('src/late-nul.txt', body('\n'));
    await expectVerdict(repo, 'NUL at offset 8192 is past the sniffed prefix', 0);

    const early = (separator: string) =>
      Buffer.concat([Buffer.alloc(8191, 'a'), Buffer.from(`\0x${separator}y${separator}`)]);
    repo.write('src/early-nul.txt', early('\r\n'));
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.write('src/early-nul.txt', early('\n'));
    await expectVerdict(repo, 'NUL at offset 8191 makes the file binary', 1);
  },
);

scenario(
  '§10.2 a symbolic link hashes its target string and is never followed',
  { fixture },
  async (repo) => {
    repo.write('real/one.txt', 'one\n');
    repo.write('real/two.txt', 'two\n');
    repo.symlink('src/link.txt', '../real/one.txt');
    await repo.run(['update', '--all'], { expectExit: 0 });
    const verdict = (label: string, exit: number) => expectVerdict(repo, label, exit);

    repo.append('real/one.txt', 'edited behind the link\n');
    await verdict('the link target file changed', 0);

    repo.remove('real/one.txt');
    await verdict('the link target file is gone (dangling link)', 0);

    repo.remove('src/link.txt');
    repo.symlink('src/link.txt', '../real/two.txt');
    await verdict('the link now points elsewhere', 1);

    repo.remove('src/link.txt');
    repo.symlink('src/link.txt', '../real/one.txt');
    await verdict('the link points back', 0);

    repo.remove('src/link.txt');
    repo.write('src/link.txt', '../real/one.txt');
    await verdict('a regular file with the same text is not a link', 1);
    await repo.run([], { label: 'link replaced by a regular file' });
  },
);

scenario('§10.4 empty files and file order do not hide a change', { fixture }, async (repo) => {
  repo.write('src/empty.txt', '');
  await repo.run(['update', '--all'], { expectExit: 0 });
  repo.write('src/empty.txt', 'x');
  await expectVerdict(repo, 'an empty file gained a byte', 1);
  await repo.run(['update', '--all'], { expectExit: 0 });
  repo.remove('src/empty.txt');
  await expectVerdict(repo, 'an empty file was deleted', 1);
});
