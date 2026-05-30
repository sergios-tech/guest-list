import {
  ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Client } from '../../entities/client.entity';
import { UserClient } from '../../entities/user-client.entity';
import { User } from '../../entities/user.entity';
import {
  CreateClientDto, UpdateClientDto, AddMemberDto, UpdateMemberDto,
} from './dto';

// All methods here are reachable only behind SuperAdminGuard (see controller):
// this is the platform-admin surface, so it is NOT tenant-scoped — a super-admin
// operates across all clients.
@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client) private readonly clients: Repository<Client>,
    @InjectRepository(UserClient) private readonly memberships: Repository<UserClient>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  list() {
    return this.clients.find({ order: { name: 'ASC' } });
  }

  async create(dto: CreateClientDto) {
    return this.clients.save(this.clients.create(dto));
  }

  private async getOr404(id: string): Promise<Client> {
    const client = await this.clients.findOne({ where: { id } });
    if (!client) throw new NotFoundException(`Client ${id} not found`);
    return client;
  }

  async update(id: string, dto: UpdateClientDto) {
    const client = await this.getOr404(id);
    Object.assign(client, dto);
    return this.clients.save(client);
  }

  // Deletes the client and (via ON DELETE CASCADE) all of its invitations,
  // seating plans, and memberships. Destructive — the UI confirms first and
  // this is super-admin-only.
  async remove(id: string) {
    const client = await this.getOr404(id);
    await this.clients.remove(client);
    return { id, deleted: true };
  }

  async listMembers(clientId: string) {
    await this.getOr404(clientId);
    const rows = await this.memberships.find({
      where: { clientId },
      relations: ['user'],
    });
    return rows.map((m) => ({
      userId: m.userId,
      email: m.user?.email ?? '',
      displayName: m.user?.displayName ?? '',
      role: m.role,
    }));
  }

  async addMember(clientId: string, dto: AddMemberDto) {
    await this.getOr404(clientId);
    const user = dto.userId
      ? await this.users.findOne({ where: { id: dto.userId, deletedAt: IsNull() } })
      : await this.users.findOne({ where: { email: dto.email, deletedAt: IsNull() } });
    if (!user) throw new NotFoundException('User not found');

    const existing = await this.memberships.findOne({
      where: { clientId, userId: user.id },
    });
    if (existing) throw new ConflictException('User is already a member of this client');

    await this.memberships.save(
      this.memberships.create({ clientId, userId: user.id, role: dto.role }),
    );
    return { userId: user.id, email: user.email, displayName: user.displayName, role: dto.role };
  }

  async updateMember(clientId: string, userId: string, dto: UpdateMemberDto) {
    const membership = await this.memberships.findOne({ where: { clientId, userId } });
    if (!membership) throw new NotFoundException('Membership not found');
    membership.role = dto.role;
    await this.memberships.save(membership);
    return { userId, role: dto.role };
  }

  async removeMember(clientId: string, userId: string) {
    const res = await this.memberships.delete({ clientId, userId });
    if (!res.affected) throw new NotFoundException('Membership not found');
    return { userId, removed: true };
  }
}
