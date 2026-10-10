# docstamp-plugin-js

A [docstamp](https://github.com/nam-hle/docstamp#readme) plugin: depend on one **top-level
declaration** of a JavaScript or TypeScript file, by its name, so a doc goes stale only when that
declaration changes.

> Not published yet: the first release follows the first docstamp release that has the plugin API
> (0.6.0). Until then it is built and tested in the repository.

```sh
pnpm add -D docstamp docstamp-plugin-js
```

Plugins are registered in a script configuration (`docstamp.config.ts` or `.js`):

```ts
import { defineConfig } from 'docstamp';
import js from 'docstamp-plugin-js';

export default defineConfig({
  version: 2,
  plugins: [js],
  files: {
    'CLAUDE.md': {
      dependencies: [{ path: 'api.ts', select: 'createUser' }],
    },
  },
});
```

`CLAUDE.md` now depends on `createUser` in `api.ts` and on nothing else. Real output:

```
$ docstamp
STALE    CLAUDE.md  (unrecorded)
  depends   "api.ts#\"createUser\""
0 ok, 1 stale, 0 invalid

$ docstamp update CLAUDE.md
written  CLAUDE.md
```

An edit to the body of `createUser`, or to any other declaration, leaves it `ok`. A new parameter
makes it stale:

```
$ docstamp
STALE    CLAUDE.md  (content-changed)
  fragment  "api.ts#\"createUser\""  (changed)  function createUser (shape) (lines 1-3)
  review: git diff -M <commit> -- api.ts
0 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update CLAUDE.md
```

The report names the declaration, its part and its lines because this plugin returns them with the hash (`focus` and `lines`, [SPEC §8](SPEC.md#8-extract)).

## The selector

- `select: 'createUser'` names the declaration `createUser`, of any kind.
- `select: { name: 'User', kind: 'interface' }` names only an interface. Kinds: `function`,
  `class`, `interface`, `type`, `enum`, `variable`, `namespace`.
- `select: { name: 'createUser', part: 'source' }` hashes the whole source instead of the shape.
- A name shared by two declarations (a function and an interface of the same name) is
  `E_SELECT_AMBIGUOUS`: add `kind`. A name that is not declared is `E_SELECT_NOT_FOUND`.
- Overload signatures and their implementation are one declaration.
- An invalid selector, or a file that does not parse, is reported as `E_SELECT` without detail;
  the forms above are the only valid ones.

## What is hashed

By default the **shape**: the declaration as written, with the bodies of functions, methods,
constructors, accessors and static blocks left out, and so are the bodies of arrow functions and
function expressions that initialize a variable. Parameters, types, modifiers, decorators and
comments inside the declaration count; the code that runs does not. With `part: 'source'` every
byte counts.

- Only top-level declarations can be selected, including `export` and `export default` forms.
  Members of a class or interface are part of their declaration.
- Line endings are normalized, so CRLF and LF hash the same.

The full contract is [SPEC.md](SPEC.md). The plugin parses with
[`@babel/parser`](https://babeljs.io/docs/babel-parser) only to find where declarations begin and
end.
