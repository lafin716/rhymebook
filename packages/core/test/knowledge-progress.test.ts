import { describe, expect, it } from 'vitest';
import { parseGitProgress } from '../src/knowledge';

describe('parseGitProgress', () => {
  it('maps receiving/resolving/updating to overall ratio', () => {
    expect(parseGitProgress('Receiving objects:   0% (0/10)')).toBe(0);
    expect(parseGitProgress('Receiving objects:  50% (5/10), 1.2 MiB | 3 MiB/s')).toBeCloseTo(0.425);
    expect(parseGitProgress('Receiving objects: 100% (10/10), done.')).toBeCloseTo(0.85);
    expect(parseGitProgress('Resolving deltas:  50% (1/2)')).toBeCloseTo(0.9);
    expect(parseGitProgress('Updating files: 100% (3/3), done.')).toBe(1);
  });
  it('treats counting/compressing as indeterminate progress', () => {
    expect(parseGitProgress('remote: Counting objects: 100% (5/5), done.')).toBeUndefined();
    expect(parseGitProgress('remote: Compressing objects:  40% (2/5)')).toBeUndefined();
    expect(parseGitProgress("Cloning into '/tmp/x'...")).toBeUndefined();
  });
  it('returns null for non-progress lines', () => {
    expect(parseGitProgress('fatal: repository not found')).toBeNull();
    expect(parseGitProgress('')).toBeNull();
  });
});
