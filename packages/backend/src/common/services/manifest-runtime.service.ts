import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_PORT } from '../constants/server.constants';

@Injectable()
export class ManifestRuntimeService {
  constructor(private readonly config: ConfigService) {}

  getAuthBaseUrl(): string {
    const configuredBaseUrl = this.config.get<string>('app.betterAuthUrl', '');
    if (configuredBaseUrl) return configuredBaseUrl;

    const port = this.config.get<number>('app.port', DEFAULT_PORT);
    return `http://localhost:${port}`;
  }
}
