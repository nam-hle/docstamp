// SPEC §9.3 NOTE (near key): the edit distance in code points (insert, delete, substitute)
function editDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      const substitute = previous[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, substitute));
    }
    previous = current;
  }
  return previous[y.length]!;
}

// SPEC §9.3 NOTE (near key): the first known key at the smallest distance, at most 2, else null
export function closestKey(key: string, known: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = 3;
  for (const candidate of known) {
    const distance = editDistance(key, candidate);
    if (distance > 0 && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

// SPEC §9.3 NOTE (near key): the message, with a suggestion when a known key is close
export function unknownKeyMessage(key: string, known: readonly string[]): string | undefined {
  const near = closestKey(key, known);
  return near === null ? undefined : `Remove or correct the key; did you mean "${near}"?`;
}
