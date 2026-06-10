import { Module } from '@nestjs/common';
import { PipelineRunsController } from './pipeline-runs.controller';

@Module({ controllers: [PipelineRunsController] })
export class PipelineRunsModule {}
