import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeatingPlan } from '../../entities/seating-plan.entity';
import { SeatingTable } from '../../entities/seating-table.entity';
import { Seat } from '../../entities/seat.entity';
import { Invitation } from '../../entities/invitation.entity';
import { Attendee } from '../../entities/attendee.entity';
import { UserClient } from '../../entities/user-client.entity';
import { ClientContextGuard } from '../auth/client-context.guard';
import { SeatingController } from './seating.controller';
import { SeatingService } from './seating.service';

@Module({
  imports: [TypeOrmModule.forFeature([
    SeatingPlan, SeatingTable, Seat, Invitation, Attendee, UserClient,
  ])],
  controllers: [SeatingController],
  providers: [SeatingService, ClientContextGuard],
})
export class SeatingModule {}
