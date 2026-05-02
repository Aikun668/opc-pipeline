const { systemCheck } = require('../utils/health');

describe('systemCheck', () => {
  it('returns object with status and timestamp', () => {
    const result = systemCheck();
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('timestamp');
  });

  it('status is Alpha OK', () => {
    const result = systemCheck();
    expect(result.status).toBe('Alpha OK');
  });

  it('timestamp is valid and close to current time', () => {
    const before = Date.now();
    const result = systemCheck();
    const after = Date.now();
    expect(typeof result.timestamp).toBe('number');
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });
});