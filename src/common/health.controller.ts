import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Returns a static payload indicating the backend gateway process is up. No auth required.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      example: { status: 'ok', service: 'backend-gateway' },
    },
  })
  check() {
    return { status: 'ok', service: 'backend-gateway' };
  }
}
