import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import Redis from 'ioredis';
import { AiServiceClient } from '../ai-service/ai-service.client';

interface AuthedSocket extends Socket {
  data: {
    userId?: string;
    email?: string;
    role?: 'admin' | 'user';
    subscriptions?: Set<string>; // `scan:<id>` | `publish:<id>` | `video:<id>`
  };
}

/**
 * WebSocket status gateway.
 *
 * - JWT authenticated via handshake `auth.token` (or `?token=` fallback).
 * - Clients subscribe to rooms:  `scan:<scanId>` or `publish:<publishId>`.
 * - The gateway polls ai-service every `POLL_INTERVAL_MS` for each
 *   actively-subscribed room and emits events:
 *     - `scan.progress`        — while scan is still running
 *     - `scan.completed`       — once terminal status is reached
 *     - `publish.status_changed` — on any publish status change
 *
 * This lets the frontend show live progress without polling itself.
 * For v2 we'd swap the polling loop for a Redis pub/sub subscription.
 */
@WebSocketGateway({ namespace: '/ws', cors: { origin: true, credentials: true } })
export class StatusGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(StatusGateway.name);
  private static readonly POLL_INTERVAL_MS = 2_000;

  @WebSocketServer() server!: Namespace;

  /** roomId -> setInterval handle */
  private readonly pollers = new Map<string, NodeJS.Timeout>();
  /** roomId -> last known status (used to decide whether to emit) */
  private readonly lastStatus = new Map<string, string>();
  /** video roomId -> dedicated Redis subscriber connection */
  private readonly videoSubscribers = new Map<string, Redis>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly ai: AiServiceClient,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        (client.handshake.query?.token as string | undefined);
      if (!token) throw new Error('missing token');
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        email: string;
        role: 'admin' | 'user';
      }>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      client.data.userId = payload.sub;
      client.data.email = payload.email;
      client.data.role = payload.role;
      client.data.subscriptions = new Set();
      this.logger.log(`ws connected: ${payload.email}`);
    } catch (err) {
      this.logger.warn(`ws auth failed: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket): void {
    const rooms = client.data.subscriptions ?? new Set<string>();
    for (const room of rooms) {
      if (room.startsWith('video:')) {
        this.maybeStopVideoSubscriber(room);
      } else {
        this.maybeStopPolling(room);
      }
    }
  }

  @SubscribeMessage('subscribe')
  subscribe(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { resource: 'scan' | 'publish' | 'video'; id: string },
  ) {
    if (!payload?.resource || !payload?.id) return { ok: false };
    const room = `${payload.resource}:${payload.id}`;
    client.join(room);
    client.data.subscriptions?.add(room);
    if (payload.resource === 'video') {
      this.ensureVideoSubscriber(room, payload.id);
    } else {
      this.ensurePolling(room, client.data.userId!);
    }
    return { ok: true, room };
  }

  @SubscribeMessage('unsubscribe')
  unsubscribe(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { resource: 'scan' | 'publish' | 'video'; id: string },
  ) {
    if (!payload?.resource || !payload?.id) return { ok: false };
    const room = `${payload.resource}:${payload.id}`;
    client.leave(room);
    client.data.subscriptions?.delete(room);
    if (payload.resource === 'video') {
      this.maybeStopVideoSubscriber(room);
    } else {
      this.maybeStopPolling(room);
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------------
  // Polling management — one interval per subscribed room. When the last
  // subscriber leaves, we stop the interval to avoid wasted traffic.
  // ---------------------------------------------------------------------

  private ensurePolling(room: string, userId: string): void {
    if (this.pollers.has(room)) return;
    const handle = setInterval(async () => {
      try {
        await this.tick(room, userId);
      } catch (err) {
        this.logger.warn(`poll ${room} failed: ${(err as Error).message}`);
      }
    }, StatusGateway.POLL_INTERVAL_MS);
    this.pollers.set(room, handle);
  }

  private maybeStopPolling(room: string): void {
    const stillSubscribed =
      (this.server.adapter?.rooms.get(room)?.size ?? 0) > 0;
    if (stillSubscribed) return;
    const handle = this.pollers.get(room);
    if (handle) {
      clearInterval(handle);
      this.pollers.delete(room);
      this.lastStatus.delete(room);
    }
  }

  // -------------------------------------------------------------------------
  // Video room — Redis pub/sub (one subscriber connection per active task).
  // The ai-service worker publishes to `video:progress:{taskId}`; we
  // subscribe here and rebroadcast to the WebSocket room `video:{taskId}`.
  // -------------------------------------------------------------------------

  private ensureVideoSubscriber(room: string, taskId: string): void {
    if (this.videoSubscribers.has(room)) return;
    const redisUrl = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    const sub = new Redis(redisUrl);
    const channel = `video:progress:${taskId}`;
    sub.subscribe(channel, (err) => {
      if (err) this.logger.error(`Redis subscribe failed for ${channel}: ${err.message}`);
    });
    sub.on('message', (_ch: string, message: string) => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(message) as Record<string, unknown>;
      } catch {
        return;
      }
      const status = payload['status'] as string | undefined;
      if (status === 'completed') {
        this.server.to(room).emit('video.completed', payload);
        this.maybeStopVideoSubscriber(room);
      } else if (status === 'error') {
        this.server.to(room).emit('video.error', payload);
        this.maybeStopVideoSubscriber(room);
      } else {
        this.server.to(room).emit('video.progress', payload);
      }
    });
    sub.on('error', (err: Error) => {
      this.logger.warn(`Redis subscriber error for ${room}: ${err.message}`);
    });
    this.videoSubscribers.set(room, sub);
  }

  private maybeStopVideoSubscriber(room: string): void {
    const stillSubscribed =
      (this.server.adapter?.rooms.get(room)?.size ?? 0) > 0;
    if (stillSubscribed) return;
    const sub = this.videoSubscribers.get(room);
    if (sub) {
      sub.disconnect();
      this.videoSubscribers.delete(room);
    }
  }

  // Called from publisher webhook handlers to push real-time events
  notifyRoom(room: string, event: string, data: unknown): void {
    this.server.to(room).emit(event, data);
  }

  private async tick(room: string, userId: string): Promise<void> {
    const [kind, id] = room.split(':');
    if (kind === 'scan') {
      const status = (await this.ai.getScanStatus(userId, id)) as {
        status: string;
      };
      const stepKey = `${status.status}:${(status as Record<string, unknown>).current_step ?? ''}`;
      if (this.lastStatus.get(room) !== stepKey) {
        this.lastStatus.set(room, stepKey);
        this.server.to(room).emit('scan.progress', status);
      }
      if (['completed', 'partial', 'failed'].includes(status.status)) {
        this.server.to(room).emit('scan.completed', status);
        const handle = this.pollers.get(room);
        if (handle) {
          clearInterval(handle);
          this.pollers.delete(room);
        }
      }
    } else if (kind === 'publish') {
      const status = (await this.ai.getPublishStatus(userId, id)) as {
        status: string;
      };
      if (this.lastStatus.get(room) !== status.status) {
        this.lastStatus.set(room, status.status);
        this.server.to(room).emit('publish.status_changed', status);
      }
      if (['published', 'failed', 'cancelled'].includes(status.status)) {
        const handle = this.pollers.get(room);
        if (handle) {
          clearInterval(handle);
          this.pollers.delete(room);
        }
      }
    }
  }
}
