import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';

const config = loadConfig();

const app = await NestFactory.create(AppModule.forRoot(config), { bufferLogs: true });
app.useLogger(app.get(Logger));
app.enableShutdownHooks();

await app.listen(config.PORT, '0.0.0.0');
