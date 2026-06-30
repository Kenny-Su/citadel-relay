import express from 'express';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { Server, type Socket } from 'socket.io';
import {
  type AppEventEnvelope,
  type AppId,
  DEFAULT_SPACE_ID,
  type JoinSpacePayload,
  type Participant,
  type SpaceState,
  isAppId,
  normalizeGuestId,
  normalizeSpaceId
} from '../shared/platform.js';
import type { AppManifest, ServerAppContext, ServerAppModule } from './appContract.js';
import { validateDisplayName } from './validation.js';
import { PLATFORM_VERSION } from './version.js';

export type PlatformServerOptions = {
  clientOrigin?: string;
  staticDir?: string;
  apps: ServerAppModule[];
  appManifests?: AppManifest[];
};

type ParticipantSession = {
  appId: AppId;
  spaceId: string;
  participant: Participant;
};

type PlatformMetadata = {
  apps: AppId[];
  appCount: number;
  appManifests: AppManifest[];
  version: string;
};

export function createPlatformServer(options: PlatformServerOptions) {
  const clientOrigin = options.clientOrigin ?? 'http://localhost:5173';
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: clientOrigin,
      methods: ['GET', 'POST']
    }
  });

  const modules = new Map<AppId, ServerAppModule>();
  const manifests = new Map<AppId, AppManifest>();
  const sessions = new Map<string, ParticipantSession>();
  const appState = new Map<string, unknown>();

  for (const module of options.apps) {
    modules.set(module.appId, module);
  }

  for (const manifest of options.appManifests ?? []) {
    if (modules.has(manifest.appId)) {
      manifests.set(manifest.appId, manifest);
    }
  }

  function spaceKey(appId: AppId, spaceId: string) {
    return `${appId}:${spaceId}`;
  }

  function socketRoom(appId: AppId, spaceId: string) {
    return `space:${spaceKey(appId, spaceId)}`;
  }

  function getParticipants(appId: AppId, spaceId: string) {
    return [...sessions.values()]
      .filter((session) => session.appId === appId && session.spaceId === spaceId)
      .map((session) => session.participant)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function makeContext(socket: Socket, session: ParticipantSession): ServerAppContext {
    const key = spaceKey(session.appId, session.spaceId);
    const module = modules.get(session.appId);

    if (!module) {
      throw new Error(`Unknown app module: ${session.appId}`);
    }

    return {
      appId: session.appId,
      spaceId: session.spaceId,
      socketId: socket.id,
      participant: session.participant,
      participants: getParticipants(session.appId, session.spaceId),
      emitToSpace(type, payload) {
        io.to(socketRoom(session.appId, session.spaceId)).emit('app:event', {
          appId: session.appId,
          type,
          payload
        });
      },
      emitToParticipant(type, payload) {
        socket.emit('app:event', {
          appId: session.appId,
          type,
          payload
        });
      },
      emitSpaceState() {
        emitSpaceState(session.appId, session.spaceId);
      },
      getAppState<T>() {
        return appState.get(key) as T | undefined;
      },
      setAppState<T>(state: T) {
        appState.set(key, state);
      },
      clearAppState() {
        appState.delete(key);
      }
    };
  }

  function getSpaceState(appId: AppId, spaceId: string): SpaceState {
    const module = modules.get(appId);

    if (!module) {
      return { appId, spaceId, participants: [], appState: null };
    }

    const key = spaceKey(appId, spaceId);
    const baseContext = {
      appId,
      spaceId,
      participants: getParticipants(appId, spaceId),
      emitToSpace(type: string, payload?: unknown) {
        io.to(socketRoom(appId, spaceId)).emit('app:event', { appId, type, payload });
      },
      emitToParticipant() {},
      emitSpaceState() {
        emitSpaceState(appId, spaceId);
      },
      getAppState<T>() {
        return appState.get(key) as T | undefined;
      },
      setAppState<T>(state: T) {
        appState.set(key, state);
      },
      clearAppState() {
        appState.delete(key);
      }
    };

    return {
      appId,
      spaceId,
      participants: baseContext.participants,
      appState: module.getInitialState(baseContext)
    };
  }

  function emitSpaceState(appId: AppId, spaceId: string) {
    io.to(socketRoom(appId, spaceId)).emit('space:state', getSpaceState(appId, spaceId));
  }

  function leaveCurrentSpace(socket: Socket, notifyParticipant = true) {
    const session = sessions.get(socket.id);

    if (!session) {
      return;
    }

    const module = modules.get(session.appId);
    sessions.delete(socket.id);
    const context = makeContext(socket, session);
    module?.onParticipantLeft?.(context);
    socket.leave(socketRoom(session.appId, session.spaceId));

    if (notifyParticipant) {
      socket.to(socketRoom(session.appId, session.spaceId)).emit('participant:left', {
        id: nanoid(),
        type: 'participant:left',
        appId: session.appId,
        spaceId: session.spaceId,
        participant: session.participant,
        createdAt: new Date().toISOString()
      });
    }

    if (getParticipants(session.appId, session.spaceId).length === 0) {
      appState.delete(spaceKey(session.appId, session.spaceId));
    }

    emitSpaceState(session.appId, session.spaceId);
  }

  function getPlatformMetadata(): PlatformMetadata {
    const apps = [...modules.keys()];

    return {
      apps,
      appCount: apps.length,
      appManifests: apps
        .map((appId) => manifests.get(appId))
        .filter((manifest): manifest is AppManifest => Boolean(manifest)),
      version: PLATFORM_VERSION
    };
  }

  app.get('/health', (_request, response) => {
    response.json({
      ...getPlatformMetadata(),
      ok: true,
      participants: sessions.size
    });
  });

  app.get('/config', (_request, response) => {
    const { apps, appManifests } = getPlatformMetadata();

    response.json({
      apps,
      appManifests
    });
  });

  if (options.staticDir) {
    const indexPath = join(options.staticDir, 'index.html');

    app.use(express.static(options.staticDir, { index: false }));
    app.get(/.*/, (_request, response) => {
      response.sendFile(indexPath);
    });
  }

  io.on('connection', (socket) => {
    socket.on('space:join', (payload: JoinSpacePayload = { appId: 'chat', name: '' }) => {
      const appId = isAppId(payload.appId) ? payload.appId : 'chat';
      const module = modules.get(appId);

      if (!module) {
        socket.emit('error:notice', { message: 'Unknown app.' });
        return;
      }

      const result = validateDisplayName(payload.name);
      const spaceId = normalizeSpaceId(payload.spaceId ?? DEFAULT_SPACE_ID);

      if (!result.ok) {
        socket.emit('error:notice', { message: result.error });
        return;
      }

      const previousSession = sessions.get(socket.id);
      const previousKey = previousSession
        ? spaceKey(previousSession.appId, previousSession.spaceId)
        : null;
      const nextKey = spaceKey(appId, spaceId);

      if (previousSession && previousKey !== nextKey) {
        leaveCurrentSpace(socket);
      }

      const participant: Participant = {
        id: normalizeGuestId(payload.guestId, socket.id),
        socketId: socket.id,
        name: result.value
      };
      const session = { appId, spaceId, participant };
      sessions.set(socket.id, session);
      socket.join(socketRoom(appId, spaceId));

      if (!previousSession || previousKey !== nextKey) {
        socket.to(socketRoom(appId, spaceId)).emit('participant:joined', {
          id: nanoid(),
          type: 'participant:joined',
          appId,
          spaceId,
          participant,
          createdAt: new Date().toISOString()
        });
      }

      module.onParticipantJoined?.(makeContext(socket, session));
      emitSpaceState(appId, spaceId);
    });

    socket.on('app:event', (event: AppEventEnvelope) => {
      const session = sessions.get(socket.id);

      if (!session) {
        socket.emit('error:notice', { message: 'Join a space before sending events.' });
        return;
      }

      if (!event || event.appId !== session.appId) {
        socket.emit('error:notice', { message: 'Event app does not match the current space.' });
        return;
      }

      const module = modules.get(session.appId);
      module?.handleEvent(makeContext(socket, session), event);
    });

    socket.on('disconnect', () => {
      leaveCurrentSpace(socket);
    });
  });

  return {
    app,
    httpServer,
    io,
    apps: modules
  };
}
