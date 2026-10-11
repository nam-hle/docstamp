## 11 Lockfile

### 11.1 Reading

`ReadLock(root)` returns a Lock or raises:

1. If an entry named `docsync.lock` exists at Root, whatever its content, raise
   « `E_LOCK_VERSION` » with `[[Subject]]` `docsync.lock`. Its message names the fix: delete
   `docsync.lock`, review every file, then run `docstamp update --all`.
2. If `docstamp-lock.yaml` does not exist at Root, return a Lock with no entries.
3. Parse it under §9.2. On failure, or if the document is not a mapping, raise « `E_LOCK` ». Every
   « `E_LOCK` » and « `E_LOCK_VERSION` » of steps 3 to 5, and one for a Lockfile that cannot be read,
   carries `[[Subject]]` `docstamp-lock.yaml`, so the file is named without a path.
4. If the key `version` is absent, or its value is not the plain scalar `4`, raise
   « `E_LOCK_VERSION` ». For a version 2 or 3 Lockfile its message names the migration: review
   every file, then run `docstamp update --all` to rewrite it as version 4.

5. Raise « `E_LOCK` » unless all of these hold:
   1. The document's keys are exactly `version` and `files`.
   2. `files` is a mapping whose keys are RepoPaths and whose values are each a String of 64
      characters in `[0-9a-f]`.
6. Return the Lock.

NOTE: Unresolved merge conflict markers fail step 3. The message for `E_LOCK` names the fix:
resolve the conflict by taking either side, then run `docstamp`.

NOTE: The version 4 Lockfile has the form of version 3 and the same Hash algorithm (§10.4). It
differs in the selection: an ignore rule is matched against the NFC form of an entry name, and a
space after an escaped backslash is trimmed (§7.2 step 3.4, §7.3 step 2), so the Universe, and
with it a selected file list, may differ from version 3, and a String of `dependencies` with an
unescaped `:` is a Shorthand (§8.7), no longer a Pattern, so its selection differs too. A version 2 Lockfile differs from version 3
only in the name of its top-level key, `dependents` instead of `files`. An inline `hash:` line is
not refused: a doc whose selection changed reports stale; review it and run `docstamp update <file>`.

NOTE: `docsync.lock` is the name of the version 1 Lockfile, written before the tool was renamed
docstamp; the old name is kept on purpose. It also recorded the patterns.
Step 1 refuses it so that stale records are never silently dropped. Nothing deletes it
automatically (§13.6): the error persists until the file is deleted.

### 11.2 Canonical Form

`LockText(lock)` is this text, with LF line endings and a final LF:

```
version: 4
files:
  <Quote(file)>: <hash>
```

- Keys always appear in this order: `version`, `files`.
- One line per entry, in path order of the file. With no entries, the second line is
  `files: {}`.
- Indentation is two spaces.

NOTE: Two branches that write the same file conflict on its `hash` line, as two branches that
change one dependency conflict in a package-manager lockfile. Resolution: take either side, run
`docstamp`, review what it reports stale, and write again.

### 11.3 Writing

`WriteLock(root, lock)`:

1. Let *text* be `LockText(lock)`.
2. If `docstamp-lock.yaml` exists and its contents, with every 0x0D 0x0A replaced by 0x0A, equal the
   UTF-8 encoding of *text*, return without writing.
3. Replace `docstamp-lock.yaml` atomically with the UTF-8 encoding of *text*: a concurrent reader sees
   either the old contents or the new. If this fails, for example because Root is not writable,
   raise « `E_UNREADABLE` » with `[[Subject]]` `docstamp-lock.yaml`, leaving the old contents.

NOTE: Step 2 tolerates a checkout that converted the Lockfile to CR LF. Repositories SHOULD
declare `docstamp-lock.yaml text eol=lf` in `.gitattributes`.
