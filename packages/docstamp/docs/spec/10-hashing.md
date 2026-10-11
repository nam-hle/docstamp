## 10 Hashing

### 10.1 Binary Content

A byte sequence is *binary* iff its first min(8192, length) bytes contain the byte 0x00.

### 10.2 Normalized Content

`NormalizedContent(path, marked)`, for a RepoPath of the Universe and the Map *marked* of §9.6.3
(empty when no file has an inline block):

1. If the entry is a *link*, return the bytes `link`, 0x00, and the UTF-8 encoding of its target
   String as stored, with every `\` replaced by `/`.
2. Read the file's bytes. If reading fails, raise « `E_UNREADABLE` » with `[[Subject]]` *path*.
3. If the bytes are binary, let *body* be the bytes. Otherwise let *body* be the bytes with every
   pair 0x0D 0x0A replaced by 0x0A.
4. If *path* is in *marked* (§9.6.3), remove from *body* every line whose index is in the
   `[[hashLines]]` recorded for *path*, each with its LF.
5. Return the bytes `file`, 0x00, and *body*.

NOTE: Step 4 is the hash input rule for an inline file: the line holding its `hash` key, and only
it, is not part of its content, so that a Write of file *B* never makes a file *A* that depends on
*B* stale. Everything else of *B* counts: its prose, its other frontmatter and its `dependencies`.
A file that is not in *marked* is hashed exactly as before, and so is an inline file that has no
`hash` line. A file is *marked* only when it is in the Universe and selected by `[[Include]]`; the
same file hashes with its `hash` line when `[[Include]]` does not select it.

NOTE: The only normalization is CR LF to LF in text. There is no normalization of license or
copyright headers, of whitespace, of a final newline, or of formatting, so a change to any of
them is a content change. A lone CR, a byte order mark, UTF-16 text (binary by §10.1) and every
binary file are hashed byte for byte. A link is never followed: its target string is hashed, so a link
to a file outside Root hashes the same on every host.

### 10.3 Hash

A *Hash* is the lowercase hexadecimal encoding of a SHA-256 digest: exactly 64 characters in
`[0-9a-f]`. `FileHash(path)` is the Hash of `? NormalizedContent(path)`.

### 10.4 Dependency Hash

`DependencyHash(resolved, selected, plugins)`, where *resolved* is a List of RepoPaths in path order,
*selected* the Selected Dependencies of the file (§8.7), « » when omitted, and *plugins* the Plugins
of §9.5, « » when omitted, returns the Hash and the warnings of step 3, or raises:

1. Let *problems* be an empty List, *warnings* an empty List and *input* the empty byte sequence.
2. For each *path* of *resolved*: if `FileHash(path)` raises, add its Diagnostics to *problems*;
   otherwise append the UTF-8 encoding of *path*, the byte 0x00, the 64 ASCII bytes of the Hash,
   and the byte 0x0A.
3. After step 2 (once, not per path), let *fragments* be *selected* with their Fragments
   (`Fragments(entry, text)` of §8.7 with *plugins*, *text* being the file read as in §10.2 steps 1
   to 4, after the `file` tag), in path order of `[[Path]]` then path order of
   `CanonicalJson([[Select]])`. If *fragments* is not empty, append to *input*, for each: the bytes
   `select`, 0x00, the UTF-8 encoding of the path, 0x00, of `CanonicalJson(select)`, 0x00, the
   decimal count of the Parts of its Fragment, 0x0A, and for each Part, in order, the 64 ASCII
   bytes of the Hash (§10.3) of the UTF-8 encoding of its `[[Content]]`, and 0x0A. If `Fragments`
   raises, add its Diagnostics, warnings included, to *problems*; otherwise add the warnings it
   returns to *warnings*.
4. If *problems* is not empty, raise *problems*. Otherwise return the Hash of *input* and *warnings*.

NOTE: A file without Selected Dependencies has the input it always had: no Hash changes (§17.4).
The argument *resolved* holds the paths of Patterns only (§12.1 step 5), not `[[Resolved]]` of the
Result; a Selected-only path has no whole-file line.

NOTE: The path is part of the input, so renaming or moving a dependency changes the Dependency Hash
even when its content does not. An empty file contributes the Hash of the bytes `file`, 0x00.

NOTE: The result for files modified while docstamp runs is undefined.
