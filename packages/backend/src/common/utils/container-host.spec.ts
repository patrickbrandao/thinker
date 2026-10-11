import { getContainerHostAlias } from './container-host';
import * as fs from 'fs';

jest.mock('fs');

const mockedExistsSync = jest.mocked(fs.existsSync);

describe('getContainerHostAlias', () => {
  afterEach(() => {
    mockedExistsSync.mockReset();
  });

  it("returns 'host.docker.internal' when /.dockerenv exists", () => {
    mockedExistsSync.mockImplementation((p) => p === '/.dockerenv');
    expect(getContainerHostAlias()).toBe('host.docker.internal');
  });

  it("returns 'host.containers.internal' when only /run/.containerenv exists (Podman)", () => {
    mockedExistsSync.mockImplementation((p) => p === '/run/.containerenv');
    expect(getContainerHostAlias()).toBe('host.containers.internal');
  });

  it("prefers 'host.docker.internal' when both markers exist (Docker writes both in some setups)", () => {
    mockedExistsSync.mockReturnValue(true);
    expect(getContainerHostAlias()).toBe('host.docker.internal');
  });

  it("returns 'localhost' when no marker exists", () => {
    mockedExistsSync.mockReturnValue(false);
    expect(getContainerHostAlias()).toBe('localhost');
  });

  it("returns 'localhost' when existsSync throws", () => {
    mockedExistsSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(getContainerHostAlias()).toBe('localhost');
  });
});
