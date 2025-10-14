import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('utils.cn', () => {
  it('merges class names', () => {
    expect(cn('a', false && 'b', 'c')).toContain('a');
  });
});

