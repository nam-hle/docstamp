import type { Value } from './value.ts';
import type { YamlMap, YamlValue } from './yaml-profile.ts';

export const isYamlMap = (v: YamlValue): v is YamlMap =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const fromYaml = (v: YamlValue): Value => {
  if (Array.isArray(v)) return v.map(fromYaml);
  if (isYamlMap(v)) {
    return new Map([...v.entries].map(([key, info]) => [key, fromYaml(info.value)]));
  }
  return v;
};
