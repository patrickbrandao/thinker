import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ShutdownService } from './shutdown.service';
import { isSimulationMode } from '../common/outbound/simulation';

@Controller('api/v1')
export class HealthController {
  private readonly startTime = Date.now();

  constructor(private readonly shutdown: ShutdownService) {}

  @Public()
  @Get('health')
  getHealth() {
    const uptime_seconds = Math.floor((Date.now() - this.startTime) / 1000);
    if (this.shutdown.isShuttingDown()) {
      // The process is draining before shutdown. Report unhealthy so the
      // platform edge stops routing new traffic to this replica while the
      // server keeps serving in-flight requests through the drain window.
      throw new ServiceUnavailableException({ status: 'shutting_down', uptime_seconds });
    }
    // Pure simulation (THINKER_SIMULATION=true): only then is the flag present.
    return isSimulationMode()
      ? { status: 'healthy', uptime_seconds, simulation: true }
      : { status: 'healthy', uptime_seconds };
  }
}
