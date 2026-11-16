/**
 * #39 / ADR 0003: the OpenCode Go doc lives on raw.githubusercontent.com, so it
 * is fetched only when an OpenCode Go provider is registered, and never with
 * THINKER_CATALOG_SYNC=false.
 */
import { OpencodeGoCatalogService } from './opencode-go-catalog.service';

const MDX = [
  '| Model | Model ID | Endpoint | AI SDK package |',
  '| ----- | -------- | -------- | -------------- |',
  '| GLM-5.1 | glm-5.1 | `https://opencode.ai/zen/go/v1/chat/completions` | `@ai-sdk/openai-compatible` |',
  '',
].join('\n');

function providerRepo(count: number | Error) {
  const where = jest.fn(() => ({
    getCount: async () => {
      if (count instanceof Error) throw count;
      return count;
    },
  }));
  return {
    repo: { createQueryBuilder: jest.fn(() => ({ where })) },
    where,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('OpencodeGoCatalogService egress gate', () => {
  let fetchSpy: jest.SpyInstance;
  const previous = process.env['THINKER_CATALOG_SYNC'];

  beforeEach(() => {
    delete process.env['THINKER_CATALOG_SYNC'];
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => MDX,
    } as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (previous === undefined) delete process.env['THINKER_CATALOG_SYNC'];
    else process.env['THINKER_CATALOG_SYNC'] = previous;
  });

  describe('boot warmup', () => {
    it('does not fetch when no OpenCode Go provider is registered', async () => {
      const { repo } = providerRepo(0);
      new OpencodeGoCatalogService(repo as never).onModuleInit();
      await flush();
      expect(repo.createQueryBuilder).toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('fetches once when an OpenCode Go provider is registered', async () => {
      const { repo, where } = providerRepo(1);
      const service = new OpencodeGoCatalogService(repo as never);
      service.onModuleInit();
      await flush();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0][0])).toContain('raw.githubusercontent.com');
      expect(service.getFormat('glm-5.1')).toBe('openai');
      // Matches the registry id and its aliases, case-insensitively.
      expect(where).toHaveBeenCalledWith('LOWER(p.provider) IN (:...keys)', {
        keys: expect.arrayContaining(['opencode-go', 'opencodego']),
      });
    });

    it('does not fetch without a repository to check', async () => {
      new OpencodeGoCatalogService().onModuleInit();
      await flush();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('does not fetch when the provider lookup fails', async () => {
      const { repo } = providerRepo(new Error('relation "tenant_providers" does not exist'));
      new OpencodeGoCatalogService(repo as never).onModuleInit();
      await flush();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('neither queries nor fetches with THINKER_CATALOG_SYNC=false, even with a provider', async () => {
      process.env['THINKER_CATALOG_SYNC'] = 'false';
      const { repo } = providerRepo(1);
      new OpencodeGoCatalogService(repo as never).onModuleInit();
      await flush();
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('THINKER_CATALOG_SYNC=false', () => {
    beforeEach(() => {
      process.env['THINKER_CATALOG_SYNC'] = 'false';
    });

    it('list() and refresh() return [] without fetching', async () => {
      const service = new OpencodeGoCatalogService();
      await expect(service.list()).resolves.toEqual([]);
      await expect(service.refresh()).resolves.toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('prices OpenCode Go requests as unknown and leaves the format to the caller heuristic', async () => {
      const service = new OpencodeGoCatalogService();
      await expect(service.resolveCostPerRequest('opencode-go/glm-5.1')).resolves.toBeNull();
      await expect(service.resolveFormat('glm-5.1')).resolves.toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it('fetches lazily on first use when sync is on (the path a new provider takes)', async () => {
    const service = new OpencodeGoCatalogService();
    await expect(service.resolveFormat('glm-5.1')).resolves.toBe('openai');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
