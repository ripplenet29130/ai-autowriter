import { sendChatWorkMessages } from "./sendChatwork";

/**
 * ファクトチェック reject 通知用の payload 型定義
 */
export type NotifyFactRejectPayload = {
  keyword: string;
  title: string;
  reasons: string[];
  roomId: string;
};

/**
 * ファクトチェックで reject になった場合に ChatWork へ通知する
 * @param payload - 通知に必要な情報
 */
export async function notifyFactReject(
  payload: NotifyFactRejectPayload
): Promise<void> {
  const { keyword, title, reasons, roomId } = payload;

  // reasons を箇条書きで整形
  const reasonsText =
    reasons.length > 0
      ? reasons.map((reason) => `・${reason}`).join("\n")
      : "・指摘理由が取得できませんでした";

  // 通知メッセージを構築
  const message = `
いつもお世話になっております。
記事生成時にファクトチェックで問題が検出されたため、ご報告いたします。

■ 記事タイトル  
${title}

■ キーワード  
${keyword}

■ 指摘内容  
${reasonsText}

■ 対応状況  
記事は下書きとして保存されましたが、公開前に内容の確認をお願いいたします。

問題などございましたら、お気軽にお知らせください。

今後ともよろしくお願いいたします。
`;

  // ChatWork に送信
  await sendChatWorkMessages(message, roomId);
}

