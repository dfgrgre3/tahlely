import { useMemo, useState } from 'react';
import { useAppStore } from '../store/app-store.js';
import { Button, EmptyState, Input, PageHeader, Panel, SearchInput } from '../components/design-system.js';

export function Conversations() {
  const conversations = useAppStore((state) => state.conversations);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const messages = useAppStore((state) => state.messages);
  const busy = useAppStore((state) => state.busy);
  const selectConversation = useAppStore((state) => state.selectConversation);
  const newConversation = useAppStore((state) => state.newConversation);
  const deleteConversation = useAppStore((state) => state.deleteConversation);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const visibleConversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query]);
  const visibleMessages = useMemo(() => messages.slice(-200), [messages]);

  const send = () => {
    if (!draft.trim()) return;
    void sendMessage(draft).then(() => setDraft(''));
  };

  return (
    <div>
      <PageHeader
        title="Conversations"
        subtitle={`${conversations.length} threads · ${messages.length} messages in active thread`}
        actions={
          <Button variant="secondary" onClick={() => void newConversation()}>
            New conversation
          </Button>
        }
      />
      <div className="explorer">
        <Panel title={`Threads (${visibleConversations.length}/${conversations.length})`}>
          <SearchInput value={query} onChange={setQuery} placeholder="Filter threads…" />
          <div className="file-list">
            {visibleConversations.length === 0 ? (
              <EmptyState title="No threads match" hint="Clear the filter or start a new conversation." />
            ) : (
              visibleConversations.map((conversation) => (
                <div key={conversation.id} className="file-item-row">
                  <button
                    className={`file-item${conversation.id === activeConversationId ? ' active' : ''}`}
                    onClick={() => void selectConversation(conversation.id)}
                  >
                    {conversation.title} ({conversation.messageCount})
                  </button>
                  <Button
                    variant="ghost"
                    title="Delete conversation"
                    onClick={() => void deleteConversation(conversation.id)}
                  >
                    ✕
                  </Button>
                </div>
              ))
            )}
          </div>
        </Panel>
        <Panel title={`Thread (${visibleMessages.length})`}>
          {visibleMessages.length === 0 ? (
            <EmptyState title="Empty thread" hint="Ask about the active project below." />
          ) : (
            <div className="chat">
              {visibleMessages.map((message) => (
                <div key={message.id} className={`message message-${message.role}`}>
                  <div className="message-role">
                    {message.role} · {message.createdAt}
                  </div>
                  <div className="message-body">{message.body}</div>
                </div>
              ))}
            </div>
          )}
          <div className="chat-input" style={{ marginTop: 12 }}>
            <Input
              value={draft}
              onChange={setDraft}
              placeholder="Ask about the project, findings, or next steps… (Enter to send)"
            />
            <Button disabled={busy || !draft.trim()} onClick={send}>
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
