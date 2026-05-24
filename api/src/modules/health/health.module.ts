import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { InjectDataSource, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // Cheap, idempotent. Fails loud if Postgres is unreachable so the docker
  // HEALTHCHECK can gate nginx's start (avoids the cold-boot 502 window).
  async check() {
    await this.ds.query('SELECT 1');
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}

@Controller('health')
export class HealthController {
  constructor(private readonly svc: HealthService) {}
  @Get() check() { return this.svc.check(); }
}

@Module({
  imports: [TypeOrmModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
