import { Controller, Get, Injectable, Module, UseGuards } from '@nestjs/common';
import { InjectDataSource, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/jwt-auth.guard';
import { ClientContextGuard, CurrentClientId } from '../auth/client-context.guard';
import { UserClient } from '../../entities/user-client.entity';

@Injectable()
export class StatsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}
  async overview(clientId: string) {
    const [row] = await this.ds.query(
      'SELECT * FROM v_invitation_stats WHERE client_id = $1',
      [clientId],
    );
    return {
      pending: Number(row?.pending ?? 0),
      confirmedInvites: Number(row?.confirmed_invites ?? 0),
      notInvited: Number(row?.not_invited ?? 0),
      declined: Number(row?.declined ?? 0),
      totalInvites: Number(row?.total_invites ?? 0),
      plannedHeadcount: Number(row?.planned_headcount ?? 0),
      confirmedAdults: Number(row?.confirmed_adults ?? 0),
      confirmedChildren: Number(row?.confirmed_children ?? 0),
      confirmedHeadcount: Number(row?.confirmed_headcount ?? 0),
      forecastHeadcount: Number(row?.forecast_headcount ?? 0),
    };
  }
}

@UseGuards(JwtAuthGuard, ClientContextGuard, RolesGuard)
@Controller('stats')
export class StatsController {
  constructor(private readonly svc: StatsService) {}

  @Get('overview')
  @Roles('OWNER', 'EDITOR', 'VIEWER')
  overview(@CurrentClientId() clientId: string) {
    return this.svc.overview(clientId);
  }
}

@Module({
  // UserClient is needed so ClientContextGuard (used on the controller) can
  // resolve its membership repository via DI.
  imports: [TypeOrmModule.forFeature([UserClient])],
  controllers: [StatsController],
  providers: [StatsService, ClientContextGuard, RolesGuard],
})
export class StatsModule {}
