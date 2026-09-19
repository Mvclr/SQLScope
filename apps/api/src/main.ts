import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { configureApp } from './bootstrap.js';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';

const config = loadConfig();

const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
  bufferLogs: true,
});
app.useLogger(app.get(Logger));
configureApp(app, config);
app.enableShutdownHooks();

await app.listen(config.PORT, '0.0.0.0');
