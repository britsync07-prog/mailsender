import Spintax from 'spintax-extended';

export function parseSpintax(spintax: string): string {
  if (!spintax) return '';
  try {
    return Spintax.unspin(spintax);
  } catch {
    let result = spintax;
    let maxIterations = 100;
    while (result.includes('{') && maxIterations > 0) {
      const match = result.match(/\{([^{}]+)\}/);
      if (!match) break;
      const options = match[1].split('|');
      const selected = options[Math.floor(Math.random() * options.length)];
      result = result.replace(match[0], selected);
      maxIterations--;
    }
    return result;
  }
}

export function countVariations(spintax: string): number {
  if (!spintax) return 1;
  try {
    return Spintax.countVariations(spintax);
  } catch {
    let count = 1;
    const regex = /\{([^{}]+)\}/g;
    let match;
    while ((match = regex.exec(spintax)) !== null) {
      const options = match[1].split('|');
      count *= options.length;
    }
    return count;
  }
}

export function generateVariations(spintax: string, count: number): string[] {
  const variations = new Set<string>();
  let attempts = 0;
  const maxAttempts = count * 10;

  while (variations.size < count && attempts < maxAttempts) {
    const variation = parseSpintax(spintax);
    variations.add(variation);
    attempts++;
  }

  return Array.from(variations);
}

export function validateSpintax(spintax: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  let braceCount = 0;
  for (const char of spintax) {
    if (char === '{') braceCount++;
    if (char === '}') braceCount--;
    if (braceCount < 0) {
      errors.push('Unmatched closing brace');
      break;
    }
  }
  if (braceCount !== 0) {
    errors.push('Unmatched opening brace');
  }

  let bracketCount = 0;
  for (const char of spintax) {
    if (char === '[') bracketCount++;
    if (char === ']') bracketCount--;
    if (bracketCount < 1) {
      break;
    }
  }

  if (/\{\|/.test(spintax) || /\|\}/.test(spintax)) {
    errors.push('Empty option in spintax');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function extractOptions(spintax: string): string[][] {
  const options: string[][] = [];
  const regex = /\{([^{}]+)\}/g;
  let match;
  while ((match = regex.exec(spintax)) !== null) {
    options.push(match[1].split('|'));
  }
  return options;
}

export function unspinByIndex(spintax: string, index: number): string {
  try {
    return Spintax.unspinByIndex(spintax, index);
  } catch {
    return parseSpintax(spintax);
  }
}

export function fullUnspinList(spintax: string): string[] {
  try {
    return Spintax.fullUnspinList(spintax);
  } catch {
    return generateVariations(spintax, 10);
  }
}

export function randomUnspinList(spintax: string, size: number): string[] {
  try {
    return Spintax.randomUnspinList(spintax, size, true);
  } catch {
    return generateVariations(spintax, size);
  }
}

export function getSpintaxStats(): { library: string; supportsPermutations: boolean; supportsIndexed: boolean } {
  return {
    library: 'spintax-extended',
    supportsPermutations: true,
    supportsIndexed: true,
  };
}
