import { isAlias, isMap, isPair, isScalar, isSeq, parseAllDocuments, visit } from 'yaml';

export type YamlValue = string | number | boolean | null | YamlValue[] | YamlMap;
export interface YamlMap {
  readonly kind: 'map';
  readonly entries: Map<string, YamlNodeInfo>;
}
export interface YamlNodeInfo {
  value: YamlValue;
  plainSource: string | null;
}

class Violation extends Error {}

function convert(node: unknown, text: string): YamlNodeInfo {
  if (node === null || node === undefined) return { value: null, plainSource: null };
  if (isScalar(node)) {
    const value = node.value;
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Violation();
    }
    const plain =
      node.type === 'PLAIN' && node.range ? text.slice(node.range[0], node.range[1]) : null;
    return { value: value as string | number | boolean | null, plainSource: plain };
  }
  if (isSeq(node)) {
    return { value: node.items.map((item) => convert(item, text).value), plainSource: null };
  }
  if (isMap(node)) {
    const entries = new Map<string, YamlNodeInfo>();
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new Violation();
      if (entries.has(pair.key.value)) throw new Violation();
      entries.set(pair.key.value, convert(pair.value, text));
    }
    return { value: { kind: 'map', entries }, plainSource: null };
  }
  throw new Violation();
}

// SPEC §9.2
export function parseStrictYaml(raw: string): YamlNodeInfo | null {
  const text = raw.startsWith('﻿') ? raw.slice(1) : raw;
  const docs = parseAllDocuments(text, {
    version: '1.2',
    schema: 'core',
    uniqueKeys: true,
    merge: false,
  });
  const [doc] = Array.isArray(docs) ? docs : [];
  if (!doc || !Array.isArray(docs) || docs.length !== 1) return null;
  if (doc.errors.length > 0) return null;
  let bad = false;
  visit(doc, {
    Node: (_key, node) => {
      if (isAlias(node) || (!isPair(node) && (node.anchor || node.tag))) bad = true;
    },
    Pair: (_key, pair) => {
      if (isScalar(pair.key) && pair.key.type === 'PLAIN' && pair.key.value === '<<') bad = true;
    },
  });
  if (bad) return null;
  try {
    return convert(doc.contents, text);
  } catch (error) {
    if (error instanceof Violation) return null;
    throw error;
  }
}
