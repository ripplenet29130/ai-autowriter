// Node.js 環境変数の型定義（Netlify Functions 環境用）
declare const process: {
  env: {
    CHATWORK_API_TOKEN?: string;
    CHATWORK_COMPANY_ROOM_IDS?: string;
  };
};

/**
 * ChatWork メッセージ送信（自社 + クライアント対応）
 * @param text - 送信するメッセージ本文
 * @param clientRoomId - クライアント用ルームID（オプション）
 */
export async function sendChatWorkMessages(
  text: string,
  clientRoomId?: string
): Promise<void> {
  const token = process.env.CHATWORK_API_TOKEN;
  const companyRoomIdsRaw = process.env.CHATWORK_COMPANY_ROOM_IDS;

  if (!token) {
    console.error("ChatWork APIトークンが設定されていません");
    return;
  }

  // 自社ルーム（複数OK）
  const companyRoomIds = companyRoomIdsRaw
    ? companyRoomIdsRaw.split(",").map((id: string) => id.trim())
    : [];

  // 送信対象ルーム一覧を作る
  const targets = [...companyRoomIds];

  // クライアントのルームIDがある場合だけ追加
  if (clientRoomId) {
    targets.push(clientRoomId);
  }

  // まとめて送信
  for (const roomId of targets) {
    try {
      const res = await fetch(
        `https://api.chatwork.com/v2/rooms/${roomId}/messages`,
        {
          method: "POST",
          headers: {
            "X-ChatWorkToken": token,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ body: text }),
        }
      );

      if (!res.ok) {
        console.error(
          `ChatWork送信エラー（roomId: ${roomId}）:`,
          await res.text()
        );
      } else {
        console.log(`📨 ChatWork送信成功（roomId: ${roomId}）`);
      }
    } catch (err) {
      console.error(`ChatWork送信例外（roomId: ${roomId}）:`, err);
    }
  }
}

