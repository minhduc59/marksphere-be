import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { VideoClipsController } from './video-clips.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient } from '../ai-service/ai-service.client';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';

const USER: CurrentUserPayload = { userId: 'user-1', email: 'test@example.com', role: 'user' };

const TASK_ID = 'task-uuid-1';
const SCAN_RUN_ID = 'scan-run-uuid-1';

const makePrisma = () => ({
  videoClip: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  videoTask: {
    findUnique: jest.fn(),
  },
  contentPost: {
    create: jest.fn(),
  },
});

const makeAi = () => ({
  publishNow: jest.fn(),
});

const buildClip = (id: string, status = 'draft') => ({
  id,
  status,
  storageUrl: `https://cdn.example.com/clips/${id}.mp4`,
  llmScore: 0.8,
});

describe('VideoClipsController', () => {
  let controller: VideoClipsController;
  let prisma: ReturnType<typeof makePrisma>;
  let ai: ReturnType<typeof makeAi>;

  beforeEach(async () => {
    prisma = makePrisma();
    ai = makeAi();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VideoClipsController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: AiServiceClient, useValue: ai },
      ],
    }).compile();

    controller = module.get(VideoClipsController);
  });

  describe('reviewClip', () => {
    it('throws NotFoundException when clip not found or owned by another user', async () => {
      prisma.videoClip.findFirst.mockResolvedValue(null);
      await expect(
        controller.reviewClip(USER, 'missing-clip', { action: 'approve' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('approves a clip and returns updated status', async () => {
      const clip = buildClip('clip-1');
      prisma.videoClip.findFirst.mockResolvedValue({
        ...clip,
        task: { id: TASK_ID, userId: USER.userId, clips: [clip] },
      });
      prisma.videoClip.update.mockResolvedValue({ ...clip, status: 'approved' });
      prisma.videoTask.findUnique.mockResolvedValue({ scanRunId: SCAN_RUN_ID });

      const result = await controller.reviewClip(USER, 'clip-1', { action: 'approve' });

      expect(result.status).toBe('approved');
      expect(prisma.videoClip.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'approved' }),
        }),
      );
    });

    it('rejects a clip and returns updated status', async () => {
      const clip = buildClip('clip-1');
      prisma.videoClip.findFirst.mockResolvedValue({
        ...clip,
        task: { id: TASK_ID, userId: USER.userId, clips: [clip] },
      });
      prisma.videoClip.update.mockResolvedValue({ ...clip, status: 'rejected' });
      prisma.videoTask.findUnique.mockResolvedValue({ scanRunId: SCAN_RUN_ID });

      const result = await controller.reviewClip(USER, 'clip-1', {
        action: 'reject',
        feedback: 'Too short',
      });
      expect(result.status).toBe('rejected');
      expect(prisma.videoClip.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ feedback: 'Too short' }),
        }),
      );
    });

    it('triggers publish pipeline for approved clips when all are terminal', async () => {
      const clip1 = buildClip('clip-1');
      const clip2 = { ...buildClip('clip-2'), status: 'rejected' }; // already terminal
      prisma.videoClip.findFirst.mockResolvedValue({
        ...clip1,
        task: { id: TASK_ID, userId: USER.userId, clips: [clip1, clip2] },
      });
      prisma.videoClip.update.mockResolvedValue({ ...clip1, status: 'approved' });
      prisma.videoTask.findUnique.mockResolvedValue({ scanRunId: SCAN_RUN_ID });
      prisma.contentPost.create.mockResolvedValue({ id: 'post-uuid-1' });
      ai.publishNow.mockResolvedValue({});

      const result = await controller.reviewClip(USER, 'clip-1', { action: 'approve' });
      expect(result.allTerminal).toBe(true);
      expect(ai.publishNow).toHaveBeenCalledTimes(1);
      expect(ai.publishNow).toHaveBeenCalledWith(USER.userId, 'post-uuid-1', { mode: 'auto' });
    });

    it('does not trigger publish when not all clips are terminal', async () => {
      const clip1 = buildClip('clip-1');
      const clip2 = buildClip('clip-2'); // still draft
      prisma.videoClip.findFirst.mockResolvedValue({
        ...clip1,
        task: { id: TASK_ID, userId: USER.userId, clips: [clip1, clip2] },
      });
      prisma.videoClip.update.mockResolvedValue({ ...clip1, status: 'approved' });

      const result = await controller.reviewClip(USER, 'clip-1', { action: 'approve' });
      expect(result.allTerminal).toBe(false);
      expect(ai.publishNow).not.toHaveBeenCalled();
    });

    it('skips publish pipeline when task has no scanRunId (standalone video task)', async () => {
      const clip1 = buildClip('clip-1');
      const clip2 = { ...buildClip('clip-2'), status: 'rejected' };
      prisma.videoClip.findFirst.mockResolvedValue({
        ...clip1,
        task: { id: TASK_ID, userId: USER.userId, clips: [clip1, clip2] },
      });
      prisma.videoClip.update.mockResolvedValue({ ...clip1, status: 'approved' });
      prisma.videoTask.findUnique.mockResolvedValue({ scanRunId: null });

      const result = await controller.reviewClip(USER, 'clip-1', { action: 'approve' });
      expect(result.allTerminal).toBe(true);
      expect(ai.publishNow).not.toHaveBeenCalled();
      expect(prisma.contentPost.create).not.toHaveBeenCalled();
    });
  });
});
