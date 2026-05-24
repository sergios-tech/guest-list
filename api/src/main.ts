import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind nginx (compose default). Required so ThrottlerGuard sees the real
  // client IP from X-Forwarded-For instead of the docker bridge address.
  app.set('trust proxy', 'loopback');
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));
  // In production, nginx fronts both API and web on the same origin
  // so CORS is generally unnecessary. Enabled for local dev convenience.
  app.enableCors({ origin: true, credentials: true });
  await app.listen(Number(process.env.PORT) || 3000);
}
bootstrap();
