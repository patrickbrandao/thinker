import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { readBranding } from './branding';

@Controller('api/v1')
export class BrandingController {
  // Public: the login screen and the shell read it before and after sign-in.
  @Public()
  @Get('branding')
  getBranding() {
    return readBranding();
  }
}
