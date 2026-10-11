## 7 Universe

The *Universe* is the List, in path order, of RepoPaths of the files that may be dependencies.

### 7.1 Entries

An *entry* is something a directory listing returns. Its kind is one of: *directory*, *file*
(regular file), *link* (symbolic link, of any target), or *other* (socket, FIFO, device).

Symbolic links are never followed: a link is an entry of kind *link*, whatever its target.

### 7.2 Walk

`ComputeUniverse(root, config)`:

1. Let *errors* be an empty List. Let *rules* be an empty List of ignore rules.
2. Call `WalkDirectory(root, "")`, defined as follows for a directory *d* with RepoPath prefix
   *p*:
   1. If `config.[[UseGitignore]]` is true and *d* contains an entry `.gitignore` of kind *file*,
      append its rules (§7.3) to *rules*, scoped to *p*. If it cannot be read, collect
      `E_UNREADABLE` with `[[Subject]]` its RepoPath.
   2. If *d* cannot be listed, collect `E_UNREADABLE` with `[[Subject]]` *p* and return.
   3. For each entry *e* of *d*, with name *n* and RepoPath *q* (*p* joined with *n*):
      1. If *n* is not valid UTF-8, collect `E_PATH_ENCODING` with `[[Subject]]` the parent RepoPath
         and continue.
      2. If *n* is `.git`, of any kind, skip *e*.
      3. If *e* is *other*, skip *e*.
      4. If `IsIgnored(q, kind of e, rules, config)` (§7.3), skip *e*; *q* is then an *ignored entry*.
         *q* and every rule scope are taken in NFC here (§7.4), so a Glob, which is in NFC (§8.1),
         matches an entry whatever form the file system stores its name in.
      5. If *e* is a *directory*: if it contains an entry named `.git`, skip *e* (a nested
         repository); otherwise call `WalkDirectory(e, q)`.
      6. If *e* is a *file* or *link*, add *q* to the Universe.
   4. Remove the rules scoped to *p* from *rules* before returning.
3. Remove from the Universe the entries of Root named by a Configuration file name of §9.1, and
   the entry `docstamp-lock.yaml` of Root.
4. Apply §7.4 and §7.5, collecting their Diagnostics.
5. If *errors* is not empty, raise it. Otherwise return the Universe in path order.

NOTE: Step 3 means a Write can never make any file stale. It removes only those entries of Root
itself. A file of the same name below Root, such as `sub/docstamp.yaml` or
`sub/docstamp-lock.yaml`, is an ordinary file: it is in the Universe, may be a dependency, and
is hashed like any other.

NOTE: Files tracked by git but matched by an ignore rule are not in the Universe. `core.excludesFile`
and `.git/info/exclude` are never read; they are per-machine and would break §2. A file git ignores
only through them is in the Universe.

### 7.3 Ignore Rules

An ignore rule file is read as UTF-8; a leading U+FEFF is removed; each line has a trailing U+000D
removed. Each line then becomes at most one rule:

1. A line that is empty or starts with `#` is no rule. `\#` at the start means a literal `#`.
2. Trailing U+0020 characters are removed unless escaped with `\`. A U+0020 is escaped when an odd
   number of consecutive `\` precede it, so `a\\ ` is the Glob `a\\` and `a\ ` keeps its space.
3. A leading `!` makes the rule *negated*; `\!` at the start means a literal `!`.
4. A trailing `/` makes the rule match directories only; it is then removed.
5. If the remaining text contains `/`, the rule is *anchored* to its scope; a leading `/` is then
   removed. Otherwise it matches an entry of that name at any depth below its scope.
6. The remaining text is a Glob (§8.1) without Alternation.

`IsIgnored(q, kind, rules, config)`:

1. Let *result* be false.
2. For each rule *r* of *rules*, in the order added, then each line of `config.[[Ignore]]` as a
   rule scoped to Root: if *r* matches *q* and (*r* is not directory-only or *kind* is
   *directory*), set *result* to true if *r* is not negated, else false.
3. Return *result*.

A rule scoped to *p* matches *q* if *q* is below *p* and either the rule is anchored and its Glob
matches *q* relative to *p*, or it is not anchored and its Glob matches the last segment of *q*.

NOTE: Because the walk does not enter an ignored directory, a negated rule cannot re-include a
file inside it. This is gitignore behavior.

### 7.4 Normalization

Each RepoPath produced by the walk is converted to NFC. The implementation keeps the on-disk name
for reading. If two entries of the Universe have the same RepoPath after conversion, collect
`E_PATH_COLLISION` with `[[Subject]]` that RepoPath.

### 7.5 Case Collisions

If two RepoPaths of the Universe are equal after applying the Unicode default lowercase mapping
(as ECMAScript `String.prototype.toLowerCase`) to both, collect `E_PATH_COLLISION` with
`[[Subject]]` the first of them in path order.

NOTE: Such files cannot coexist on case-insensitive file systems, so a Lockfile written on one
host would disagree with another. The collision is an error on every host.
