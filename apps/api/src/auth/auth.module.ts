import { Module } from '@nestjs/common';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ProjectsController } from './projects.controller.js';
import { UserGuard } from './user.guard.js';

@Module({
  imports: [RateLimitModule],
  controllers: [AuthController, ProjectsController],
  providers: [AuthService, UserGuard],
  exports: [AuthService, UserGuard],
})
export class AuthModule {}
