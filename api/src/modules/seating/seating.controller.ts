import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SeatingService } from './seating.service';
import {
  AssignSeatDto, AutoFillDto, CreatePlanDto, CreateTableDto, SwapSeatsDto,
  UpdatePlanDto, UpdateTableDto,
} from './dto';

@UseGuards(JwtAuthGuard)
@Controller('seating')
export class SeatingController {
  constructor(private readonly svc: SeatingService) {}

  // --- plans ---
  @Get('plans')
  listPlans() {
    return this.svc.listPlans();
  }

  @Get('plans/:id')
  getPlan(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.findPlan(id);
  }

  @Post('plans')
  createPlan(@Body() dto: CreatePlanDto, @Req() req: any) {
    return this.svc.createPlan(dto, req.user.id);
  }

  @Patch('plans/:id')
  updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @Req() req: any,
  ) {
    return this.svc.updatePlan(id, dto, req.user.id);
  }

  @Post('plans/:id/activate')
  activatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
  ) {
    return this.svc.activatePlan(id, req.user.id);
  }

  @Delete('plans/:id')
  removePlan(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.removePlan(id);
  }

  @Get('plans/:id/unseated')
  unseated(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.unseatedForPlan(id);
  }

  @Post('plans/:id/auto-fill')
  autoFill(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AutoFillDto,
  ) {
    return this.svc.autoFill(id, dto);
  }

  // --- tables ---
  @Post('plans/:id/tables')
  addTable(
    @Param('id', ParseUUIDPipe) planId: string,
    @Body() dto: CreateTableDto,
  ) {
    return this.svc.addTable(planId, dto);
  }

  @Patch('tables/:id')
  updateTable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTableDto,
  ) {
    return this.svc.updateTable(id, dto);
  }

  @Delete('tables/:id')
  removeTable(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.removeTable(id);
  }

  // --- seats ---
  @Post('seats/:id/assign')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignSeatDto,
  ) {
    return this.svc.assignSeat(id, dto);
  }

  @Delete('seats/:id/assignment')
  clear(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.clearSeat(id);
  }

  @Post('seats/swap')
  swap(@Body() dto: SwapSeatsDto) {
    return this.svc.swapSeats(dto);
  }
}
