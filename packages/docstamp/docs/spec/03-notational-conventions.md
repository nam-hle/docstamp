## 3 Notational Conventions

### 3.1 Algorithms

Behavior is specified as algorithms of numbered steps, performed in order. An *abstract
operation*, written `Name(arg1, arg2)`, either returns a value or *raises* a non-empty List of
Diagnostics (§5.5).

`? Name(...)` means: if the call raises, the calling algorithm raises the same List and performs
no further steps.

An algorithm that *collects* a Diagnostic appends it to a List local to that algorithm, named in
the algorithm, and continues.

### 3.2 Data

A *List* is an ordered sequence, written « a, b ». A *Map* has unique keys and is enumerated in
path order (§3.3) of its keys. A *Record* has named fields, written `[[Field]]`.

A *String* is a sequence of Unicode code points. String *equality* is code point by code point,
with no normalization, case folding or trimming unless a step says so.

### 3.3 Path Order

*Path order* is ascending lexicographic order of Strings by UTF-16 code unit. It is the only
ordering in this specification. Locale-aware collation MUST NOT be used.

NOTE: For code points above U+FFFF this differs from UTF-8 byte order. It is still identical on
every host.

### 3.4 String Quoting

`Quote(s)` is the String `"`, then each code point *c* of *s* replaced as follows, then `"`:

| *c* | Replacement |
|---|---|
| `"` | `\"` |
| `\` | `\\` |
| U+0008, U+0009, U+000A, U+000C, U+000D | `\b`, `\t`, `\n`, `\f`, `\r` |
| any other code point in U+0000 to U+001F, U+007F to U+009F, U+2028, U+2029, U+FEFF | `\u` and 4 lowercase hex digits |
| anything else | *c* |

NOTE: `Quote` produces both a valid JSON string and a valid YAML 1.2 double-quoted scalar that
parse back to *s*. It is the only escaping used in output and in the Lockfile.

### 3.5 Canonical JSON

`CanonicalJson(v)` for a plain value *v* (§9.5 `ToPlain`, restricted to Null, Boolean, finite
Number, String, List and Map) returns a String: for Null, a Boolean, a Number or a String, the
result of ECMAScript `JSON.stringify(v)`; for a List, `[`, the `CanonicalJson` of its elements
separated by `,`, and `]`; for a Map, `{`, each `JSON.stringify(key)`, `:` and `CanonicalJson` of
the value, in path order (§3.3) of the keys and separated by `,`, and `}`. There is no
white space.
