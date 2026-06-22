import React from 'react';
import { io } from 'socket.io-client';
import {
  DEFAULT_ROOM_ID,
  DISPLAY_NAME_MAX_LENGTH,
  MESSAGE_MAX_LENGTH,
  normalizeRoomId,
  type ChatMessage,
  type RoomState,
  type ServerErrorPayload,
  type SystemEvent,
  type TimelineItem,
  type User
} from '../shared/chat';

const socket = io({
  autoConnect: false
});

const DISPLAY_NAME_STORAGE_KEY = 'citadel.displayName';

function getRoomIdFromPath() {
  const [, roomsSegment, roomSegment] = window.location.pathname.split('/');

  if (roomsSegment !== 'rooms') {
    return DEFAULT_ROOM_ID;
  }

  return normalizeRoomId(roomSegment);
}

function getRoomPath(roomId: string) {
  return `/rooms/${roomId}`;
}

function syncRoomPath(roomId: string, mode: 'push' | 'replace' = 'push') {
  const path = getRoomPath(roomId);

  if (window.location.pathname === path) {
    return;
  }

  window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', path);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function normalizeDisplayName(input: unknown) {
  if (typeof input !== 'string') {
    return null;
  }

  const value = input.trim().replace(/\s+/g, ' ');

  if (!value || value.length > DISPLAY_NAME_MAX_LENGTH) {
    return null;
  }

  return value;
}

function loadStoredDisplayName() {
  try {
    const value = normalizeDisplayName(window.localStorage.getItem(DISPLAY_NAME_STORAGE_KEY));

    if (!value) {
      window.localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
      return '';
    }

    return value;
  } catch {
    return '';
  }
}

function saveStoredDisplayName(name: string) {
  try {
    window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, name);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function clearStoredDisplayName() {
  try {
    window.localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export function App() {
  const initialDisplayName = React.useMemo(() => loadStoredDisplayName(), []);
  const [roomId, setRoomId] = React.useState(getRoomIdFromPath);
  const [roomDraft, setRoomDraft] = React.useState(getRoomIdFromPath);
  const [displayName, setDisplayName] = React.useState(initialDisplayName);
  const [joinedName, setJoinedName] = React.useState(initialDisplayName);
  const [messageDraft, setMessageDraft] = React.useState('');
  const [connected, setConnected] = React.useState(false);
  const [users, setUsers] = React.useState<User[]>([]);
  const [timeline, setTimeline] = React.useState<TimelineItem[]>([]);
  const [notice, setNotice] = React.useState('');
  const listRef = React.useRef<HTMLDivElement>(null);
  const stickToBottomRef = React.useRef(true);

  React.useEffect(() => {
    syncRoomPath(roomId, 'replace');

    function handlePopState() {
      setRoomId(getRoomIdFromPath());
    }

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  React.useEffect(() => {
    setRoomDraft(roomId);
    setUsers([]);
    setTimeline([]);
    stickToBottomRef.current = true;
  }, [roomId]);

  React.useEffect(() => {
    function handleConnect() {
      setConnected(true);
      setNotice('');
    }

    function handleDisconnect() {
      setConnected(false);
      setNotice('Connection lost. Reconnecting...');
    }

    function handleRoomState(state: RoomState) {
      if (state.roomId !== roomId) {
        return;
      }

      setUsers(state.users);
      setTimeline((current) => {
        const systemItems = current.filter((item) => item.kind === 'system');
        return [
          ...state.messages.map((message) => ({ kind: 'message', ...message }) as TimelineItem),
          ...systemItems
        ].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      });
    }

    function handleNewMessage(message: ChatMessage) {
      if (message.roomId !== roomId) {
        return;
      }

      setTimeline((current) => [...current, { kind: 'message', ...message }]);
    }

    function handleSystemEvent(event: SystemEvent) {
      setTimeline((current) => [...current, { kind: 'system', ...event }]);
    }

    function handleError(payload: ServerErrorPayload) {
      setNotice(payload.message);
    }

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('room:state', handleRoomState);
    socket.on('message:new', handleNewMessage);
    socket.on('user:joined', handleSystemEvent);
    socket.on('user:left', handleSystemEvent);
    socket.on('error:notice', handleError);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('room:state', handleRoomState);
      socket.off('message:new', handleNewMessage);
      socket.off('user:joined', handleSystemEvent);
      socket.off('user:left', handleSystemEvent);
      socket.off('error:notice', handleError);
    };
  }, [joinedName, roomId]);

  React.useEffect(() => {
    if (!joinedName) {
      return;
    }

    if (!socket.connected) {
      socket.connect();
      return;
    }

    socket.emit('join', { name: joinedName, roomId });
  }, [connected, joinedName, roomId]);

  React.useEffect(() => {
    if (!stickToBottomRef.current) {
      return;
    }

    if (typeof listRef.current?.scrollTo !== 'function') {
      return;
    }

    listRef.current.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [timeline]);

  function joinRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = normalizeDisplayName(displayName);

    if (!name) {
      setNotice('Enter a display name.');
      return;
    }

    setDisplayName(name);
    setJoinedName(name);
    saveStoredDisplayName(name);
    setNotice('');
  }

  function changeIdentity() {
    const previousName = joinedName;

    clearStoredDisplayName();
    setJoinedName('');
    setDisplayName(previousName);
    setUsers([]);
    setTimeline([]);
    setConnected(false);
    socket.disconnect();
  }

  function switchRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextRoomId = normalizeRoomId(roomDraft);

    setNotice('');
    setRoomId(nextRoomId);
    syncRoomPath(nextRoomId);
  }

  function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = messageDraft.trim();

    if (!body) {
      setNotice('Type a message before sending.');
      return;
    }

    socket.emit('message:send', { body });
    setMessageDraft('');
    setNotice('');
  }

  function handleScroll() {
    const element = listRef.current;

    if (!element) {
      return;
    }

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }

  const canSend = connected && joinedName && messageDraft.trim().length > 0;
  const messageCount = messageDraft.trim().length;

  return (
    <main className="app-shell">
      <section className="chat-panel" aria-label="Chat room">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Room</p>
            <h1>Citadel Chat</h1>
            <p className="room-label">#{roomId}</p>
          </div>
          <div className="header-actions">
            <form className="room-switcher" onSubmit={switchRoom}>
              <label className="sr-only" htmlFor="roomName">
                Room name
              </label>
              <input
                id="roomName"
                value={roomDraft}
                maxLength={32}
                onChange={(event) => setRoomDraft(event.target.value)}
                placeholder="general"
              />
              <button type="submit">Go</button>
            </form>
            <div className={connected ? 'status online' : 'status'}>
              <span aria-hidden="true" />
              {connected ? 'Online' : 'Offline'}
            </div>
          </div>
        </header>

        {!joinedName ? (
          <form className="join-card" onSubmit={joinRoom}>
            <label htmlFor="displayName">Choose a display name</label>
            <div className="join-row">
              <input
                id="displayName"
                value={displayName}
                maxLength={24}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="nickname"
              />
              <button type="submit">Join</button>
            </div>
          </form>
        ) : (
          <>
            <div className="identity-bar">
              <span>
                Chatting as <strong>{joinedName}</strong>
              </span>
              <button type="button" onClick={changeIdentity}>
                Change
              </button>
            </div>
            <div className="message-list" ref={listRef} onScroll={handleScroll}>
              {timeline.length === 0 ? (
                <div className="empty-state">No messages yet. Start the room.</div>
              ) : (
                timeline.map((item) =>
                  item.kind === 'system' ? (
                    <div className="system-line" key={item.id}>
                      {item.user.name} {item.type === 'user:joined' ? 'joined' : 'left'} at{' '}
                      {formatTime(item.createdAt)}
                    </div>
                  ) : (
                    <article
                      className={item.userName === joinedName ? 'message mine' : 'message'}
                      key={item.id}
                    >
                      <div className="message-meta">
                        <strong>{item.userName}</strong>
                        <time>{formatTime(item.createdAt)}</time>
                      </div>
                      <p>{item.body}</p>
                    </article>
                  )
                )
              )}
            </div>

            <form className="composer" onSubmit={sendMessage}>
              <textarea
                value={messageDraft}
                maxLength={MESSAGE_MAX_LENGTH}
                onChange={(event) => setMessageDraft(event.target.value)}
                placeholder="Write a message"
                rows={2}
              />
              <div className="composer-actions">
                <span>{messageCount}/{MESSAGE_MAX_LENGTH}</span>
                <button disabled={!canSend} type="submit">
                  Send
                </button>
              </div>
            </form>
          </>
        )}

        {notice ? <p className="notice">{notice}</p> : null}
      </section>

      <aside className="presence-panel" aria-label="Online users">
        <div className="presence-heading">
          <h2>Online</h2>
          <span>{users.length}</span>
        </div>
        {users.length === 0 ? (
          <p className="muted">Join the room to see who is here.</p>
        ) : (
          <ul>
            {users.map((user) => (
              <li key={user.id}>
                <span aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
                {user.name}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </main>
  );
}
