// ==============================================
// TrendAnalysis.tsx（完全最新版・Netlify対応）
// ==============================================

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
  trend_score?: any;
  source: string;
  created_at: string;
}

export default function TrendAnalysis() {
  const [keyword, setKeyword] = useState("");
  const [aiConfigs, setAiConfigs] = useState<AIConfig[]>([]);
  const [selectedAiConfigId, setSelectedAiConfigId] = useState("");
  const [activeTab, setActiveTab] = useState<"ai" | "google">("ai");

  const [relatedKeywords, setRelatedKeywords] = useState<string[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [savedKeywords, setSavedKeywords] = useState<TrendKeyword[]>([]);
  const [googleTrends, setGoogleTrends] = useState<TrendKeyword[]>([]);

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

  // 初期読み込み
  useEffect(() => {
    loadAiConfigs();
    loadSavedKeywords();
    loadTrends();
  }, []);

  // AI設定読み込み
  const loadAiConfigs = async () => {
    const { data } = await supabase
      .from("ai_configs")
      .select("*")
      .order("created_at", { ascending: false });

    if (data) {
      setAiConfigs(data);
      const active =
        data.find((c) => c.provider === "Gemini") || data[0];
      setSelectedAiConfigId(active?.id || "");
    }
  };

  // 保存済みキーワード読み込み
  const loadSavedKeywords = async () => {
    const { data } = await supabase
      .from("trend_keywords")
      .select("*")
      .order("created_at", { ascending: false });

    if (data) setSavedKeywords(data);
  };

  // Googleトレンド最新5件
  const loadTrends = async () => {
    const { data } = await supabase
      .from("trend_keywords")
      .select("keyword, trend_score, rising_keywords, created_at")
      .order("created_at", { ascending: false })
      .limit(5);

    if (data) setGoogleTrends(data);
  };

  // トースト
  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  // 🔹 AI分析（Netlify Function）
  const handleAnalyzeAI = async () => {
    if (!keyword.trim()) return showMessage("error", "キーワードを入力してください");

    setAnalyzing(true);
    try {
      const response = await fetch("/.netlify/functions/ai-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          ai_config_id: selectedAiConfigId,
        }),
      });

      const json = await response.json();
      const kws = json.related_keywords || [];

      setRelatedKeywords(kws);
      setSelectedKeywords(kws);

      showMessage("success", `${kws.length}件のキーワードを抽出しました`);
    } catch (e) {
      showMessage("error", "AI分析に失敗しました");
    }
    setAnalyzing(false);
  };

  // 🔹 Googleトレンド（Netlify Function）
  const handleAnalyzeGoogle = async () => {
    if (!keyword.trim()) return showMessage("error", "キーワードを入力してください");

    setAnalyzing(true);
    try {
      const response = await fetch("/.netlify/functions/google-trends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          timeRange: "now 7-d",
          geo: "JP",
        }),
      });

      const json = await response.json();
      console.log("Google Trend:", json);
      showMessage("success", "Googleトレンドを取得しました");
    } catch (e) {
      showMessage("error", "Googleトレンドの取得に失敗しました");
    }
    setAnalyzing(false);
  };

  const handleAnalyze = () =>
    activeTab === "ai" ? handleAnalyzeAI() : handleAnalyzeGoogle();

  // 🔹 キーワード保存（AI結果）
  const handleSave = async () => {
    if (selectedKeywords.length === 0)
      return showMessage("error", "キーワードを選択してください");

    setLoading(true);

    try {
      const base = {
        keyword: keyword.trim(),
        related_keywords: selectedKeywords,
        ai_config_id: selectedAiConfigId,
        source: "ai",
        created_at: new Date().toISOString(),
      };

      await supabase.from("trend_keywords").insert(base);

      showMessage("success", "AIキーワードを保存しました");

      // Googleトレンドを続けて取得
      await handleAnalyzeGoogleAfterSave(keyword.trim());

      loadSavedKeywords();

      setKeyword("");
      setRelatedKeywords([]);
      setSelectedKeywords([]);
    } catch (e) {
      showMessage("error", "保存に失敗しました");
    }

    setLoading(false);
  };

  // 🔹 Googleトレンド → 自動更新（Netlify版）
  const handleAnalyzeGoogleAfterSave = async (kw: string) => {
    try {
      const response = await fetch("/.netlify/functions/google-trends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: kw,
          timeRange: "now 7-d",
          geo: "JP",
        }),
      });

      const json = await response.json();

      await supabase
        .from("trend_keywords")
        .update({
          trend_score: json.trend_score,
          rising_keywords: json.rising,
          source: "hybrid",
        })
        .eq("keyword", kw);
    } catch (err) {
      console.log("Google Auto Update failed:", err);
    }
  };

  // 🔹 リストに転記
  const handleTransferToList = () => {
    if (selectedKeywords.length === 0)
      return showMessage("error", "転記するキーワードがありません");

    setManualMode("new");
    setNewListName(keyword.trim());
    setNewListKeywords([...selectedKeywords]);

    setTimeout(() => {
      const el = document.querySelector('[data-section="keyword-list"]');
      el?.scrollIntoView({ behavior: "smooth" });
    }, 200);
  };

  // 🔹 キーワード選択
  const handleToggleKeyword = (kw: string) => {
    setSelectedKeywords((prev) =>
      prev.includes(kw)
        ? prev.filter((x) => x !== kw)
        : [...prev, kw]
    );
  };

  const handleToggleAll = () => {
    if (selectedKeywords.length === relatedKeywords.length) {
      setSelectedKeywords([]);
    } else {
      setSelectedKeywords([...relatedKeywords]);
    }
  };

  // 🔹 保存済み削除
  const handleDelete = async (id: string) => {
    if (!confirm("削除しますか？")) return;

    await supabase.from("trend_keywords").delete().eq("id", id);
    loadSavedKeywords();
  };

  // 🔹 新規リストの追加
  const handleAddNewKeyword = () => {
    if (!newKeywordInput.trim()) return;

    const arr = newKeywordInput
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);

    const newOnes = arr.filter((x) => !newListKeywords.includes(x));

    setNewListKeywords([...newListKeywords, ...newOnes]);
    setNewKeywordInput("");
  };

  const handleRemoveNewKeyword = (i: number) => {
    setNewListKeywords(newListKeywords.filter((_, idx) => idx !== i));
  };

  // 🔹 新規リスト保存
  const handleSaveNewList = async () => {
    if (!newListName.trim()) return showMessage("error", "名前を入力してください");
    if (newListKeywords.length === 0)
      return showMessage("error", "キーワードを追加してください");

    setLoading(true);

    await supabase.from("trend_keywords").insert({
      keyword: newListName.trim(),
      related_keywords: newListKeywords,
      ai_config_id: selectedAiConfigId,
      source: "manual",
      created_at: new Date().toISOString(),
    });

    showMessage("success", "リストを保存しました");
    loadSavedKeywords();

    setNewListName("");
    setNewListKeywords([]);

    setLoading(false);
  };

  // 🔹 編集モードの選択
  const handleSelectEditList = (id: string) => {
    const target = savedKeywords.find((x) => x.id === id);
    if (!target) return;

    setEditListId(target.id);
    setEditListName(target.keyword);
    setEditListKeywords([...target.related_keywords]);
  };

  // 🔹 編集キーワード追加
  const handleAddEditKeyword = () => {
    if (!editKeywordInput.trim()) return;

    const arr = editKeywordInput
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);

    const newOnes = arr.filter((x) => !editListKeywords.includes(x));

    setEditListKeywords([...editListKeywords, ...newOnes]);
    setEditKeywordInput("");
  };

  const handleRemoveEditKeyword = (i: number) => {
    setEditListKeywords(editListKeywords.filter((_, idx) => idx !== i));
  };

  // 🔹 編集保存
  const handleUpdateList = async () => {
    if (!editListId) return;

    await supabase
      .from("trend_keywords")
      .update({
        keyword: editListName.trim(),
        related_keywords: editListKeywords,
      })
      .eq("id", editListId);

    showMessage("success", "リストを更新しました");
    loadSavedKeywords();
  };

  // ======= UI =======
  const selectedAiConfig = aiConfigs.find(
    (c) => c.id === selectedAiConfigId
  );

  return (
    <div className="p-4 md:p-8">

      {message && (
        <Toast
          type={message.type}
          message={message.text}
          onClose={() => setMessage(null)}
        />
      )}

      {/* ----- タイトル ----- */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <TrendingUp className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-800">
            トレンド分析
          </h1>
        </div>
        <p className="text-gray-600">
          AI × Googleトレンドでデータドリブンなキーワード戦略を構築
        </p>
      </div>

      {/* ==============================
           入力セクション
      =============================== */}
      <div className="bg-white rounded-xl shadow-sm border p-8 mb-8">

        {/* AI設定 */}
        <div className="mb-4">
          <label className="block text-sm mb-2">AI設定</label>

          <select
            value={selectedAiConfigId}
            onChange={(e) => setSelectedAiConfigId(e.target.value)}
            className="w-full border px-4 py-3 rounded-lg"
          >
            {aiConfigs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || `${c.provider} - ${c.model}`}
              </option>
            ))}
          </select>
        </div>

        {/* キーワード入力 */}
        <div className="flex gap-3 mb-6">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="例: AGA治療"
            className="flex-1 border px-4 py-3 rounded-lg"
          />
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg"
          >
            {analyzing ? "分析中…" : "分析開始"}
          </button>
        </div>

        {/* タブ */}
        <div className="flex gap-4 border-b mb-6">
          <button
            className={`px-4 py-2 border-b-2 ${
              activeTab === "ai"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500"
            }`}
            onClick={() => setActiveTab("ai")}
          >
            <Brain className="inline w-5 h-5 mr-2" />
            AI分析結果
          </button>

          <button
            className={`px-4 py-2 border-b-2 ${
              activeTab === "google"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500"
            }`}
            onClick={() => setActiveTab("google")}
          >
            <Globe className="inline w-5 h-5 mr-2" />
            Googleトレンド
          </button>
        </div>

        {/* ==============================
            AI（関連キーワード）
        =============================== */}
        {activeTab === "ai" && relatedKeywords.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-blue-600" />
              AIが提案する関連キーワード
            </h3>

            <div className="grid md:grid-cols-2 gap-3 mb-6">
              {relatedKeywords.map((kw, i) => (
                <div
                  key={i}
                  onClick={() => handleToggleKeyword(kw)}
                  className={`cursor-pointer px-4 py-3 rounded-lg border-2 ${
                    selectedKeywords.includes(kw)
                      ? "bg-blue-100 border-blue-400"
                      : "bg-gray-50 border-gray-200"
                  }`}
                >
                  {kw}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={handleToggleAll}
                className="px-6 py-3 bg-gray-600 text-white rounded-lg"
              >
                {selectedKeywords.length === relatedKeywords.length
                  ? "全解除"
                  : "全選択"}
              </button>
              <button
                onClick={handleTransferToList}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg"
              >
                リストに転記
              </button>
            </div>
          </div>
        )}

        {/* ==============================
            Googleトレンド表示
        =============================== */}
        {activeTab === "google" && (
          <div>
            {googleTrends.length === 0 && (
              <p className="text-gray-500">トレンドデータがありません。</p>
            )}
            {googleTrends.map((trend, i) => (
              <div
                key={i}
                className="p-6 border mb-4 rounded-lg shadow-sm bg-white"
              >
                <h3 className="font-semibold text-lg">{trend.keyword}</h3>

                {trend.trend_score?.timeline && (
                  <>
                    <p className="text-sm mt-3 mb-2 text-gray-600">
                      人気度推移
                    </p>

                    {trend.trend_score.timeline.map((item, j) => (
                      <div key={j} className="flex items-center gap-3 mb-2">
                        <span className="text-xs w-20">{item.time}</span>
                        <div className="flex-1 bg-gray-200 h-3 rounded-full">
                          <div
                            className="bg-blue-600 h-3 rounded-full"
                            style={{ width: `${item.value}%` }}
                          />
                        </div>
                        <span className="text-xs">{item.value}</span>
                      </div>
                    ))}
                  </>
                )}

                {trend.rising_keywords?.length > 0 && (
                  <>
                    <p className="text-sm mt-4 mb-2">上昇キーワード</p>
                    <div className="flex gap-2 flex-wrap">
                      {trend.rising_keywords.slice(0, 10).map((kw, j) => (
                        <span
                          key={j}
                          className="px-3 py-1 bg-green-50 border border-green-200 text-green-700 rounded-full text-sm"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ==============================
          キーワードリスト管理
      =============================== */}
      <div
        className="bg-white rounded-xl shadow-sm border p-8 mb-8"
        data-section="keyword-list"
      >
        <h2 className="text-xl font-semibold mb-6">
          キーワードリスト管理
        </h2>

        {/* タブ */}
        <div className="flex gap-4 border-b mb-6">
          <button
            className={`px-4 py-2 border-b-2 ${
              manualMode === "new"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-600"
            }`}
            onClick={() => setManualMode("new")}
          >
            新規追加
          </button>

          <button
            className={`px-4 py-2 border-b-2 ${
              manualMode === "edit"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-600"
            }`}
            onClick={() => setManualMode("edit")}
          >
            編集
          </button>
        </div>

        {/* ====================
            新規追加
        ==================== */}
        {manualMode === "new" && (
          <>
            {/* リスト名 */}
            <div className="mb-4">
              <label className="text-sm mb-2 block">リスト名</label>
              <input
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg"
              />
            </div>

            {/* キーワード */}
            <div className="mb-4">
              <label className="text-sm mb-2 block">キーワード追加</label>

              <div className="flex gap-3 mb-3">
                <input
                  value={newKeywordInput}
                  onChange={(e) => setNewKeywordInput(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && handleAddNewKeyword()
                  }
                  className="flex-1 px-4 py-3 border rounded-lg"
                  placeholder="例: AGA薄毛, 育毛剤効果"
                />

                <button
                  onClick={handleAddNewKeyword}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg"
                >
                  追加
                </button>
              </div>

              {newListKeywords.length > 0 && (
                <div className="grid md:grid-cols-2 gap-3">
                  {newListKeywords.map((kw, i) => (
                    <div
                      key={i}
                      className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex justify-between"
                    >
                      <span>{kw}</span>
                      <button
                        onClick={() => handleRemoveNewKeyword(i)}
                        className="text-red-500"
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
              className="w-full bg-green-600 text-white py-3 rounded-lg"
            >
              保存する
            </button>
          </>
        )}

        {/* ====================
            編集
        ==================== */}
        {manualMode === "edit" && (
          <>
            {/* リスト選択 */}
            <div className="mb-4">
              <label className="block text-sm mb-2">リストを選択</label>
              <select
                value={editListId}
                onChange={(e) => handleSelectEditList(e.target.value)}
                className="w-full border px-4 py-3 rounded-lg"
              >
                <option value="">選択してください</option>
                {savedKeywords.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.keyword}（{x.related_keywords.length}件）
                  </option>
                ))}
              </select>
            </div>

            {editListId && (
              <>
                {/* リスト名 */}
                <div className="mb-4">
                  <label className="block text-sm mb-2">
                    リスト名
                  </label>
                  <input
                    value={editListName}
                    onChange={(e) => setEditListName(e.target.value)}
                    className="w-full border px-4 py-3 rounded-lg"
                  />
                </div>

                {/* キーワード */}
                <div className="mb-4">
                  <label className="block text-sm mb-2">
                    キーワード編集
                  </label>

                  <div className="flex gap-3 mb-3">
                    <input
                      value={editKeywordInput}
                      onChange={(e) => setEditKeywordInput(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleAddEditKeyword()
                      }
                      className="flex-1 border px-4 py-3 rounded-lg"
                      placeholder="例: AGA原因, 育毛サプリ"
                    />

                    <button
                      onClick={handleAddEditKeyword}
                      className="px-6 py-3 bg-blue-600 text-white rounded-lg"
                    >
                      追加
                    </button>
                  </div>

                  <div className="grid md:grid-cols-2 gap-3">
                    {editListKeywords.map((kw, i) => (
                      <div
                        key={i}
                        className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex justify-between"
                      >
                        <span>{kw}</span>

                        <button
                          onClick={() => handleRemoveEditKeyword(i)}
                          className="text-red-500"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleUpdateList}
                  className="w-full bg-green-600 text-white py-3 rounded-lg"
                >
                  保存更新
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* ==============================
          保存済み一覧
      =============================== */}
      <div className="bg-white rounded-xl shadow-sm border p-8">
        <h2 className="text-xl font-semibold mb-6">
          保存済みキーワード
        </h2>

        {savedKeywords.map((item) => (
          <div
            key={item.id}
            className="border rounded-lg p-6 mb-4 hover:border-blue-300 transition"
          >
            <div className="flex justify-between">
              <div>
                <h3 className="text-lg font-semibold">{item.keyword}</h3>
                <p className="text-xs text-gray-500">
                  {new Date(item.created_at).toLocaleString("ja-JP")}
                </p>
              </div>

              <button
                onClick={() => handleDelete(item.id)}
                className="text-red-600"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>

            {item.related_keywords?.length > 0 && (
              <div className="mt-4">
                <p className="font-medium text-sm mb-2">
                  AI関連キーワード
                </p>
                <div className="flex gap-2 flex-wrap">
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
              <div className="mt-4">
                <p className="font-medium text-sm mb-2">上昇ワード</p>
                <div className="flex gap-2 flex-wrap">
                  {item.rising_keywords.slice(0, 5).map((kw, j) => (
                    <span
                      key={j}
                      className="px-3 py-1 bg-green-50 border border-green-200 rounded-full text-sm"
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
  );
}
