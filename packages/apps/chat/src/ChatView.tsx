import React from 'react';
import type { AppViewProps } from '@citadel/platform/client';
import { MESSAGE_MAX_LENGTH, type ChatMessage, type ChatState, type TypingUpdatePayload } from './shared.js';

const TYPING_IDLE_TIMEOUT_MS = 1200;
const CHAT_VIEW_STYLES = `
.message-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
  padding: 22px 24px;
}

.message {
  align-self: flex-start;
  background: #eef1ed;
  border-radius: 8px;
  max-width: min(680px, 82%);
  padding: 12px 14px;
}

.message.mine {
  align-self: flex-end;
  background: #dff2ea;
}

.message-meta {
  align-items: center;
  color: #5b6861;
  display: flex;
  gap: 10px;
  justify-content: space-between;
  margin-bottom: 6px;
}

.message-meta strong {
  color: #1f2a24;
}

.message-meta time {
  font-size: 0.8rem;
}

.message p {
  line-height: 1.45;
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.composer {
  border-top: 1px solid #e4e8e5;
  display: grid;
  gap: 10px;
  padding: 16px 24px;
}

.typing-indicator {
  color: #66756c;
  font-size: 0.9rem;
  min-height: 20px;
}

.composer textarea {
  min-height: 70px;
  resize: vertical;
}

.composer-actions {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.composer-actions span {
  color: #65726b;
  font-size: 0.9rem;
}

@media (max-width: 720px) {
  .message-list,
  .composer {
    padding-left: 18px;
    padding-right: 18px;
  }

  .message {
    max-width: 92%;
  }
}
`;

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatTypingText(participants: ChatState['typingParticipants']) {
  if (participants.length === 0) {
    return '';
  }

  if (participants.length === 1) {
    return `${participants[0].name} is typing...`;
  }

  if (participants.length === 2) {
    return `${participants[0].name} and ${participants[1].name} are typing...`;
  }

  const otherCount = participants.length - 2;
  const otherLabel = otherCount === 1 ? 'other' : 'others';
  return `${participants[0].name}, ${participants[1].name}, and ${otherCount} ${otherLabel} are typing...`;
}

export function ChatView({
  currentParticipant,
  appState,
  sendAppEvent,
  setNotice
}: AppViewProps<ChatState>) {
  const [messageDraft, setMessageDraft] = React.useState('');
  const [typingParticipants, setTypingParticipants] = React.useState(appState.typingParticipants ?? []);
  const [timeline, setTimeline] = React.useState<ChatMessage[]>(appState.messages ?? []);
  const listRef = React.useRef<HTMLDivElement>(null);
  const stickToBottomRef = React.useRef(true);
  const typingTimerRef = React.useRef<number | null>(null);
  const isTypingRef = React.useRef(false);

  React.useEffect(() => {
    setTimeline(appState.messages ?? []);
    setTypingParticipants(appState.typingParticipants ?? []);
    stickToBottomRef.current = true;
  }, [appState]);

  React.useEffect(() => {
    function handleAppEvent(rawEvent: Event) {
      const event = (rawEvent as CustomEvent).detail;

      if (event.type === 'chat:message:new') {
        setTimeline((current) => [...current, event.payload as ChatMessage]);
      }

      if (event.type === 'chat:typing:update') {
        const payload = event.payload as TypingUpdatePayload;
        setTypingParticipants(
          payload.participants.filter((participant) => participant.id !== currentParticipant.id)
        );
      }

      if (event.type === 'chat:notice') {
        setNotice((event.payload as { message: string }).message);
      }
    }

    window.addEventListener('citadel:app-event', handleAppEvent);

    return () => {
      window.removeEventListener('citadel:app-event', handleAppEvent);
    };
  }, [currentParticipant.id, setNotice]);

  React.useEffect(() => {
    return () => {
      stopTyping(true);
    };
  }, []);

  React.useEffect(() => {
    if (!stickToBottomRef.current || typeof listRef.current?.scrollTo !== 'function') {
      return;
    }

    listRef.current.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [timeline]);

  function stopTyping(force = false) {
    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    if (!isTypingRef.current && !force) {
      return;
    }

    isTypingRef.current = false;
    sendAppEvent('chat:typing:stop');
  }

  function scheduleTypingStop() {
    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current);
    }

    typingTimerRef.current = window.setTimeout(() => {
      stopTyping();
    }, TYPING_IDLE_TIMEOUT_MS);
  }

  function handleMessageDraftChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value;
    setMessageDraft(nextValue);

    if (!nextValue.trim()) {
      stopTyping();
      return;
    }

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      sendAppEvent('chat:typing:start');
    }

    scheduleTypingStop();
  }

  function handleMessageDraftKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = messageDraft.trim();

    if (!body) {
      setNotice('Type a message before sending.');
      return;
    }

    stopTyping();
    sendAppEvent('chat:message:send', { body });
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

  const messageCount = messageDraft.trim().length;
  const typingText = formatTypingText(typingParticipants);

  return (
    <>
      <style>{CHAT_VIEW_STYLES}</style>
      <div className="message-list" ref={listRef} onScroll={handleScroll}>
        {timeline.length === 0 ? (
          <div className="empty-state">No messages yet. Start the space.</div>
        ) : (
          timeline.map((item) => (
            <article
              className={item.participantId === currentParticipant.id ? 'message mine' : 'message'}
              key={item.id}
            >
              <div className="message-meta">
                <strong>{item.participantName}</strong>
                <time>{formatTime(item.createdAt)}</time>
              </div>
              <p>{item.body}</p>
            </article>
          ))
        )}
      </div>

      <form className="composer" onSubmit={sendMessage}>
        {typingText ? <div className="typing-indicator">{typingText}</div> : null}
        <textarea
          value={messageDraft}
          maxLength={MESSAGE_MAX_LENGTH}
          onChange={handleMessageDraftChange}
          onKeyDown={handleMessageDraftKeyDown}
          placeholder="Write a message"
          rows={2}
        />
        <div className="composer-actions">
          <span>{messageCount}/{MESSAGE_MAX_LENGTH}</span>
          <button disabled={!messageDraft.trim()} type="submit">
            Send
          </button>
        </div>
      </form>
    </>
  );
}
