import { sendChatWorkMessages } from "./sendChatwork";

/**
 * 投稿成功通知用の payload
 */
export type NotifyPostSuccessPayload = {
  title: string;
  keyword: string;
  postUrl: string;
  postStatus: "draft" | "publish";
  roomId?: string;
  remaining?: number; // 残りキーワード数（警告メッセージ用、オプション）
};

/**
 * 記事投稿成功時の ChatWork 通知
 */
export async function notifyPostSuccess(
  payload: NotifyPostSuccessPayload
): Promise<void> {
  const { title, keyword, postUrl, postStatus, roomId, remaining } = payload;

  const statusLabel = postStatus === "publish" ? "公開" : "下書き";

  // 残りキーワード数の警告メッセージ（auto-scheduler 用）
  const warningMessage =
    remaining !== undefined && remaining <= 3
      ? `[warning]残りキーワード数が少なくなっています（残り ${remaining} 個）
キーワード補充またはスケジュール設定の見直しをお願いします。[/warning]\n`
      : "";

  const message = `
${warningMessage}いつもお世話になっております。
記事の投稿が完了しましたので、ご報告いたします。

■ 記事タイトル  
${title}

■ キーワード  
${keyword}

■ 投稿URL  
${postUrl}

■ 投稿状態  
${statusLabel}

問題などございましたら、お気軽にお知らせください。

今後ともよろしくお願いいたします。
`;

  await sendChatWorkMessages(message, roomId);
}
