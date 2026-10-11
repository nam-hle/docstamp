## 6 Root

`DetermineRoot(cwd)`, *cwd* the working directory of the command (§13.4):

1. Let *dir* be *cwd*.
2. Repeat:
   1. If *dir* contains an entry named by any of the Configuration file names of §9.1, return
      *dir*.
   2. If *dir* is the filesystem root, stop this loop.
   3. Set *dir* to the parent of *dir*.
3. Let *dir* be *cwd*.
4. Repeat:
   1. If *dir* contains an entry named `.git`, of any kind, return *dir*.
   2. If *dir* is the filesystem root, raise `E_CONFIG_MISSING`.
   3. Set *dir* to the parent of *dir*.

NOTE: A Configuration file in any ancestor wins over a nearer `.git`. The entry `.git` may be a
file, as in a linked work tree or a submodule. A Root found by step 4 has no Configuration file, so
the defaults of §5.2 apply (§9.3 step 2). The Root is *cwd* or one of its ancestors, so every
file argument that §13.4 resolves inside Root has a relative path from *cwd* to Root.
