-- 外部記事レビュー: 共有リンク、コメント、変更履歴
CREATE TABLE IF NOT EXISTS article_review_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  permission text NOT NULL CHECK (permission IN ('view', 'comment', 'edit')),
  password_hash text,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_article_review_links_article_id ON article_review_links(article_id);
CREATE INDEX IF NOT EXISTS idx_article_review_links_active ON article_review_links(token_hash) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS article_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  revision_number integer NOT NULL,
  title text NOT NULL,
  excerpt text NOT NULL DEFAULT '',
  content text NOT NULL,
  change_source text NOT NULL CHECK (change_source IN ('owner', 'reviewer', 'restore')),
  author_name text,
  change_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(article_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_article_revisions_article_id ON article_revisions(article_id, revision_number DESC);

CREATE TABLE IF NOT EXISTS article_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  review_link_id uuid REFERENCES article_review_links(id) ON DELETE SET NULL,
  parent_id uuid REFERENCES article_comments(id) ON DELETE CASCADE,
  field text NOT NULL CHECK (field IN ('title', 'excerpt', 'content')),
  selected_text text,
  start_offset integer,
  end_offset integer,
  prefix_context text,
  suffix_context text,
  revision_id uuid REFERENCES article_revisions(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(trim(body)) > 0),
  author_name text NOT NULL CHECK (char_length(trim(author_name)) > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_article_comments_article_id ON article_comments(article_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_comments_parent_id ON article_comments(parent_id);

DROP TRIGGER IF EXISTS update_article_comments_updated_at ON article_comments;
CREATE TRIGGER update_article_comments_updated_at BEFORE UPDATE ON article_comments
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 外部クライアントはテーブルを直接参照しない。Edge Functionのservice_roleだけが利用する。
ALTER TABLE article_review_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_comments ENABLE ROW LEVEL SECURITY;
