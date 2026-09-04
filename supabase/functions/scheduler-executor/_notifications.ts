// Chatwork 通知（成功・失敗・ファクトチェック）
import { getFirstScheduleKeyword, trimForLog, type Schedule, type WordPressConfig } from './_shared.ts';
import { formatScheduleFailureReason } from './_execution-state.ts';

export async function sendChatworkNotifications(
  apiToken: string,
  roomIdsStr: string,
  template: string,
  title: string,
  url: string,
  keyword: string,
  status: string
): Promise<void> {
  const roomIds = Array.from(new Set(String(roomIdsStr || '')
    .split(/[\s,]+/)
    .map((value) => {
      const room = value.trim();
      const match = room.match(/(?:rid|rooms\/)(\d+)/i);
      return match?.[1] || (/^\d+$/.test(room) ? room : '');
    })
    .filter(Boolean)));

  if (roomIds.length === 0) return;

  // 驛｢譎｢・ｽ・｡驛｢譏ｴ繝ｻ邵ｺ譎会ｽｹ譎｢・ｽ・ｼ驛｢・ｧ繝ｻ・ｸ驍ｵ・ｺ繝ｻ・ｮ髫ｶ蝣､霍昴・・ｯ郢晢ｽｻ
  let body = template;
  if (!body) {
    body = `予約投稿が完了しました。

タイトル:
{title}

キーワード:
{keyword}

投稿URL:
{url}

投稿状態:
{status}`;
  }

  // 髯樊ｺｽ蛻､霎溷､績繝ｻ・ｮ髫ｰ・ｰ郢晢ｽｻ
  body = body
    .replace(/{title}/g, title)
    .replace(/{url}/g, url)
    .replace(/{status}/g, status);

  const keywordValue = String(keyword || '').trim();
  const normalizedLines = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const filteredLines: string[] = [];

  for (const rawLine of normalizedLines) {
    const line = String(rawLine || '');

    if (!keywordValue && line.includes('{keyword}')) {
      continue;
    }

    const replaced = line.replace(/{keyword}/g, keywordValue);
    if (!keywordValue) {
      const trimmed = replaced.trim();
      if (/^(?:キーワード|Keyword)[:：]?\s*$/i.test(trimmed)) {
        continue;
      }
    }

    filteredLines.push(replaced);
  }

  body = filteredLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const errors = [];

  for (const roomId of roomIds) {
    try {
      const response = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: {
          'X-ChatWorkToken': apiToken,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body: `body=${encodeURIComponent(body)}`
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Status ${response.status}: ${text}`);
      }
      console.log(`Chatwork message sent to room ${roomId}`);
    } catch (error) {
      console.error(`Failed to send to Chatwork room ${roomId}:`, error);
      errors.push(error);
    }
  }
}


export async function notifyScheduleExecutionFailure(
  schedule: Schedule,
  wpConfig: WordPressConfig,
  chatworkApiToken: string | null,
  error: unknown
): Promise<void> {
  const roomIds = String(schedule.fact_check_alert_chatwork_room_id || schedule.chatwork_room_id || '').trim();
  if (!chatworkApiToken || !roomIds) return;

  const reason = formatScheduleFailureReason(error);
  const keyword = getFirstScheduleKeyword(schedule);
  const template = `[info][title]予約投稿の実行に失敗しました[/title]
スケジュールID: ${schedule.id}
サイト: ${wpConfig.name}
URL: ${wpConfig.url}
キーワード: {keyword}
状態: 失敗

理由:
${reason}

記事生成または品質チェックの段階で停止しました。WordPressへの投稿前に止まっているため、AI生成内容、見出し構成、文字数制限、または品質チェック条件を確認してください。[/info]`;

  try {
    await sendChatworkNotifications(
      chatworkApiToken,
      roomIds,
      template,
      '予約投稿の実行に失敗しました',
      wpConfig.url,
      keyword,
      '失敗'
    );
  } catch (notifyError) {
    console.error('Schedule failure notification failed:', notifyError);
  }
}

