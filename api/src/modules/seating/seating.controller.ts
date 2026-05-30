import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/jwt-auth.guard';
import { ClientContextGuard, CurrentClientId } from '../auth/client-context.guard';
import { SeatingService } from './seating.service';
import {
  AssignSeatDto, AutoFillDto, CreatePlanDto, CreateTableDto, SwapSeatsDto,
  UpdatePlanDto, UpdateTableDto,
} from './dto';

@UseGuards(JwtAuthGuard, ClientContextGuard, RolesGuard)
@Controller('seating')
export class SeatingController {
  constructor(private readonly svc: SeatingService) {}

  // --- plans ---
  @Get('plans')
  @Roles('OWNER', 'EDITOR', 'VIEWER')
  listPlans(@CurrentClientId() clientId: string) {
    return this.svc.listPlans(clientId);
  }

  @Get('plans/:id')
  @Roles('OWNER', 'EDITOR', 'VIEWER')
  getPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.findPlan(id, clientId);
  }

  @Post('plans')
  @Roles('OWNER', 'EDITOR')
  createPlan(
    @Body() dto: CreatePlanDto,
    @Req() req: any,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.createPlan(dto, req.user.id, clientId);
  }

  @Patch('plans/:id')
  @Roles('OWNER', 'EDITOR')
  updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @Req() req: any,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.updatePlan(id, dto, req.user.id, clientId);
  }

  @Post('plans/:id/activate')
  @Roles('OWNER', 'EDITOR')
  activatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.activatePlan(id, req.user.id, clientId);
  }

  @Delete('plans/:id')
  @Roles('OWNER', 'EDITOR')
  removePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.removePlan(id, clientId);
  }

  @Get('plans/:id/unseated')
  @Roles('OWNER', 'EDITOR', 'VIEWER')
  unseated(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.unseatedForPlan(id, clientId);
  }

  @Post('plans/:id/auto-fill')
  @Roles('OWNER', 'EDITOR')
  autoFill(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AutoFillDto,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.autoFill(id, dto, clientId);
  }

  @Post('plans/:id/unseat-all')
  @Roles('OWNER', 'EDITOR')
  unseatAll(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.unseatAll(id, clientId);
  }

  // --- tables ---
  @Post('plans/:id/tables')
  @Roles('OWNER', 'EDITOR')
  addTable(
    @Param('id', ParseUUIDPipe) planId: string,
    @Body() dto: CreateTableDto,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.addTable(planId, dto, clientId);
  }

  @Patch('tables/:id')
  @Roles('OWNER', 'EDITOR')
  updateTable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTableDto,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.updateTable(id, dto, clientId);
  }

  @Delete('tables/:id')
  @Roles('OWNER', 'EDITOR')
  removeTable(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.removeTable(id, clientId);
  }

  // --- seats ---
  @Post('seats/:id/assign')
  @Roles('OWNER', 'EDITOR')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignSeatDto,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.assignSeat(id, dto, clientId);
  }

  @Delete('seats/:id/assignment')
  @Roles('OWNER', 'EDITOR')
  clear(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.clearSeat(id, clientId);
  }

  @Post('seats/swap')
  @Roles('OWNER', 'EDITOR')
  swap(
    @Body() dto: SwapSeatsDto,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.swapSeats(dto, clientId);
  }
}
