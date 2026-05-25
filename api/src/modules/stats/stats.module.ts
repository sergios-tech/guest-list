import { Controller, Get, Injectable, Module, UseGuards } from '@nestjs/common';
import { InjectDataSource, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Injectable()
export class StatsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}
  async overview() {
    const [row] = await this.ds.query('SELECT * FROM v_invitation_stats');
    return {
      pending: Number(row.pending),
      confirmedInvites: Number(row.confirmed_invites),
      notInvited: Number(row.not_invited),
      declined: Number(row.declined),
      totalInvites: Number(row.total_invites),
      plannedHeadcount: Number(row.planned_headcount),
      confirmedAdults: Number(row.confirmed_adults),
      confirmedChildren: Number(row.confirmed_children),
      confirmedHeadcount: Number(row.confirmed_headcount),
      forecastHeadcount: Number(row.forecast_headcount),
    };
  }
}

@UseGuards(JwtAuthGuard)
@Controller('stats')
export class StatsController {
  constructor(private readonly svc: StatsService) {}
  @Get('overview') overview() { return this.svc.overview(); }
}

@Module({
  imports: [TypeOrmModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
