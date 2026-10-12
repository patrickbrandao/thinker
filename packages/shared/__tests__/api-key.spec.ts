import { API_KEY_PREFIX } from '../src/api-key';

describe('API_KEY_PREFIX', () => {
  it('equals thk_', () => {
    expect(API_KEY_PREFIX).toBe('thk_');
  });
});
