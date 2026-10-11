# docstamp-plugin-js Specification

The contract of the plugin: which top-level declaration of a JavaScript or TypeScript file a
selector names, and what is hashed. How docstamp calls a plugin, counts matches and reports errors is
the contract of docstamp
([SPEC §8.7](../docstamp/docs/SPEC.md#87-selected-dependencies)); this document does not repeat it.

## 1 Scope

The plugin registers for JavaScript and TypeScript files and lets a dependency name one *declaration*
by its kind and name, so a doc that describes `createUser` goes stale when its public shape changes,
not when its body is refactored. It parses with `@babel/parser` only to find declarations, their
bodies and their boundaries; it hashes source text, never a rendering or a type-checked meaning.

Only declarations at the top level of the file are selectable. Members of a class or a namespace are
part of the shape of the declaration that holds them (§7.2) but cannot be selected alone.

## 2 Terms

- *Statement*: a top-level statement of the program (§5).
- *Declaration*: a { `[[Kind]]`, `[[Name]]`, `[[Statement]]` } found in a Statement (§6).
- *Group*: the Declarations that are selected together: a function and its overloads (§6.2).
- *Shape*: the source text of a Statement without the bodies of its functions (§7.2).
- *Selector*: the `select` value of a dependency (§4).

## 3 The Plugin

The default export is a docstamp plugin (SPEC §8.7) with `name` `docstamp-plugin-js`, `apiVersion` 1
and `files` « `**/*.js`, `**/*.mjs`, `**/*.cjs`, `**/*.jsx`, `**/*.ts`, `**/*.mts`, `**/*.cts`,
`**/*.tsx` ». Its `extract` is `Extract` (§8).

## 4 Selector

`ParseSelector(v)` returns { `[[Name]]`: a String, `[[Kind]]`: a Kind or *none*, `[[Part]]`: `shape` or
`source` }, or raises:

1. If *v* is a String, let *name* be *v*, *kind* *none* and *part* `shape`.
2. Else if *v* is a Map whose keys are all `name`, `kind` or `part`, let *name*, *kind* and *part* be
   its values, *kind* being *none* and *part* being `shape` when absent.
3. Otherwise raise.
4. Remove from *name* its leading and trailing U+0020 and U+0009. Raise if *name* is not a String or
   is empty.
5. Raise unless *kind* is *none* or one of `function`, `class`, `interface`, `type`, `enum`,
   `variable`, `namespace`, and *part* is `shape` or `source`.

NOTE: A selector that raises is reported by docstamp as `E_SELECT` (the plugin threw). A valid selector
that matches nothing is `E_SELECT_NOT_FOUND`; one that matches more than one Group is
`E_SELECT_AMBIGUOUS`.

## 5 Parsing

`Parse(path, text)` returns the top-level Statements of *text*, or raises:

1. Let *source* be *text* with every CR LF replaced by LF.
2. Let *extension* be the last extension of *path* in lower case. Parse *source* with `@babel/parser`,
   `sourceType` `unambiguous`, error recovery off, the plugins `decorators` and `jsx`, and the plugin
   `typescript` too for `.ts`, `.mts`, `.cts` and `.tsx`, but without `jsx` for `.ts`, `.mts` and
   `.cts` (where `<T>x` is a type assertion).
3. If the parser reports a syntax error, raise. Return the `body` of the program, each Statement with
   the offsets `[[Start]]` and `[[End]]` of its source in *source*.

NOTE: A file that does not parse cannot be hashed, so it is `E_SELECT`; the plugin never hashes a
partial parse.

## 6 Declarations

### 6.1 Finding them

`Declarations(statements)` returns the List of Declarations in source order. A Statement is *unwrapped*
to its `declaration` if it is an `export` or `export default` of one; the unwrapped node *d* gives:

| Node | Kind | Name |
|---|---|---|
| function declaration, or a function signature without a body | `function` | its identifier, or `default` |
| class declaration | `class` | its identifier, or `default` |
| interface declaration | `interface` | its identifier |
| type alias | `type` | its identifier |
| enum declaration | `enum` | its identifier |
| variable declaration | `variable` | one Declaration per declarator that binds a single identifier |
| `namespace` or `module` declaration | `namespace` | its identifier (the first one of `A.B`, which declares `A`), or its string literal |

A Statement that is not one of these, an `export { a, b }` list and a re-export give no Declaration.
`[[Statement]]` is the whole Statement, including its `export` keyword and its decorators.

NOTE: A constant arrow function is a `variable`, not a `function`.

### 6.2 Groups

A *Group* is a maximal run of adjacent Statements whose Declarations are `function` Declarations of the
same name, every one a function signature without a body except possibly the last. Every other
Declaration is a Group of its own. The Group's `[[Statements]]` are those of its Declarations.

NOTE: This makes the overload signatures and the implementation of a function one match, so a
documented overloaded function is one dependency.

## 7 Parts

### 7.1 Source

`Source(group)` is the text of *source* from the `[[Start]]` of the first Statement of the Group to the
`[[End]]` of the last.

### 7.2 Shape

`Shape(group)` is the List of `ShapeOf(statement)` joined with LF. `ShapeOf(statement)` is the text of
the Statement with *elided* ranges removed, where the elided ranges are, in the unwrapped
declaration:

- the body of a function declaration, of a class method, constructor, accessor or private method, and
  of a class static block;
- for a variable declaration, the body (block or expression) of every declarator whose initializer is
  an arrow function or a function expression.

Nothing else is elided: a type, an enum, an interface or a namespace is its own shape, and so are the
initializer of a constant that is not a function and the initializer of a class property.

NOTE: The text keeps its comments, white space and punctuation: a changed parameter name, type,
modifier, decorator or `export` is a change; a changed body is not.

## 8 Extract

`Extract({ path, text, select })` returns { `hashes`, `focus`, `lines` }:

1. Let *selector* be ? `ParseSelector(select)` and *statements* be ? `Parse(path, text)`.
2. Let *groups* be the Groups of `Declarations(statements)` (§6).
3. Let *matches* be the Groups whose Declarations have `[[Name]]` equal to `selector.[[Name]]` and,
   unless `selector.[[Kind]]` is *none*, `[[Kind]]` equal to it.
4. Return `hashes`, the List, in source order, of the lower-case hexadecimal SHA-256 of the UTF-8
   encoding of `Source` (when `selector.[[Part]]` is `source`) or of `Shape` (when it is `shape`) of each
   match; and, when there is a match, `focus`, the List of the Strings `<kind> <name> (<part>)` of the
   matches (`function createUser (shape)`), and `lines`, the List of { `start`, `end` } of the matches:
   the line where the first Statement of the Group starts and the line where its last Statement ends,
   counted in *text* (CR LF read as LF).

NOTE: `focus` and `lines` are advisory: docstamp prints them in its changed-file report and never
hashes them, so they are not part of the compatibility of §9.

NOTE: A `const k = 1, l = 2` statement has two Declarations (`k`, `l`) in one Statement; each is its own
Group and both give the same text.

## 9 Compatibility

The hash of a declaration is part of the Dependency Hash of every file that depends on it, so a change
to what `Shape` or `Source` contain, to which Declarations exist or are grouped, to the selector forms of
§4 or to `files` in §3 is breaking. So is a parser upgrade that changes where a Statement or a body
starts or ends.
