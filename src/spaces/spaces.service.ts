import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from '../config/configuration';
import { Space, SpaceRecord, SpaceUser } from '../database/entities';
import { AppSpec, EntitySpec } from './spec/app-spec';
import { validateAppSpec, validateRecordData } from './spec/validate-spec';

/** A Space shaped for the dashboard list/detail. */
export interface SpaceView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: Space['status'];
  url: string;
  entityCount: number;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A Space's public shape, served to the runtime to render the app. */
export interface PublicSpaceView {
  slug: string;
  name: string;
  spec: AppSpec;
}

/**
 * Owns Spaces: creating them from an AI-produced spec, exposing them to the
 * dashboard and runtime, and the generic per-Space record store backing every
 * app's data. No app-specific tables exist — every row lives in `space_records`,
 * validated against the Space's spec before it is written.
 */
@Injectable()
export class SpacesService {
  constructor(
    @InjectRepository(Space)
    private readonly spaceRepository: Repository<Space>,
    @InjectRepository(SpaceRecord)
    private readonly recordRepository: Repository<SpaceRecord>,
    @InjectRepository(SpaceUser)
    private readonly spaceUserRepository: Repository<SpaceUser>,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Validate an AI-produced spec and persist it as a new Space for the
   * workspace, assigning a unique URL slug derived from the app name.
   */
  async createFromSpec(
    workspaceId: string,
    userId: string | null,
    specInput: unknown,
  ): Promise<Space> {
    const spec = validateAppSpec(specInput);
    const slug = await this.uniqueSlug(spec.name);
    const space = this.spaceRepository.create({
      workspaceId,
      createdByUserId: userId,
      slug,
      name: spec.name,
      description: spec.description ?? null,
      spec,
      status: 'published',
    });
    return this.spaceRepository.save(space);
  }

  /** Replace the spec of an existing Space (re-validated). */
  async updateSpec(workspaceId: string, slug: string, specInput: unknown): Promise<Space> {
    const space = await this.findBySlugForWorkspace(workspaceId, slug);
    const spec = validateAppSpec(specInput);
    space.spec = spec;
    space.name = spec.name;
    space.description = spec.description ?? null;
    return this.spaceRepository.save(space);
  }

  /** Every Space in a workspace, newest first. */
  async findForWorkspace(workspaceId: string): Promise<SpaceView[]> {
    const spaces = await this.spaceRepository.find({
      where: { workspaceId },
      order: { createdAt: 'DESC' },
    });
    return spaces.map((space) => this.toView(space));
  }

  /** One Space by id, scoped to its workspace. */
  async findOneForWorkspace(workspaceId: string, id: string): Promise<SpaceView> {
    const space = await this.spaceRepository.findOne({ where: { id, workspaceId } });
    if (!space) throw new NotFoundException('Space not found');
    return this.toView(space);
  }

  /** Delete a Space (cascades to its members, tokens, and records). */
  async deleteForWorkspace(workspaceId: string, id: string): Promise<{ success: boolean }> {
    const result = await this.spaceRepository.delete({ id, workspaceId });
    if (!result.affected) throw new NotFoundException('Space not found');
    return { success: true };
  }

  /** The public spec served to the runtime to render the app. */
  async findPublicBySlug(slug: string): Promise<PublicSpaceView> {
    const space = await this.findPublishedBySlug(slug);
    return { slug: space.slug, name: space.name, spec: space.spec };
  }

  /** The full entity, by slug, regardless of workspace (runtime use). */
  async findPublishedBySlug(slug: string): Promise<Space> {
    const space = await this.spaceRepository.findOne({
      where: { slug, status: 'published' },
    });
    if (!space) throw new NotFoundException('Space not found');
    return space;
  }

  /** The Space's end-users, for the dashboard detail view. */
  listMembers(spaceId: string): Promise<SpaceUser[]> {
    return this.spaceUserRepository.find({
      where: { spaceId },
      order: { createdAt: 'ASC' },
    });
  }

  // ---- Generic record store (end-user data) --------------------------------

  /** Create a record for one of a Space's entities, validated against its spec. */
  async createRecord(
    space: Space,
    entityName: string,
    data: unknown,
    spaceUserId: string | null,
  ): Promise<SpaceRecord> {
    const entity = this.entityOrFail(space, entityName);
    const clean = validateRecordData(entity, data);
    const record = this.recordRepository.create({
      spaceId: space.id,
      entityName: entity.name,
      data: clean,
      createdBySpaceUserId: spaceUserId,
    });
    return this.recordRepository.save(record);
  }

  /** All records for one entity of a Space, newest first. */
  async listRecords(space: Space, entityName: string): Promise<SpaceRecord[]> {
    const entity = this.entityOrFail(space, entityName);
    return this.recordRepository.find({
      where: { spaceId: space.id, entityName: entity.name },
      order: { createdAt: 'DESC' },
    });
  }

  /** Update a record in place after re-validating its data. */
  async updateRecord(
    space: Space,
    entityName: string,
    recordId: string,
    data: unknown,
  ): Promise<SpaceRecord> {
    const entity = this.entityOrFail(space, entityName);
    const record = await this.recordRepository.findOne({
      where: { id: recordId, spaceId: space.id, entityName: entity.name },
    });
    if (!record) throw new NotFoundException('Record not found');
    record.data = validateRecordData(entity, data);
    return this.recordRepository.save(record);
  }

  /** Delete one record of a Space. */
  async deleteRecord(
    space: Space,
    entityName: string,
    recordId: string,
  ): Promise<{ success: boolean }> {
    const entity = this.entityOrFail(space, entityName);
    const result = await this.recordRepository.delete({
      id: recordId,
      spaceId: space.id,
      entityName: entity.name,
    });
    if (!result.affected) throw new NotFoundException('Record not found');
    return { success: true };
  }

  /** Absolute URL where the deployed app is reachable. */
  spaceUrl(slug: string): string {
    const frontendUrl = this.configService.get('app.frontendUrl', { infer: true });
    return `${frontendUrl.replace(/\/$/, '')}/s/${slug}`;
  }

  private entityOrFail(space: Space, entityName: string): EntitySpec {
    const entity = space.spec.entities.find((e) => e.name === entityName);
    if (!entity) throw new NotFoundException(`Unknown entity "${entityName}"`);
    return entity;
  }

  private async findBySlugForWorkspace(workspaceId: string, slug: string): Promise<Space> {
    const space = await this.spaceRepository.findOne({ where: { slug, workspaceId } });
    if (!space) throw new NotFoundException('Space not found');
    return space;
  }

  /** Slugify the app name and append a numeric suffix until it is unique. */
  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'app';
    let candidate = base;
    let suffix = 1;
    while (await this.spaceRepository.exists({ where: { slug: candidate } })) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }

  private toView(space: Space): SpaceView {
    return {
      id: space.id,
      slug: space.slug,
      name: space.name,
      description: space.description,
      status: space.status,
      url: this.spaceUrl(space.slug),
      entityCount: space.spec.entities.length,
      viewCount: space.spec.views.length,
      createdAt: space.createdAt,
      updatedAt: space.updatedAt,
    };
  }
}
