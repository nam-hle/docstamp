// SPEC §4
export function isRepoPath(s: string): boolean {
  if (s === '' || s.includes('\u0000') || s.normalize('NFC') !== s) return false;
  return s.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}
