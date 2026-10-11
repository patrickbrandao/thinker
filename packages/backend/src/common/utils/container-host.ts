import { existsSync } from 'fs';

/**
 * Returns the canonical hostname the container should use to reach the
 * host. Docker uses `host.docker.internal` (mapped via `host-gateway` in
 * compose). Podman exposes the same gateway as `host.containers.internal`.
 * Outside any container, `localhost` resolves correctly.
 *
 * This only picks a hostname for local LLM servers. Thinker has a single
 * (self-hosted) deployment mode, so no behavior depends on container detection.
 */
export function getContainerHostAlias(): string {
  try {
    if (existsSync('/run/.containerenv') && !existsSync('/.dockerenv')) {
      return 'host.containers.internal';
    }
    if (existsSync('/.dockerenv')) return 'host.docker.internal';
  } catch {
    // fall through
  }
  return 'localhost';
}
