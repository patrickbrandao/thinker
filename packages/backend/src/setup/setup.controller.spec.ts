jest.mock('../auth/auth.instance', () => ({
  auth: { api: { signUpEmail: jest.fn() } },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

describe('SetupController', () => {
  let controller: SetupController;
  let mockNeedsSetup: jest.Mock;
  let mockCreateFirstAdmin: jest.Mock;
  let mockGetEnabledSocialProviders: jest.Mock;
  let mockGetLocalLlmHost: jest.Mock;
  let mockIsEmailConfigured: jest.Mock;
  let mockIsMcpEnabled: jest.Mock;

  beforeEach(async () => {
    mockNeedsSetup = jest.fn();
    mockCreateFirstAdmin = jest.fn();
    mockGetEnabledSocialProviders = jest.fn().mockReturnValue([]);
    mockGetLocalLlmHost = jest.fn().mockReturnValue('localhost');
    mockIsEmailConfigured = jest.fn().mockReturnValue(true);
    mockIsMcpEnabled = jest.fn().mockReturnValue(true);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SetupController],
      providers: [
        {
          provide: SetupService,
          useValue: {
            needsSetup: mockNeedsSetup,
            createFirstAdmin: mockCreateFirstAdmin,
            getEnabledSocialProviders: mockGetEnabledSocialProviders,
            getLocalLlmHost: mockGetLocalLlmHost,
            isEmailConfigured: mockIsEmailConfigured,
            isMcpEnabled: mockIsMcpEnabled,
          },
        },
      ],
    }).compile();

    controller = module.get<SetupController>(SetupController);
  });

  describe('getStatus', () => {
    it('reports mcpEnabled=false when the install runs without the MCP server', async () => {
      mockNeedsSetup.mockResolvedValue(false);
      mockIsMcpEnabled.mockReturnValue(false);
      const result = await controller.getStatus();
      expect(result.mcpEnabled).toBe(false);
    });

    it('returns needsSetup=true with empty socialProviders', async () => {
      mockNeedsSetup.mockResolvedValue(true);
      const result = await controller.getStatus();
      expect(result).toEqual({
        needsSetup: true,
        socialProviders: [],
        localLlmHost: 'localhost',
        emailConfigured: true,
        mcpEnabled: true,
      });
    });

    it('returns needsSetup=false with empty socialProviders', async () => {
      mockNeedsSetup.mockResolvedValue(false);
      const result = await controller.getStatus();
      expect(result).toEqual({
        needsSetup: false,
        socialProviders: [],
        localLlmHost: 'localhost',
        emailConfigured: true,
        mcpEnabled: true,
      });
    });

    it('includes enabled social providers in the response', async () => {
      mockNeedsSetup.mockResolvedValue(false);
      mockGetEnabledSocialProviders.mockReturnValue(['google', 'github']);
      const result = await controller.getStatus();
      expect(result).toEqual({
        needsSetup: false,
        socialProviders: ['google', 'github'],
        localLlmHost: 'localhost',
        emailConfigured: true,
        mcpEnabled: true,
      });
    });

    it('reports no deployment mode and no Ollama availability', async () => {
      mockNeedsSetup.mockResolvedValue(false);
      const result = await controller.getStatus();
      // No mode flag and no Ollama probe result (#109): exactly these fields.
      expect(Object.keys(result).sort()).toEqual([
        'emailConfigured',
        'localLlmHost',
        'mcpEnabled',
        'needsSetup',
        'socialProviders',
      ]);
    });

    it('returns host.docker.internal as localLlmHost when running inside Docker', async () => {
      mockNeedsSetup.mockResolvedValue(false);
      mockGetLocalLlmHost.mockReturnValue('host.docker.internal');
      const result = await controller.getStatus();
      expect(result.localLlmHost).toBe('host.docker.internal');
    });

    it('reports emailConfigured=false when no email provider is set', async () => {
      mockNeedsSetup.mockResolvedValue(false);
      mockIsEmailConfigured.mockReturnValue(false);
      const result = await controller.getStatus();
      expect(result.emailConfigured).toBe(false);
    });
  });

  describe('createAdmin', () => {
    const dto = {
      email: 'founder@example.com',
      name: 'Founder',
      password: 'secret-password',
    };

    it('delegates to service and returns ok', async () => {
      mockCreateFirstAdmin.mockResolvedValue(undefined);
      const result = await controller.createAdmin(dto);

      expect(result).toEqual({ ok: true });
      expect(mockCreateFirstAdmin).toHaveBeenCalledWith(dto);
    });

    it('propagates service errors', async () => {
      mockCreateFirstAdmin.mockRejectedValue(new Error('already exists'));
      await expect(controller.createAdmin(dto)).rejects.toThrow('already exists');
    });
  });
});
