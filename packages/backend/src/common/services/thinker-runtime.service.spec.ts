import { ConfigService } from '@nestjs/config';
import { ThinkerRuntimeService } from './thinker-runtime.service';

describe('ThinkerRuntimeService', () => {
  it('returns configured auth base URL when present', () => {
    const config = {
      get: jest
        .fn()
        .mockImplementation((key: string, defaultValue?: unknown) =>
          key === 'app.betterAuthUrl' ? 'https://auth.example.com' : defaultValue,
        ),
    } as unknown as ConfigService;

    const service = new ThinkerRuntimeService(config);

    expect(service.getAuthBaseUrl()).toBe('https://auth.example.com');
  });

  it('falls back to localhost auth base URL using app.port', () => {
    const config = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'app.betterAuthUrl') return '';
        if (key === 'app.port') return 4010;
        return defaultValue;
      }),
    } as unknown as ConfigService;

    const service = new ThinkerRuntimeService(config);

    expect(service.getAuthBaseUrl()).toBe('http://localhost:4010');
  });
});
