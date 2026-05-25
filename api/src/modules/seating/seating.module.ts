import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeatingPlan } from '../../entities/seating-plan.entity';
import { SeatingTable } from '../../entities/seating-table.entity';
import { Seat } from '../../entities/seat.entity';
import { Invitation } from '../../entities/invitation.entity';
import { SeatingController } from './seating.controller';
import { SeatingService } from './seating.service';

@Module({
  imports: [TypeOrmModule.forFeature([
    SeatingPlan, SeatingTable, Seat, Invitation,
  ])],
  controllers: [SeatingController],
  providers: [SeatingService],
})
export class SeatingModule {}
