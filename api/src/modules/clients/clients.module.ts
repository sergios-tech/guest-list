import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from '../../entities/client.entity';
import { UserClient } from '../../entities/user-client.entity';
import { User } from '../../entities/user.entity';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [TypeOrmModule.forFeature([Client, UserClient, User])],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
