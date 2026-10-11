## 6 Root

`DetermineRoot(cwd, rootOption)`:

1. If *rootOption* is present:
   1. Let *dir* be *rootOption* resolved lexically against *cwd* (§13.4).
   2. If *dir* is not an existing directory, raise `E_ROOT`.
   3. Return *dir*.
2. Let *dir* be *cwd*.
3. Repeat:
   1. If *dir* contains an entry named by any of the Configuration file names of §9.1, return
      *dir*.
   2. If *dir* is the filesystem root, stop this loop.
   3. Set *dir* to the parent of *dir*.
4. Let *dir* be *cwd*.
5. Repeat:
   1. If *dir* contains an entry named `.git`, of any kind, return *dir*.
   2. If *dir* is the filesystem root, raise `E_CONFIG_MISSING`.
   3. Set *dir* to the parent of *dir*.

NOTE: A Configuration file in any ancestor wins over a nearer `.git`. The entry `.git` may be a
file, as in a linked work tree or a submodule. A Root found by step 5 has no Configuration file, so
the defaults of §5.2 apply (§9.3 step 2).
