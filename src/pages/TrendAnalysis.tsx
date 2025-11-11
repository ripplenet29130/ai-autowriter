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
} from "lucide-react";
import Toast from "../components/Toast";

interface TrendKeyword {
  id: string;
  keyword: string;
  related_keywords: string[];
  ai_config_id?: string;
  rising_keywords?: string[];
  source: string;
  created_at: string;
}

export default function TrendAnalysis() {
  const [keyword, setKeyword] = useState("");
  const [aiConfigs, setAiConfigs] = useState<AIConfig[]>([]);
  const [selectedAiConfigId, setSelectedAiConfigId] = useState("");
  const [activeTab, setActiveTab] = useState<"ai" | "google">("ai");

  const [relatedKeywords, setRelatedKeywords] = useState<string[]>([]);
  const [savedKeywords, setSavedKeywords] = useState<TrendKeyword[]>([]);
  const [googleTrends, setGoogleTrends] = useState<any[]>([]);

  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [manualMode, setManualMode] = useState<"new" | "edit">("new");
  const [newListName, setNewListName] = useState("");
  const [newListKeywords, setNewListKeywords] = useState<string[]>([]);
  const [newKeywordInput, setNewKeywordInput] = useState("");

  const [editListId, setEditListId] = useState("");
  const [editListName, setEditListName] = useState("");
  const [editListKeywords, setEditListKeywords] = useState<string[]>([]);
  const [editKeywordInput, setEditKeywordInput] = useState("");

  /** 🔹 初期読み込み */
  useEffect(() => {
    loadAiConfigs();
    loadSavedKeywords();
    loadTrends();
  }, []);

  /** 🔹 AI設定一覧を取得 */
  const loadAiConfigs = async () => {
    const { data, error } = await supabase
      .from("ai_configs")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data && data.length > 0) {
      setAiConfigs(data);
      const activeConfig =
        data.find((c) => c.provider === "Gemini") || data[0];
      setSelectedAiConfigId(activeConfig.id);
    }
  };

  /** 🔹 保存済みキーワードを取得 */
  const loadSavedKeywords = async () => {
    const { data, error } = await supabase
      .from("trend_keywords")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setSavedKeywords(data);
  };

  /** 🔹 トレンドデータ取得 */
  const loadTrends = async () => {
    const { data, error } = await supabase
      .from("trend_keywords")
      .select("keyword, trend_score, rising_keywords, created_at")
      .order("created_at", { ascending: false })
      .limit(5);
    if (!error && data) setGoogleTrends(data);
    else console.error("トレンドデータ取得エラー:", error?.message);
  };

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  /** 🔹 AI分析 */
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
      setRelatedKeywords(result.related_keywords || []);
      showMessage(
        "success",
        `${result.related_keywords?.length || 0}件のキーワードを抽出しました`
      );
    } catch (error) {
      console.error("AI分析エラー:", error);
      showMessage("error", "AI分析に失敗しました");
    } finally {
      setAnalyzing(false);
    }
  };

  /** 🔹 Googleトレンド分析 */
  const handleAnalyzeGoogle = async () => {
    if (!keyword.trim())
      return showMessage("error", "キーワードを入力してください");

    setAnalyzing(true);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(
        `${supabaseUrl}/functions/v1/google-trends`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({
            keyword: keyword.trim(),
            timeRange: "now 7-d",
            geo: "JP",
          }),
        }
      );

      if (!response.ok) throw new Error("Googleトレンド分析に失敗しました");

      const result = await response.json();
      showMessage("success", "Googleトレンドデータを取得しました");
      console.log("Googleトレンド結果:", result);
    } catch (error) {
      console.error("Googleトレンド分析エラー:", error);
      showMessage("error", "Googleトレンド分析に失敗しました");
    } finally {
      setAnalyzing(false);
    }
  };

  /** 🔹 分析切替 */
  const handleAnalyze = () =>
    activeTab === "ai" ? handleAnalyzeAI() : handleAnalyzeGoogle();

  /** 🔹 保存 */
  const handleSave = async () => {
    if (relatedKeywords.length === 0)
      return showMessage("error", "保存するデータがありません");

    setLoading(true);
    try {
      const keywordTrimmed = keyword.trim();
      if (!keywordTrimmed) {
        showMessage("error", "キーワードを入力してください");
        setLoading(false);
        return;
      }

      const saveData = {
        keyword: keywordTrimmed,
        related_keywords: relatedKeywords,
        ai_config_id: selectedAiConfigId,
        source: "ai",
        created_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("trend_keywords").insert(saveData);

      if (error) throw error;

      showMessage("success", "キーワードを保存しました 🎉");

      // 保存後Googleトレンド呼び出し
      handleAnalyzeGoogleAfterSave(keywordTrimmed);
      
      // ✅ 保存直後にリスト更新
      await loadSavedKeywords();
      
      setKeyword("");
      setRelatedKeywords([]);
    } catch (e) {
      console.error("保存エラー:", e);
      showMessage("error", "保存中にエラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  /** 🔹 削除 */
  const handleDelete = async (id: string) => {
    if (!confirm("このキーワードを削除してもよろしいですか？")) return;

    const { error } = await supabase.from("trend_keywords").delete().eq("id", id);
    if (error) return showMessage("error", "削除に失敗しました");

    showMessage("success", "削除しました");
    loadSavedKeywords();
  };

  /** 🔹 新規リスト：キーワード追加 */
  const handleAddNewKeyword = () => {
    const trimmed = newKeywordInput.trim();
    if (!trimmed) return showMessage("error", "キーワードを入力してください");
    if (newListKeywords.includes(trimmed)) {
      return showMessage("error", "既に追加されています");
    }
    setNewListKeywords([...newListKeywords, trimmed]);
    setNewKeywordInput("");
  };

  /** 🔹 新規リスト：キーワード削除 */
  const handleRemoveNewKeyword = (index: number) => {
    setNewListKeywords(newListKeywords.filter((_, i) => i !== index));
  };

  /** 🔹 新規リスト：保存 */
  const handleSaveNewList = async () => {
    if (!newListName.trim()) {
      return showMessage("error", "リスト名を入力してください");
    }
    if (newListKeywords.length === 0) {
      return showMessage("error", "キーワードを1つ以上追加してください");
    }

    setLoading(true);
    try {
      const saveData = {
        keyword: newListName.trim(),
        related_keywords: newListKeywords,
        ai_config_id: selectedAiConfigId || null,
        source: "manual",
        created_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("trend_keywords").insert(saveData);

      if (error) throw error;

      showMessage("success", "キーワードリストを保存しました");
      await loadSavedKeywords();

      setNewListName("");
      setNewListKeywords([]);
    } catch (e) {
      console.error("保存エラー:", e);
      showMessage("error", "保存中にエラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  /** 🔹 編集リスト：選択時 */
  const handleSelectEditList = (id: string) => {
    const selected = savedKeywords.find((kw) => kw.id === id);
    if (selected) {
      setEditListId(id);
      setEditListName(selected.keyword);
      setEditListKeywords([...selected.related_keywords]);
    }
  };

  /** 🔹 編集リスト：キーワード追加 */
  const handleAddEditKeyword = () => {
    const trimmed = editKeywordInput.trim();
    if (!trimmed) return showMessage("error", "キーワードを入力してください");
    if (editListKeywords.includes(trimmed)) {
      return showMessage("error", "既に追加されています");
    }
    setEditListKeywords([...editListKeywords, trimmed]);
    setEditKeywordInput("");
  };

  /** 🔹 編集リスト：キーワード削除 */
  const handleRemoveEditKeyword = (index: number) => {
    setEditListKeywords(editListKeywords.filter((_, i) => i !== index));
  };

  /** 🔹 編集リスト：更新保存 */
  const handleUpdateList = async () => {
    if (!editListId) return showMessage("error", "リストが選択されていません");
    if (!editListName.trim()) {
      return showMessage("error", "リスト名を入力してください");
    }
    if (editListKeywords.length === 0) {
      return showMessage("error", "キーワードを1つ以上追加してください");
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from("trend_keywords")
        .update({
          keyword: editListName.trim(),
          related_keywords: editListKeywords,
        })
        .eq("id", editListId);

      if (error) throw error;

      showMessage("success", "キーワードリストを更新しました");
      await loadSavedKeywords();

      setEditListId("");
      setEditListName("");
      setEditListKeywords([]);
    } catch (e) {
      console.error("更新エラー:", e);
      showMessage("error", "更新中にエラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const selectedAiConfig = aiConfigs.find((c) => c.id === selectedAiConfigId);

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
          AI × Googleトレンドでデータドリブンなキーワード戦略を構築
        </p>
      </div>

      {/* 🔸 AI設定なし時 */}
      {aiConfigs.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <p className="text-yellow-800 font-medium mb-1">
            AI設定が未登録です
          </p>
          <p className="text-yellow-700 text-sm">
            Gemini APIキーを登録してください。
          </p>
        </div>
      )}

      {/* 🔸 入力セクション */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">
          キーワード分析
        </h2>

        {/* 設定選択 */}
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
          {selectedAiConfig && (
            <p className="text-xs text-gray-500 mt-1">
              Temperature: {selectedAiConfig.temperature}, Max Tokens:{" "}
              {selectedAiConfig.max_tokens}
            </p>
          )}
        </div>

        {/* キーワード入力 */}
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
            disabled={analyzing}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg flex items-center gap-2"
          >
            <Search className="w-5 h-5" />
            {analyzing ? "分析中..." : "分析開始"}
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
            AI分析結果
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

        {/* 🔹 AI結果 */}
        {activeTab === "ai" && relatedKeywords.length > 0 && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-600" />
                AIが提案する関連キーワード
              </h3>
              <button
                onClick={handleSave}
                disabled={loading}
                className="px-4 py-2 bg-green-600 text-white rounded-lg flex items-center gap-2"
              >
                <Save className="w-4 h-4" /> 保存
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {relatedKeywords.map((kw, i) => (
                <div
                  key={i}
                  className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3"
                >
                  {kw}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 🔹 Google結果 */}
        {activeTab === "google" && (
          <div className="mt-6">
            {googleTrends.length === 0 ? (
              <p className="text-gray-500">まだトレンドデータがありません。</p>
            ) : (
              googleTrends.map((trend, i) => (
                <div
                  key={i}
                  className="bg-white border border-gray-200 rounded-lg p-6 mb-6 shadow-sm"
                >
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">
                    {trend.keyword}
                  </h3>

                  {trend.trend_score?.timeline && (
                    <div className="mb-4">
                      <p className="text-sm text-gray-600 mb-2">人気度推移</p>
                      <div className="space-y-2">
                        {trend.trend_score.timeline.map((item: any, j: number) => (
                          <div key={j} className="flex items-center gap-3">
                            <span className="text-xs text-gray-500 w-20">
                              {item.time}
                            </span>
                            <div className="flex-1 bg-gray-200 rounded-full h-4">
                              <div
                                className="bg-blue-600 h-4 rounded-full"
                                style={{ width: `${item.value}%` }}
                              ></div>
                            </div>
                            <span className="text-xs text-gray-700">
                              {item.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {trend.rising_keywords?.length > 0 && (
                    <div>
                      <p className="text-sm text-gray-600 mb-2">上昇キーワード</p>
                      <div className="flex flex-wrap gap-2">
                        {trend.rising_keywords.slice(0, 10).map((kw: string, j: number) => (
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
              ))
            )}
          </div>
        )}
      </div>

      {/* 🔹 キーワードリスト管理セクション */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">
          キーワードリスト管理
        </h2>

        {/* タブ */}
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

        {/* 新規追加モード */}
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
                placeholder="例: AGA治療関連キーワード"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                キーワード追加
              </label>
              <div className="flex gap-3 mb-3">
                <input
                  type="text"
                  value={newKeywordInput}
                  onChange={(e) => setNewKeywordInput(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && handleAddNewKeyword()}
                  placeholder="キーワードを入力してEnter"
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg"
                />
                <button
                  onClick={handleAddNewKeyword}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg"
                >
                  追加
                </button>
              </div>

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

        {/* 編集モード */}
        {manualMode === "edit" && (
          <div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                編集するリストを選択
              </label>
              <select
                value={editListId}
                onChange={(e) => handleSelectEditList(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg"
              >
                <option value="">リストを選択してください</option>
                {savedKeywords.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.keyword} ({item.related_keywords.length}件)
                  </option>
                ))}
              </select>
            </div>

            {editListId && (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    リスト名
                  </label>
                  <input
                    type="text"
                    value={editListName}
                    onChange={(e) => setEditListName(e.target.value)}
                    placeholder="リスト名を入力"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    キーワード編集
                  </label>
                  <div className="flex gap-3 mb-3">
                    <input
                      type="text"
                      value={editKeywordInput}
                      onChange={(e) => setEditKeywordInput(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && handleAddEditKeyword()}
                      placeholder="キーワードを追加してEnter"
                      className="flex-1 px-4 py-3 border border-gray-300 rounded-lg"
                    />
                    <button
                      onClick={handleAddEditKeyword}
                      className="px-6 py-3 bg-blue-600 text-white rounded-lg"
                    >
                      追加
                    </button>
                  </div>

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

                {item.related_keywords?.length > 0 && (
                  <div className="mb-2">
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      AI提案キーワード
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

                {item.rising_keywords?.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      上昇トレンド
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

/** ✅ Googleトレンド自動保存後更新 */
async function handleAnalyzeGoogleAfterSave(kw: string) {
  try {
    // ✅ Netlify Functions経由に変更
    const response = await fetch("/.netlify/functions/google-trends", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        keyword: kw,
        timeRange: "now 7-d", // 過去7日
        geo: "JP", // 日本
      }),
    });

    if (!response.ok) throw new Error("Googleトレンド分析に失敗しました");

    const result = await response.json();

    // ✅ Supabaseに保存
    const { error } = await supabase
      .from("trend_keywords")
      .update({
        trend_score: result.trend_score,
        rising_keywords: result.rising,
        source: "hybrid",
      })
      .eq("keyword", kw);

    if (error) throw error;

    console.log("✅ Googleトレンド更新完了:", kw);
  } catch (err) {
    console.error("❌ Googleトレンド自動分析エラー:", err);
  }
}
