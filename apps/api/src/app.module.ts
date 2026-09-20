import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CONFIG, type Config } from './config.js';
import { AuthModule } from './auth/auth.module.js';
import { ExecutionModule } from './execution/execution.module.js';
import { HealthModule } from './health/health.module.js';
import { InfrastructureModule } from './infrastructure/infrastructure.module.js';
import { SessionsModule } from './sessions/sessions.module.js';

@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.LOG_LEVEL,
            // Structured JSON in production; readable lines while developing.
            ...(config.NODE_ENV === 'development' && {
              transport: { target: 'pino-pretty', options: { singleLine: true } },
            }),
            redact: [
              'req.headers.cookie',
              'req.headers.authorization',
              'res.headers["set-cookie"]',
            ],
            autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
          },
        }),
        InfrastructureModule,
        HealthModule,
        AuthModule,
        SessionsModule,
        ExecutionModule,
      ],
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
  }
}
