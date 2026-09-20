import { useState } from 'react';
import { useAppStore } from '../store/app-store.js';
import { Button, EmptyState, Input, Panel } from '../components/design-system.js';

export function Conversations() {
  const conversations = useAppStore((state) => state.conversations);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const messages = useAppStore((state) => state.messages);
  const busy = useAppStore((state) => state.busy);
  const selectConversation = useAppStore((state) => state.selectConversation);
  const newConversation = useAppStore((state) => state.newConversation);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const [draft, setDraft] = useState('');

  const send = () => {
    if (!draft.trim()) return;
    void sendMessage(draft).then(() => setDraft(''));
  };

  return (
    <div>
      <div className="topbar">
        <h1>Conversations</h1>
        <div className="spacer" />
        <Button variant="secondary" onClick={() => void newConversation()}>
          New conversation
        </Button>
      </div>
      <div className="explorer">
        <Panel title={`Threads (${conversations.length})`}>
          <div className="file-list">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={`file-item${conversation.id === activeConversationId ? ' active' : ''}`}
                onClick={() => void selectConversation(conversation.id)}
              >
                {conversation.title} ({conversation.messageCount})
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Thread">
          {messages.length === 0 ? (
            <EmptyState title="Empty thread" hint="Ask about the active project below." />
          ) : (
            <div className="chat">
              {messages.map((message) => (
                <div key={message.id} className={`message message-${message.role}`}>
                  <div className="message-role">{message.role}</div>
                  <div className="message-body">{message.body}</div>
                </div>
              ))}
            </div>
          )}
          <div className="chat-input" style={{ marginTop: 12 }}>
            <Input
              value={draft}
              onChange={setDraft}
              placeholder="Ask about the project, findings, or next steps…"
            />
            <Button disabled={busy || !draft.trim()} onClick={send}>
              Send
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
