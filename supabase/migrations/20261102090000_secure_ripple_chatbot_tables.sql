-- Chat Edge Function uses service_role (verified against deployed source).
-- Private chatbot storage must not be accessible directly by API clients.
BEGIN;

ALTER TABLE ripple_chatbot.bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ripple_chatbot.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ripple_chatbot.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ripple_chatbot.page_chunks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE ripple_chatbot.bots, ripple_chatbot.chat_sessions,
  ripple_chatbot.chat_messages, ripple_chatbot.page_chunks
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE ripple_chatbot.bots, ripple_chatbot.chat_sessions,
  ripple_chatbot.chat_messages, ripple_chatbot.page_chunks TO service_role;

COMMIT;
