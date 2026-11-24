import { executeWithResilience } from '../src/resilient-executor';
import { describe, it, expect } from 'vitest';

describe('Resilient Executor', () => {
  it('should succeed on first attempt if no error', async () => {
    const res = await executeWithResilience(async () => 'success');
    expect(res).toBe('success');
  });

  it('should retry on failure and eventually succeed', async () => {
    let attempts = 0;
    const res = await executeWithResilience(async () => {
      attempts++;
      if (attempts < 3) throw new Error('temporary failure');
      return 'recovered';
    }, { baseDelayMs: 10 });

    expect(res).toBe('recovered');
    expect(attempts).toBe(3);
  });
});
