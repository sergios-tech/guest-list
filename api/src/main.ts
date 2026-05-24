import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Trust exactly one hop (the nginx container). 'loopback' would only trust
  // 127.0.0.1, but nginx connects from the docker bridge — so the real client
  // IP from X-Forwarded-For was being discarded and every client shared one
  // throttler key. Bump if more proxies are added in front.
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));

  // Explicit origin allowlist. Default to dev origins; production must set
  // CORS_ORIGINS=https://your.host[,https://...]. `origin: true` reflects any
  // origin and is unsafe the moment any cookie-based auth or CSRF token lands.
  const defaultOrigins = ['http://localhost:5173', 'http://localhost:8080'];
  const allowedOrigins = (process.env.CORS_ORIGINS ?? defaultOrigins.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, cb) => {
      // No Origin header → same-origin / curl / server-to-server → allow.
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });

  await app.listen(Number(process.env.PORT) || 3000);
}
bootstrap();
