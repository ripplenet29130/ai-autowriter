import { useState, useEffect } from "react";
import { supabase, AIConfig } from "../lib/supabase";
import {
  TrendingUp,
  Search,
  Save,
  Trash2,
  Sparkles,
  Brain,
  Globe,
  Edit,
  TrendingDown,
  Activity,
} from "lucide-react";
import Toast from "../components/Toast";
import TrendChart from "../components/TrendChart";

interface TrendKeyword {
  id: string;
  keyword: string;
  related_keywords: string[];
  ai_config_id?: string;
  rising_keywords?: string[];
  source: string;
  created_at: string;
}

/* ------------------------------
   Google Trends フロント完結版API
------------------------------ */

// ① 関連キーワードを取得（ExploreページのHTMLを解析）
async function fetchGoogleRelated(keyword: string) {
  const url =
    "https://cors.isomorphic-git.org/https://trends.google.co.jp/trends/explore?q=" +
    encodeURIComponent(keyword);

  const html = await fetch(url).then((r) => r.text());

  // HTML内の "var data = ..." を抽出
  const match = html.match(/var data = (\{.+?\});<\/script>/s);

  if (!match) return null;

  const data = JSON.parse(match[1]);

  // 関連キーワードは widgets[x].rankedList
  const related = data.widgets?.filter(
    (w: any) => w.rankedList && w.rankedList.length > 0
  );

  return related?.[0]?.rankedList?.[0]?.rankedKeyword || [];
}

// ② 日本の急上昇ワード（RSS）を取得
async function fetchDailyRising() {
  const rssUrl =
    "https://cors.isomorphic-git.org/https://trends.google.co.jp/trending/rss?geo=JP";

  const xml = await fetch(rssUrl).then((r) => r.text());

  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");

  const items = [...doc.querySelectorAll("item")].map((item) => ({
    title: item.querySelector("title")?.textContent || "",
  }));

  return items.map((i) => i.title).slice(0, 10);
}

export default function TrendAnalysis() {
  const [keyword, setKeyword] = useState("");
  const [aiConfigs, setAiConfigs] = useState<AIConfig[]>([]);
  const [selectedAiConfigId, setSelectedAiConfigId] = useState("");

  const [activeTab, setActiveTab] = useState<"ai" | "google">("ai");

  const [relatedKeywords, setRelatedKeywords] = useState<string[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [savedKeywords, setSavedKeywords] = useState<TrendKeyword[]>([]);

  const [googleRelated, setGoogleRelated] = useState<any[]>([]);
  const [rising, setRising] = useState<string[]>([]);
  const [loadingGoogle, setLoadingGoogle] = useState(false);

  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  /* ---------------------- 初期ロード ---------------------- */

  useEffect(() => {
    loadAiConfigs();
    loadSavedKeywords();
  }, []);

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  /* ---------------------- AI設定 ---------------------- */

  const loadAiConfigs = async () => {
    const { data } = await supabase
      .from("ai_configs")
      .select("*")
      .order("created_at", { ascending: false });

    if (data && data.length > 0) {
      setAiConfigs(data);
      setSelectedAiConfigId(data[0].id);
    }
  };

  const loadSavedKeywords = async () => {
    const { data } = await supabase
      .from("trend_keywords")
      .select("*")
      .order("created_at", { ascending: false });

    if (data) setSavedKeywords(data);
  };


  /* ---------------------- AI分析 ---------------------- */

  const handleAnalyzeAI = async () => {
    if (!keyword.trim())
      return showMessage("error", "キーワードを入力してください");
    if (!selectedAiConfigId)
      return showMessage("error", "AI設定を選択してください");

    setAnalyzing(true);
    setRelatedKeywords([]);

    try {
      const response = await fetch("/.netlify/functions/ai-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          ai_config_id: selectedAiConfigId,
        }),
      });

      if (!response.ok) throw new Error("AI分析に失敗しました");

      const result = await response.json();
      const keywords = result.related_keywords || [];
      setRelatedKeywords(keywords);
      setSelectedKeywords(keywords);

      showMessage("success", `${keywords.length}件のキーワードを抽出しました`);
    } catch (error) {
      console.error("AI分析エラー:", error);
      showMessage("error", "AI分析に失敗しました");
    } finally {
      setAnalyzing(false);
    }
  };

  /* ---------------------- Googleトレンド（フロントのみ） ---------------------- */

  const handleAnalyzeGoogle = async () => {
    if (!keyword.trim())
      return showMessage("error", "キーワードを入力してください");

    setLoadingGoogle(true);
    setGoogleRelated([]);
    setRising([]);

    try {
      // ① 関連キーワード（Exploreページ解析）
      const related = await fetchGoogleRelated(keyword.trim());
      if (related?.length > 0) {
        setGoogleRelated(related);
      }

      // ② 急上昇ワード（RSS）
      const risingWords = await fetchDailyRising();
      setRising(risingWords);

      showMessage("success", "Googleトレンドデータを取得しました");
    } catch (error) {
      console.error("Googleトレンド取得エラー:", error);
      showMessage("error", "Googleトレンド取得に失敗しました");
    } finally {
      setLoadingGoogle(false);
    }
  };

  const handleAnalyze = () =>
    activeTab === "ai" ? handleAnalyzeAI() : handleAnalyzeGoogle();

  /* ---------------------- 保存処理 ---------------------- */

  const handleSave = async () => {
    if (selectedKeywords.length === 0)
      return showMessage("error", "保存するキーワードを選択してください");

    setLoading(true);
    try {
      const saveData = {
        keyword: keyword.trim(),
        related_keywords: selectedKeywords,
        ai_config_id: selectedAiConfigId,
        source: activeTab === "ai" ? "ai" : "google",
        created_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("trend_keywords").insert(saveData);

      if (error) throw error;

      showMessage("success", "キーワードを保存しました");

      await loadSavedKeywords();

      setKeyword("");
      setRelatedKeywords([]);
      setSelectedKeywords([]);
    } catch (e) {
      console.error("保存エラー:", e);
      showMessage("error", "保存中にエラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  /* ---------------------- キーワード選択トグル ---------------------- */

  const handleToggleKeyword = (kw: string) => {
    setSelectedKeywords((prev) =>
      prev.includes(kw)
        ? prev.filter((k) => k !== kw)
        : [...prev, kw]
    );
  };

  const handleToggleAll = () => {
    if (activeTab === "ai") {
      if (selectedKeywords.length === relatedKeywords.length) {
        setSelectedKeywords([]);
      } else {
        setSelectedKeywords([...relatedKeywords]);
      }
    } else {
      if (selectedKeywords.length === googleRelated.length) {
        setSelectedKeywords([]);
      } else {
        setSelectedKeywords(googleRelated.map((x: any) => x.query));
      }
    }
  };

  /* ---------------------- UI（入力・AI/Googleタブ） ---------------------- */

  return (
    <div>
      {message && (
        <Toast
          type={message.type}
          message={message.text}
          onClose={() => setMessage(null)}
        />
      )}

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <TrendingUp className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-800">トレンド分析</h1>
        </div>
        <p className="text-gray-600">
          AI × Google でキーワード戦略を強化
        </p>
      </div>

      {/* 入力セクション */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">
          キーワード分析
        </h2>

        {/* AI設定選択 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            AI設定
          </label>
          <select
            value={selectedAiConfigId}
            onChange={(e) => setSelectedAiConfigId(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg"
          >
            {aiConfigs.map((config) => (
              <option key={config.id} value={config.id}>
                {config.name || `${config.provider} - ${config.model}`}
              </option>
            ))}
          </select>
        </div>

        {/* キーワード入力＋分析 */}
        <div className="flex gap-3 mb-6">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="例: AGA治療"
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg"
          />
          <button
            onClick={handleAnalyze}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg flex items-center gap-2"
          >
            <Search className="w-5 h-5" />
            {analyzing || loadingGoogle ? "分析中..." : "分析開始"}
          </button>
        </div>

        {/* タブ */}
        <div className="flex gap-4 border-b mb-6">
          <button
            onClick={() => setActiveTab("ai")}
            className={`px-4 py-2 border-b-2 ${
              activeTab === "ai"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500"
            }`}
          >
            <Brain className="inline w-5 h-5 mr-2" />
            AI分析
          </button>

          <button
            onClick={() => setActiveTab("google")}
            className={`px-4 py-2 border-b-2 ${
              activeTab === "google"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500"
            }`}
          >
            <Globe className="inline w-5 h-5 mr-2" />
            Googleトレンド
          </button>
        </div>

        {/* ---------------- Google トレンド結果表示 ---------------- */}
        {activeTab === "google" && (
          <div className="mt-6 space-y-6">
            {/* 読み込み中 */}
            {loadingGoogle && (
              <div className="text-center py-12 text-gray-500">
                <div className="animate-spin h-12 w-12 rounded-full border-b-2 border-blue-600 mx-auto" />
                <p className="mt-4">Googleトレンド取得中...</p>
              </div>
            )}

            {/* 関連キーワード */}
            {!loadingGoogle && googleRelated.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <Search className="w-5 h-5 text-blue-600" />
                  関連キーワード Top10
                </h3>

                <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {googleRelated.slice(0, 10).map((item: any, idx: number) => (
                    <li
                      key={idx}
                      className={`cursor-pointer flex items-center gap-3 p-3 rounded-lg border ${
                        selectedKeywords.includes(item.query)
                          ? "bg-blue-100 border-blue-400"
                          : "bg-gray-50 border-gray-200"
                      }`}
                      onClick={() => handleToggleKeyword(item.query)}
                    >
                      <span className="text-sm font-semibold text-blue-600 min-w-[24px]">
                        #{idx + 1}
                      </span>
                      <span className="text-gray-800">{item.query}</span>
                      <span className="ml-auto text-xs text-gray-500">
                        {item.value}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 急上昇キーワード */}
            {!loadingGoogle && rising.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-red-600" />
                  急上昇キーワード Top10
                </h3>

                <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {rising.map((title, idx) => (
                    <li
                      key={idx}
                      className="p-3 bg-red-50 rounded-lg border border-red-200"
                    >
                      {title}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ---------------- AI結果表示 ---------------- */}
        {activeTab === "ai" && relatedKeywords.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-blue-600" />
              AIが提案する関連キーワード
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
              {relatedKeywords.map((kw, i) => (
                <div
                  key={i}
                  onClick={() => handleToggleKeyword(kw)}
                  className={`cursor-pointer rounded-lg px-4 py-3 border-2 transition-all ${
                    selectedKeywords.includes(kw)
                      ? "bg-blue-100 border-blue-400"
                      : "bg-gray-50 border-gray-200 hover:border-gray-300"
                  }`}
                >
                  {kw}
                </div>
              ))}
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={handleToggleAll}
                className="px-6 py-3 bg-gray-600 text-white rounded-lg"
              >
                {selectedKeywords.length === relatedKeywords.length
                  ? "全解除"
                  : "全選択"}
              </button>
            </div>
          </div>
        )}
      </div>
      {/* 🔹 キーワードリスト管理セクション */}
      <div
        className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8"
        data-section="keyword-list"
      >
        <h2 className="text-xl font-semibold text-gray-800 mb-6">
          キーワードリスト管理
        </h2>

        {/* リスト編集/新規タブ */}
        <div className="flex gap-4 border-b mb-6">
          <button
            onClick={() => setManualMode("new")}
            className={`px-4 py-2 border-b-2 font-medium ${
              manualMode === "new"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500"
            }`}
          >
            新規追加
          </button>

          <button
            onClick={() => setManualMode("edit")}
            className={`px-4 py-2 border-b-2 font-medium ${
              manualMode === "edit"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500"
            }`}
          >
            編集
          </button>
        </div>

        {/* -------------------------- 新規リスト追加 -------------------------- */}
        {manualMode === "new" && (
          <div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                リスト名
              </label>
              <input
                type="text"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder="例: AGA治療 関連キーワード"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg"
              />
            </div>

            {/* キーワード追加 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                キーワード追加
              </label>

              <div className="flex gap-3 mb-3">
                <input
                  type="text"
                  value={newKeywordInput}
                  onChange={(e) => setNewKeywordInput(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && handleAddNewKeyword()
                  }
                  placeholder="キーワードを入力して Enter（複数は , 区切り）"
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg"
                />

                <button
                  onClick={handleAddNewKeyword}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg"
                >
                  追加
                </button>
              </div>

              {/* キーワード一覧 */}
              {newListKeywords.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                  {newListKeywords.map((kw, i) => (
                    <div
                      key={i}
                      className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex justify-between items-center"
                    >
                      <span>{kw}</span>
                      <button
                        onClick={() => handleRemoveNewKeyword(i)}
                        className="text-red-600 hover:bg-red-50 rounded p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleSaveNewList}
              disabled={loading}
              className="w-full px-6 py-3 bg-green-600 text-white rounded-lg flex items-center justify-center gap-2"
            >
              <Save className="w-5 h-5" />
              {loading ? "保存中..." : "キーワードリストを保存"}
            </button>
          </div>
        )}

        {/* -------------------------- リスト編集 -------------------------- */}
        {manualMode === "edit" && (
          <div>
            {/* リスト選択 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                編集するリスト
              </label>

              <select
                value={editListId}
                onChange={(e) => handleSelectEditList(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg"
              >
                <option value="">リストを選択してください</option>
                {savedKeywords.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.keyword}（{item.related_keywords.length}件）
                  </option>
                ))}
              </select>
            </div>

            {editListId && (
              <>
                {/* 編集：リスト名 */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    リスト名
                  </label>
                  <input
                    type="text"
                    value={editListName}
                    onChange={(e) => setEditListName(e.target.value)}
                    placeholder="リスト名"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                  />
                </div>

                {/* キーワード追加 */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    キーワード追加
                  </label>

                  <div className="flex gap-3 mb-3">
                    <input
                      type="text"
                      value={editKeywordInput}
                      onChange={(e) => setEditKeywordInput(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleAddEditKeyword()
                      }
                      placeholder="キーワードを入力（複数は , 区切り）"
                      className="flex-1 px-4 py-3 border border-gray-300 rounded-lg"
                    />

                    <button
                      onClick={handleAddEditKeyword}
                      className="px-6 py-3 bg-blue-600 text-white rounded-lg"
                    >
                      追加
                    </button>
                  </div>

                  {/* キーワード一覧 */}
                  {editListKeywords.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                      {editListKeywords.map((kw, i) => (
                        <div
                          key={i}
                          className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex justify-between items-center"
                        >
                          <span>{kw}</span>
                          <button
                            onClick={() => handleRemoveEditKeyword(i)}
                            className="text-red-600 hover:bg-red-50 rounded p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 更新保存 */}
                <button
                  onClick={handleUpdateList}
                  disabled={loading}
                  className="w-full px-6 py-3 bg-green-600 text-white rounded-lg flex items-center justify-center gap-2"
                >
                  <Save className="w-5 h-5" />
                  {loading ? "更新中..." : "変更を保存"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 🔹 保存済みキーワード一覧 */}
      {savedKeywords.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">
            保存済みキーワード
          </h2>

          <div className="space-y-4">
            {savedKeywords.map((item) => (
              <div
                key={item.id}
                className="border border-gray-200 rounded-lg p-6 hover:border-blue-300 transition-colors"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">{item.keyword}</h3>
                    <p className="text-xs text-gray-500">
                      {new Date(item.created_at).toLocaleString("ja-JP")}
                    </p>
                  </div>

                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-red-600 hover:bg-red-50 rounded-lg p-2"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                {/* AI関連キーワード */}
                {item.related_keywords?.length > 0 && (
                  <div className="mb-2">
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      関連キーワード
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {item.related_keywords.map((kw, j) => (
                        <span
                          key={j}
                          className="px-3 py-1 bg-gray-100 rounded-full text-sm"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 上昇ワード */}
                {item.rising_keywords?.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      急上昇ワード
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {item.rising_keywords.slice(0, 5).map((kw, j) => (
                        <span
                          key={j}
                          className="px-3 py-1 bg-green-50 border border-green-200 rounded-full text-sm text-green-800"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


      
