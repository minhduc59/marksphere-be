import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';

const USER: CurrentUserPayload = { userId: 'user-1', email: 'test@example.com', role: 'user' };

const makeService = () => ({ uploadBuffer: jest.fn() });

const makeFile = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File => ({
  fieldname: 'file',
  originalname: 'video.mp4',
  encoding: '7bit',
  mimetype: 'video/mp4',
  size: 10 * 1024 * 1024, // 10 MB
  buffer: Buffer.from(''),
  stream: null as never,
  destination: '',
  filename: '',
  path: '',
  ...overrides,
});

describe('MediaController', () => {
  let controller: MediaController;
  let service: ReturnType<typeof makeService>;

  beforeEach(async () => {
    service = makeService();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [{ provide: MediaService, useValue: service }],
    }).compile();

    controller = module.get(MediaController);
  });

  describe('uploadVideo', () => {
    it('throws BadRequestException when no file is provided', async () => {
      await expect(
        controller.uploadVideo(USER, undefined as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws PayloadTooLargeException for files over 500 MB', async () => {
      const huge = makeFile({ size: 501 * 1024 * 1024 });
      await expect(controller.uploadVideo(USER, huge)).rejects.toThrow(
        PayloadTooLargeException,
      );
    });

    it('throws BadRequestException for unsupported MIME type', async () => {
      const bad = makeFile({ mimetype: 'video/mpeg' });
      await expect(controller.uploadVideo(USER, bad)).rejects.toThrow(BadRequestException);
    });

    it('calls MediaService.uploadBuffer with sanitized dest key', async () => {
      service.uploadBuffer.mockResolvedValue({
        url: 'https://cdn.example.com/u/video.mp4',
        publicId: 'user-1/uploads/ts_video.mp4',
      });

      const file = makeFile({ originalname: 'my video #1.mp4' });
      const result = await controller.uploadVideo(USER, file);

      expect(service.uploadBuffer).toHaveBeenCalledWith(
        file.buffer,
        expect.stringMatching(/^user-1\/uploads\/\d+_my_video__1\.mp4$/),
        'video/mp4',
      );
      expect(result).toHaveProperty('url');
    });

    it('accepts video/quicktime (MOV) format', async () => {
      service.uploadBuffer.mockResolvedValue({ url: 'https://x.com/v.mov', publicId: 'x' });
      const file = makeFile({ mimetype: 'video/quicktime', originalname: 'clip.mov' });
      await expect(controller.uploadVideo(USER, file)).resolves.toBeDefined();
    });
  });
});
