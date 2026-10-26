import { Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module';
import { AuditService } from './audit/audit.service';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { GroupsController } from './groups/groups.controller';
import { GroupsService } from './groups/groups.service';
import { HealthModule } from './health/health.module';
import { RequestsController } from './requests/requests.controller';
import { RequestsService } from './requests/requests.service';
import { MembershipsController } from './review/memberships.controller';
import { ReviewService } from './review/review.service';
import { SystemController } from './system/system.controller';
import { EmbeddingRepository } from './triage/embedding.repository';
import { TriageService } from './triage/triage.service';
import { TriageWorker } from './triage/triage.worker';

@Module({
  imports: [ConfigModule, DatabaseModule, AiModule, HealthModule],
  controllers: [RequestsController, MembershipsController, GroupsController, SystemController],
  providers: [
    AuditService,
    RequestsService,
    ReviewService,
    GroupsService,
    EmbeddingRepository,
    TriageService,
    TriageWorker,
  ],
})
export class AppModule {}
