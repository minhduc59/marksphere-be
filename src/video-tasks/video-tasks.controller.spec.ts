import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { VideoTasksController } from './video-tasks.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient } from '../ai-service/ai-service.client';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';

const USER: CurrentUserPayload = { userId: 'user-1', email: 'test@example.com', role: 'user' };

const makePrisma = () => ({
  videoTask: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
});

const makeAi = () => ({
  triggerVideoPipeline: jest.fn(),
});

describe('VideoTasksController', () => {
  let controller: VideoTasksController;
  let prisma: ReturnType<typeof makePrisma>;
  let ai: ReturnType<typeof makeAi>;

  beforeEach(async () => {
    prisma = makePrisma();
    ai = makeAi();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VideoTasksController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: AiServiceClient, useValue: ai },
      ],
    }).compile();

    controller = module.get(VideoTasksController);
  });

  describe('create', () => {
    it('creates a video task and returns taskId + status', async () => {
      const created = { id: 'task-uuid', status: 'queued' };
      prisma.videoTask.create.mockResolvedValue(created);

      const result = await controller.create(USER, {
        sourceType: 'url',
        sourceRef: 'https://youtube.com/watch?v=abc',
        maxClips: 3,
      });

      expect(result).toEqual({ taskId: 'task-uuid', status: 'queued' });
      expect(prisma.videoTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: USER.userId,
            sourceType: 'url',
            maxClips: 3,
            status: 'queued',
            progress: 0,
          }),
        }),
      );
    });

    it('uses default maxClips=5 when not provided', async () => {
      prisma.videoTask.create.mockResolvedValue({ id: 't', status: 'queued' });
      await controller.create(USER, { sourceType: 'upload', sourceRef: 'https://cdn.example.com/v.mp4' });
      expect(prisma.videoTask.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ maxClips: 5 }) }),
      );
    });
  });

  describe('getOne', () => {
    it('returns task with clips when found', async () => {
      const task = { id: 'task-uuid', clips: [] };
      prisma.videoTask.findFirst.mockResolvedValue(task);

      const result = await controller.getOne(USER, 'task-uuid');
      expect(result).toBe(task);
    });

    it('throws NotFoundException when task not found', async () => {
      prisma.videoTask.findFirst.mockResolvedValue(null);
      await expect(controller.getOne(USER, 'missing-id')).rejects.toThrow(NotFoundException);
    });

    it('enforces user ownership via userId filter', async () => {
      prisma.videoTask.findFirst.mockResolvedValue(null);
      await expect(controller.getOne(USER, 'task-uuid')).rejects.toThrow(NotFoundException);
      expect(prisma.videoTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: USER.userId }),
        }),
      );
    });
  });

  describe('triggerPipeline', () => {
    it('calls AiServiceClient.triggerVideoPipeline and returns result', async () => {
      prisma.videoTask.findFirst.mockResolvedValue({ id: 'task-uuid' });
      ai.triggerVideoPipeline.mockResolvedValue({ jobId: 'job-1', status: 'queued' });

      const result = await controller.triggerPipeline(USER, 'task-uuid');
      expect(result).toEqual({ jobId: 'job-1', status: 'queued' });
      expect(ai.triggerVideoPipeline).toHaveBeenCalledWith(USER.userId, 'task-uuid');
    });

    it('throws NotFoundException when task not found', async () => {
      prisma.videoTask.findFirst.mockResolvedValue(null);
      await expect(controller.triggerPipeline(USER, 'missing')).rejects.toThrow(NotFoundException);
      expect(ai.triggerVideoPipeline).not.toHaveBeenCalled();
    });
  });
});
