// 投稿状態と検索を一つの条件にまとめ、複数のor条件が上書きされるのを防ぐ。
export function buildArticleSearchFilter(searchTerm = '', postState?: string): string | undefined {
  const conditions: string[] = [];
  if (postState === 'published') {
    conditions.push('or(is_published.eq.true,status.eq.published,wordpress_post_id.not.is.null,wordpress_url.not.is.null)');
  } else if (postState === 'unpublished') {
    conditions.push('or(is_published.is.null,is_published.eq.false)');
  }
  const terms = [...new Set(searchTerm.trim().split(/\s+/u).filter(Boolean))];
  for (const term of terms) {
    const pattern = JSON.stringify(`%${term.replace(/[\\%_]/g, '\\$&')}%`);
    conditions.push(`or(title.ilike.${pattern},content.ilike.${pattern})`);
  }
  return conditions.length ? `and(${conditions.join(',')})` : undefined;
}
