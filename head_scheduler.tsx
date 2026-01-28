import { useState, useEffect } from 'react';
import { supabase, ScheduleSetting, AIConfig, WPConfig } from '../lib/supabase';
import { Play, Pause, Trash2, Clock } from 'lucide-react';
import Toast from '../components/Toast';

// 菴ｿ逕ｨ貂医∩繧ｭ繝ｼ繝ｯ繝ｼ繝芽牡蛻・￠陦ｨ遉ｺ繧ｳ繝ｳ繝昴・繝阪Φ繝・// 菴ｿ逕ｨ貂医∩繧ｭ繝ｼ繝ｯ繝ｼ繝芽牡蛻・￠ + 驕ｸ謚樊ｩ溯・
function SchedulerUsedKeywordsDisplay({
  scheduleId,
  keywords,
  selectedKeywords,
  setSelectedKeywords,
  removedKeyword,
}: {
  scheduleId: string;
  keywords: string[];
  selectedKeywords: string[];
  setSelectedKeywords: (kw: string[]) => void;
  removedKeyword: string | null;
}) {
  const [usedKeywords, setUsedKeywords] = useState<string[]>([]);

  // 蛻晄悄
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("schedule_used_keywords")
        .select("keyword")
        .eq("schedule_id", scheduleId);

      setUsedKeywords(data?.map((d) => d.keyword) || []);
    };
    load();
  }, [scheduleId]);

  // 隗｣髯､縺輔ｌ縺溘Ρ繝ｼ繝峨・蜊ｳ蜿肴丐
  useEffect(() => {
    if (removedKeyword) {
      setUsedKeywords((prev) => prev.filter((k) => k !== removedKeyword));
    }
  }, [removedKeyword]);

  const usedSet = new Set(usedKeywords);

  const toggleSelect = (word: string) => {
    if (selectedKeywords.includes(word)) {
      // 縺吶〒縺ｫ驕ｸ謚・竊・螟悶☆
      setSelectedKeywords(selectedKeywords.filter((w) => w !== word));
    } else {
      // 譁ｰ縺励￥驕ｸ謚・      setSelectedKeywords([...selectedKeywords, word]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {keywords.map((word) => {
        const isUsed = usedSet.has(word);
        const isSelected = selectedKeywords.includes(word);

        // 譛ｪ菴ｿ逕ｨ 竊・髱偵√け繝ｪ繝・け荳榊庄
        if (!isUsed) {
          return (
            <span
              key={word}
              className="px-3 py-1 rounded-full text-xs bg-blue-100 text-blue-800"
            >
              {word}
            </span>
          );
        }

        // 菴ｿ逕ｨ貂医∩ 竊・隍・焚驕ｸ謚槫ｯｾ蠢・        return (
          <button
            key={word}
            onClick={() => toggleSelect(word)}
            className={
              `px-3 py-1 rounded-full text-xs transition ` +
              (isSelected
                ? "bg-gray-600 text-white"
                : "bg-gray-300 text-gray-700")
            }
          >
            {word}
          </button>
        );
      })}
    </div>
  );
}


export default function Scheduler() {
  const [schedules, setSchedules] = useState<
    (ScheduleSetting & { ai_config?: AIConfig; wp_config?: WPConfig })[]
  >([]);
  const [aiConfigs, setAiConfigs] = useState<AIConfig[]>([]);
  const [wpConfigs, setWpConfigs] = useState<WPConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [mainKeywords, setMainKeywords] = useState<any[]>([]);
  const [selectedMainKeyword, setSelectedMainKeyword] = useState<string | null>(null);
  const [relatedKeywords, setRelatedKeywords] = useState<string[]>([]);
  const [removedKeyword, setRemovedKeyword] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    ai_config_id: '',
    wp_config_id: '',
    time: '13:00',
    frequency: '豈取律',
    start_date: '',
    end_date: '',
    post_status: 'draft',
    status: true,
    chatwork_room_id: '',
  });

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const fetchMainKeywords = async () => {
    const { data, error } = await supabase
      .from('trend_keywords')
      .select('id, keyword, related_keywords');
    if (!error) setMainKeywords(data || []);
  };

  const loadSchedules = async () => {
    const { data, error } = await supabase
      .from('schedule_settings')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      showMessage('error', '繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ縺ｮ隱ｭ縺ｿ霎ｼ縺ｿ縺ｫ螟ｱ謨励＠縺ｾ縺励◆');
    } else if (data) {
      const aiConfigsData = await supabase.from('ai_configs').select('*');
      const wpConfigsData = await supabase.from('wp_configs').select('*');

      const enrichedSchedules = data.map((schedule) => ({
        ...schedule,
        ai_config: aiConfigsData.data?.find((c) => c.id === schedule.ai_config_id),
        wp_config: wpConfigsData.data?.find((c) => c.id === schedule.wp_config_id),
      }));

      setSchedules(enrichedSchedules);
    }
  };

  const loadAiConfigs = async () => {
    const { data, error } = await supabase
      .from('ai_configs')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setAiConfigs(data);
      if (data.length > 0 && !formData.ai_config_id) {
        setFormData((prev) => ({ ...prev, ai_config_id: data[0].id }));
      }
    }
  };

  const loadWpConfigs = async () => {
    const { data, error } = await supabase
      .from('wp_configs')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setWpConfigs(data);
      if (data.length > 0 && !formData.wp_config_id) {
        setFormData((prev) => ({ ...prev, wp_config_id: data[0].id }));
      }
    }
  };

  const loadData = async () => {
    await Promise.all([loadSchedules(), loadAiConfigs(), loadWpConfigs()]);
  };

  useEffect(() => {
    fetchMainKeywords();
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async () => {
    if (!formData.ai_config_id || !formData.wp_config_id || !selectedMainKeyword) {
      showMessage('error', 'AI險ｭ螳壹・WordPress險ｭ螳壹・繧ｭ繝ｼ繝ｯ繝ｼ繝峨ｒ驕ｸ謚槭＠縺ｦ縺上□縺輔＞');
      return;
    }

    setLoading(true);

    const insertData = {
      ai_config_id: formData.ai_config_id,
      wp_config_id: formData.wp_config_id,
      keyword: selectedMainKeyword,
      related_keywords: Array.isArray(relatedKeywords) ? relatedKeywords : [],
      post_time: formData.time,
      frequency: formData.frequency,
      start_date: formData.start_date || null,
      end_date: formData.end_date || null,
      status: formData.status,
      post_status: formData.post_status,
      chatwork_room_id: formData.chatwork_room_id || null,
    };

    const { error } = await supabase.from('schedule_settings').insert([insertData]);
    setLoading(false);

    if (error) {
      console.error('笶・Supabase insert error:', error);
      showMessage('error', '繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ縺ｮ霑ｽ蜉縺ｫ螟ｱ謨励＠縺ｾ縺励◆');
    } else {
      showMessage('success', '繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ繧定ｿｽ蜉縺励∪縺励◆');
      loadSchedules();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('縺薙・繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ繧貞炎髯､縺励※繧ゅｈ繧阪＠縺・〒縺吶°・・)) return;

    const { error } = await supabase.from('schedule_settings').delete().eq('id', id);

    if (error) {
      showMessage('error', '蜑企勁縺ｫ螟ｱ謨励＠縺ｾ縺励◆');
    } else {
      showMessage('success', '繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ繧貞炎髯､縺励∪縺励◆');
      loadSchedules();
    }
  };

  const toggleStatus = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from('schedule_settings')
      .update({ status: !currentStatus })
      .eq('id', id);

    if (error) {
      showMessage('error', '繧ｹ繝・・繧ｿ繧ｹ縺ｮ譖ｴ譁ｰ縺ｫ螟ｱ謨励＠縺ｾ縺励◆');
    } else {
      showMessage(
        'success',
        !currentStatus ? '繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ繧貞・髢九＠縺ｾ縺励◆' : '繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ繧貞●豁｢縺励∪縺励◆'
      );
      loadSchedules();
    }
  };

  // 笘・莉翫☆縺仙ｮ溯｡鯉ｼ・etlify Functions /scheduler 繧貞娼縺擾ｼ・  const handleRunNow = async (scheduleId: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        'https://ai-autowriter.netlify.app/.netlify/functions/run-scheduler-background',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schedule_id: scheduleId }),
        }
      );

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // HTML縺瑚ｿ斐▲縺ｦ縺阪◆蝣ｴ蜷医↑縺ｩ縺ｯ縺薙％縺ｫ譚･繧・      }

      if (!res.ok) {
        console.error('笶・莉翫☆縺仙ｮ溯｡後お繝ｩ繝ｼ:', res.status, data);
        showMessage(
          'error',
          `謚慕ｨｿ繧ｨ繝ｩ繝ｼ: ${data?.error || data?.message || `status ${res.status}`}`
        );
        return;
      }

      showMessage('success', '謚慕ｨｿ繧貞ｮ溯｡後＠縺ｾ縺励◆');
      loadSchedules();
    } catch (error) {
      console.error('笶・莉翫☆縺仙ｮ溯｡御ｸｭ縺ｫ萓句､・', error);
      showMessage('error', '謚慕ｨｿ縺ｮ螳溯｡後↓螟ｱ謨励＠縺ｾ縺励◆');
    } finally {
      setLoading(false);
    }
  };

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
        <h1 className="text-3xl font-bold text-gray-800 mb-2">繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｩ繝ｼ</h1>
        <p className="text-gray-600">險倅ｺ九・閾ｪ蜍墓兜遞ｿ繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ繧堤ｮ｡逅・＠縺ｾ縺・/p>
      </div>

      {/* 譁ｰ隕上せ繧ｱ繧ｸ繝･繝ｼ繝ｫ菴懈・ */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">譁ｰ縺励＞繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ</h2>

        {aiConfigs.length === 0 || wpConfigs.length === 0 ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-yellow-800">
              繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ繧剃ｽ懈・縺吶ｋ蜑阪↓縲、I險ｭ螳壹→WordPress險ｭ螳壹ｒ逋ｻ骭ｲ縺励※縺上□縺輔＞縲・            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* AI險ｭ螳・*/}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                AI險ｭ螳・              </label>
              <select
                value={formData.ai_config_id}
                onChange={(e) =>
                  setFormData({ ...formData, ai_config_id: e.target.value })
                }
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {aiConfigs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name || `${config.provider} - ${config.model}`}
                  </option>
                ))}
              </select>
            </div>

            {/* WordPress險ｭ螳・*/}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                WordPress險ｭ螳・              </label>
              <select
                value={formData.wp_config_id}
                onChange={(e) =>
                  setFormData({ ...formData, wp_config_id: e.target.value })
                }
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {wpConfigs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name} ({config.url})
                  </option>
                ))}
              </select>
            </div>

            {/* 繝｡繧､繝ｳ繧ｭ繝ｼ繝ｯ繝ｼ繝・*/}
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700">
                繧ｭ繝ｼ繝ｯ繝ｼ繝芽ｨｭ螳・              </label>
              <select
                className="mt-1 block w-full border border-gray-300 rounded-md p-2"
                value={selectedMainKeyword || ''}
                onChange={(e) => {
                  const selected = e.target.value;
                  setSelectedMainKeyword(selected);
                  const found = mainKeywords.find((k) => k.keyword === selected);
                  setRelatedKeywords(found?.related_keywords || []);
                }}
              >
                <option hidden value="">
                  繧ｭ繝ｼ繝ｯ繝ｼ繝峨ｒ驕ｸ謚・                </option>
                {mainKeywords.map((k) => (
                  <option key={k.id} value={k.keyword}>
                    {k.keyword}・・k.related_keywords?.length || 0}莉ｶ縺ｮ髢｢騾｣繝ｯ繝ｼ繝会ｼ・                  </option>
                ))}
              </select>
            </div>

            {/* 髢｢騾｣繝ｯ繝ｼ繝・*/}
            {relatedKeywords.length > 0 && (
              <div className="mt-3">
                <p className="text-sm text-gray-600 mb-1">髢｢騾｣繝ｯ繝ｼ繝・/p>
                <div className="flex flex-wrap gap-2">
                  {relatedKeywords.map((word, idx) => (
                    <span
                      key={idx}
                      className="bg-blue-100 text-blue-800 text-sm px-3 py-1 rounded-full"
                    >
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 謚慕ｨｿ險ｭ螳・*/}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  謚慕ｨｿ譎ょ綾
                </label>
                <input
                  type="time"
                  value={formData.time}
                  onChange={(e) =>
                    setFormData({ ...formData, time: e.target.value })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  謚慕ｨｿ鬆ｻ蠎ｦ
                </label>
                <select
                  value={formData.frequency}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      frequency: e.target.value,
                    })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="豈取律">豈取律</option>
                  <option value="豈朱ｱ">豈朱ｱ</option>
                  <option value="髫秘ｱ">髫秘ｱ</option>
                  <option value="譛井ｸ">譛井ｸ</option>
                </select>
              </div>
            </div>

            {/* 繧ｵ繧､繧ｯ繝ｫ譛滄俣 + 謚慕ｨｿ迥ｶ諷・*/}
            <div className="grid grid-cols-3 gap-6 mt-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  繧ｵ繧､繧ｯ繝ｫ髢句ｧ区律
                </label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) =>
                    setFormData({ ...formData, start_date: e.target.value })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  繧ｵ繧､繧ｯ繝ｫ邨ゆｺ・律
                </label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) =>
                    setFormData({ ...formData, end_date: e.target.value })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  謚慕ｨｿ迥ｶ諷・                </label>
                <select
                  value={formData.post_status}
                  onChange={(e) =>
                    setFormData({ ...formData, post_status: e.target.value })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                >
                  <option value="publish">蜈ｬ髢・/option>
                  <option value="draft">荳区嶌縺・/option>
                </select>
              </div>
            </div>

            {/* ChatWork繝ｫ繝ｼ繝ID */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ChatWork繝ｫ繝ｼ繝ID・井ｻｻ諢擾ｼ・              </label>
              <input
                type="text"
                value={formData.chatwork_room_id}
                onChange={(e) =>
                  setFormData({ ...formData, chatwork_room_id: e.target.value })
                }
                placeholder="萓・ 123456789"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                窶ｻ 遨ｺ谺・・蝣ｴ蜷医・閾ｪ遉ｾ縺ｮChatWork繝ｫ繝ｼ繝縺ｫ縺ｮ縺ｿ騾夂衍縺輔ｌ縺ｾ縺・              </p>
            </div>


            {/* 譛牙柑蛹・*/}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="status"
                checked={formData.status}
                onChange={(e) =>
                  setFormData({ ...formData, status: e.target.checked })
                }
                className="w-5 h-5 text-blue-600"
              />
              <label htmlFor="status" className="text-sm font-medium text-gray-700">
                繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ繧呈怏蜉ｹ蛹・              </label>
            </div>

            {/* 菫晏ｭ・*/}
            <div className="flex gap-4 pt-4">
              <button
                onClick={handleSave}
                disabled={loading}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ繧定ｿｽ蜉
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 譌｢蟄倥せ繧ｱ繧ｸ繝･繝ｼ繝ｫ荳隕ｧ */}
      {schedules.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            逋ｻ骭ｲ貂医∩縺ｮ繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ
          </h2>

          <div className="space-y-4">

            {schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="bg-white rounded-lg border p-6 shadow-sm"
              >
                <div className="flex items-start justify-between">
                  {/* 蟾ｦ蛛ｴ */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="text-lg font-semibold">
                        {schedule.wp_config?.name}
                      </h3>
                      <span
                        className={`px-3 py-1 text-sm rounded-full ${
                          schedule.status
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {schedule.status ? '譛牙柑' : '蛛懈ｭ｢荳ｭ'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                      <div>
                        <p className="font-medium text-gray-700 mb-1">AI險ｭ螳・/p>
                        <p>{schedule.ai_config?.name}</p>
                      </div>

                      <div>
                        <p className="font-medium text-gray-700 mb-1">
                          WordPress
                        </p>
                        <p>{schedule.wp_config?.url}</p>
                      </div>

                      {/* 繝｡繧､繝ｳ繧ｭ繝ｼ繝ｯ繝ｼ繝・*/}
                      <div className="col-span-2">
                        <p className="font-medium text-gray-700 mb-1">
                          繝｡繧､繝ｳ繧ｭ繝ｼ繝ｯ繝ｼ繝・                        </p>
                        <p>{schedule.keyword || '譛ｪ險ｭ螳・}</p>
                      </div>

                      {/* 髢｢騾｣繝ｯ繝ｼ繝・*/}
                      {schedule.related_keywords?.length > 0 && (
                        <div className="col-span-2">
                          <p className="font-medium text-gray-700 mb-1">髢｢騾｣繝ｯ繝ｼ繝・/p>
                      
                          <SchedulerUsedKeywordsDisplay
                          scheduleId={schedule.id}
                          keywords={schedule.related_keywords}
                          selectedKeywords={selectedKeywords}
                          setSelectedKeywords={setSelectedKeywords}
                          removedKeyword={removedKeyword}
                          />
                        </div>
                      )}


                      {/* 謚慕ｨｿ諠・ｱ */}
                      <div className="col-span-2 mt-4 p-4 bg-gray-50 rounded-lg grid grid-cols-2 gap-4">
                        {/* 謚慕ｨｿ譎ょ綾 */}
                        <div>
                          <p className="font-medium text-gray-700 mb-1">
                            謚慕ｨｿ譎ょ綾
                          </p>
                          <p className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {schedule.post_time}
                          </p>
                        </div>

                        {/* 鬆ｻ蠎ｦ */}
                        <div>
                          <p className="font-medium text-gray-700 mb-1">鬆ｻ蠎ｦ</p>
                          <p>{schedule.frequency}</p>
                        </div>

                        {/* 繧ｵ繧､繧ｯ繝ｫ譛滄俣 */}
                        <div>
                          <p className="font-medium text-gray-700 mb-1">
                            繧ｵ繧､繧ｯ繝ｫ譛滄俣
                          </p>
                          <p>
                            {schedule.start_date
                              ? `${new Date(schedule.start_date).toLocaleDateString("ja-JP")} ・・${
                                  schedule.end_date
                                    ? new Date(schedule.end_date).toLocaleDateString("ja-JP")
                                    : "譛ｪ險ｭ螳・
                                }`
                              : "譛ｪ險ｭ螳・}
                          </p>

                        </div>

                        {/* 謚慕ｨｿ迥ｶ諷・*/}
                        <div>
                          <p className="font-medium text-gray-700 mb-1">
                            謚慕ｨｿ迥ｶ諷・                          </p>
                          <p className="text-gray-600 text-sm">
                            {schedule.post_status === 'publish'
                              ? '蜈ｬ髢・
                              : '荳区嶌縺・}
                          </p>
                        </div>

                        {/* 蜑榊屓謚慕ｨｿ譌･譎・*/}
                        <div>
                          <p className="font-medium text-gray-700 mb-1">
                            蜑榊屓謚慕ｨｿ譌･譎・                          </p>
                          <p className="text-gray-600 text-sm">
                            {schedule.last_run_at
                              ? new Date(schedule.last_run_at).toLocaleString("ja-JP", {
                                  timeZone: "Asia/Tokyo",
                                })
                              : "譛ｪ謚慕ｨｿ"}
                          </p>



                        </div>

                      {/* 谺｡蝗樊兜遞ｿ莠亥ｮ・*/}
{/* 谺｡蝗樊兜遞ｿ莠亥ｮ・*/}
<div>
  <p className="font-medium text-gray-700 mb-1">谺｡蝗樊兜遞ｿ莠亥ｮ・/p>
  <p className="text-gray-600 text-sm">
    {(() => {
      try {
        if (!schedule.status) return "蛛懈ｭ｢荳ｭ";
        if (!schedule.post_time || !schedule.frequency) return "譛ｪ險ｭ螳・;
        if (!schedule.start_date) return "譛ｪ險ｭ螳・;

        const start = new Date(schedule.start_date + "T00:00:00");
        const now = new Date();

        const [hour, minute] = schedule.post_time.split(":").map(Number);

        // start_date 縺梧悴譚･ 竊・縺昴・譌･縺悟・蝗樊兜遞ｿ譌･
        if (start > now) {
          let s = new Date(start);
          s.setHours(hour, minute, 0, 0);
          return s.toLocaleString("ja-JP");
        }

        // 莉頑律莉･髯阪〒縲∝・蝗槭→縺ｪ繧・nextDate 繧定ｨ育ｮ・        let next = new Date(start);
        next.setHours(hour, minute, 0, 0);

        const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));

        switch (schedule.frequency) {
          case "豈取律":
            if (now <= next) {
              return next.toLocaleString("ja-JP");
            } else {
              next = new Date(now);
              next.setHours(hour, minute, 0, 0);
              next.setDate(next.getDate() + 1);
              return next.toLocaleString("ja-JP");
            }

          case "豈朱ｱ":
            {
              let n = Math.ceil(diffDays / 7);
              next.setDate(start.getDate() + n * 7);
              return next.toLocaleString("ja-JP");
            }

          case "髫秘ｱ":
            {
              let n = Math.ceil(diffDays / 14);
              next.setDate(start.getDate() + n * 14);
              return next.toLocaleString("ja-JP");
            }

          case "譛井ｸ":
            {
              next = new Date(start);
              next.setMonth(start.getMonth() + 1);

              while (next < now) {
                next.setMonth(next.getMonth() + 1);
              }
              next.setHours(hour, minute, 0, 0);

              return next.toLocaleString("ja-JP");
            }

          default:
            return "譛ｪ險ｭ螳・;
        }
      } catch {
        return "譛ｪ險ｭ螳・;
      }
    })()}
  </p>
</div>
                </div>

                      {/* 譛邨ょｮ溯｡・*/}
                      {schedule.created_at && (
                        <p className="text-xs text-gray-400 mt-3">
                          繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ菴懈・:{' '}
                          {new Date(schedule.created_at).toLocaleString('ja-JP')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 蜿ｳ蛛ｴ繝懊ち繝ｳ鄒､ */}
                  <div className="flex flex-col gap-2 items-stretch">
                    {/* 蛛懈ｭ｢繝ｻ蜀埼幕 */}
                    <button
                      onClick={() =>
                        toggleStatus(schedule.id, schedule.status)
                      }
                      className={`px-4 py-2 rounded-lg flex items-center justify-center gap-2 ${
                        schedule.status
                          ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                          : 'bg-green-50 text-green-700 hover:bg-green-100'
                      }`}
                    >
                      {schedule.status ? (
                        <>
                          <Pause className="w-4 h-4" />
                          蛛懈ｭ｢
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" />
                          蜀埼幕
                        </>
                      )}
                    </button>

                    {/* 莉翫☆縺仙ｮ溯｡・*/}
                    <button
                      onClick={() => handleRunNow(schedule.id)}
                      disabled={loading}
                      className={`px-4 py-2 border rounded-lg ${
                        loading
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'text-gray-700 hover:bg-green-100'
                      }`}
                    >
                      {loading ? '謚慕ｨｿ荳ｭ...' : '莉翫☆縺仙ｮ溯｡・}
                    </button>

                    {/* 蜑企勁 */}
                    <button
                      onClick={() => handleDelete(schedule.id)}
                      className="px-4 py-2 border border-red-300 text-red-700 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-5 h-5 inline-block" />蜑企勁縺吶ｋ
                    </button>
                    
                    {/* 邱ｨ髮・・繧ｿ繝ｳ & 菴ｿ逕ｨ貂医∩隗｣髯､繝懊ち繝ｳ */}
                    {!schedule.isEditing ? (
                      <div className="flex flex-col gap-2">
                    
                        {/* 邱ｨ髮・*/}
                        <button
                          onClick={() => {
                            (schedule as any).isEditing = true;
                            setSchedules([...schedules]);
                          }}
                          className="px-4 py-2 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50"
                        >
                          笨擾ｸ・邱ｨ髮・                        </button>
                                    

                      {/* 菴ｿ逕ｨ貂医∩隗｣髯､ */}
                      <button
                      onClick={async () => {
                        try {
                          // ------------------------------------------
                          // 竭 驕ｸ謚槭≠繧・竊・驕ｸ謚槭く繝ｼ繝ｯ繝ｼ繝峨・縺ｿ隗｣髯､・医い繝ｩ繝ｼ繝医▽縺搾ｼ・                          // ------------------------------------------
                          if (selectedKeywords.length > 0) {
                            const ok = confirm(
                              `驕ｸ謚槭＆繧後※縺・ｋ ${selectedKeywords.length} 莉ｶ縺ｮ繧ｭ繝ｼ繝ｯ繝ｼ繝峨ｒ隗｣髯､縺励∪縺吶°・歔
                            );
                            if (!ok) return;
                    
                            // DB縺九ｉ隧ｲ蠖薙く繝ｼ繝ｯ繝ｼ繝牙炎髯､
                            await Promise.all(
                              selectedKeywords.map((kw) =>
                                supabase
                                  .from("schedule_used_keywords")
                                  .delete()
                                  .eq("schedule_id", schedule.id)
                                  .eq("keyword", kw)
                              )
                            );
                    
                            // UI蜿肴丐・磯∈謚槭＆繧後◆繧ゅ・縺縺大・縺ｫ謌ｻ縺呻ｼ・                            selectedKeywords.forEach((kw) => setRemovedKeyword(kw));
                    
                            showMessage(
                              "success",
                              `${selectedKeywords.length} 莉ｶ縺ｮ繧ｭ繝ｼ繝ｯ繝ｼ繝峨ｒ譛ｪ菴ｿ逕ｨ縺ｫ謌ｻ縺励∪縺励◆`
                            );
                    
                            setSelectedKeywords([]);
                            return;
                          }
                    
                          // ------------------------------------------
                          // 竭｡ 驕ｸ謚槭↑縺・竊・蜈ｨ驛ｨ隗｣髯､・医い繝ｩ繝ｼ繝医▽縺搾ｼ・                          // ------------------------------------------
                          const ok = confirm(
                            "菴ｿ逕ｨ貂医∩繧ｭ繝ｼ繝ｯ繝ｼ繝峨ｒ縺吶∋縺ｦ隗｣髯､縺励∪縺吶°・歃n・亥・縺ｫ謌ｻ縺帙∪縺帙ｓ・・
                          );
                          if (!ok) return;
                    
                          // DB縺九ｉ縺吶∋縺ｦ蜑企勁
                          await supabase
                            .from("schedule_used_keywords")
                            .delete()
                            .eq("schedule_id", schedule.id);
                    
                          // UI蜿肴丐・亥・驛ｨ謌ｻ縺呻ｼ・                          schedule.related_keywords.forEach((kw: string) =>
                            setRemovedKeyword(kw)
                          );
                    
                          showMessage("success", "縺吶∋縺ｦ縺ｮ菴ｿ逕ｨ貂医∩繧ｭ繝ｼ繝ｯ繝ｼ繝峨ｒ隗｣髯､縺励∪縺励◆");
                          setSelectedKeywords([]);
                        } catch (err) {
                          console.error(err);
                          showMessage("error", "隗｣髯､荳ｭ縺ｫ繧ｨ繝ｩ繝ｼ縺檎匱逕溘＠縺ｾ縺励◆");
                        }
                      }}
                      className="px-4 py-2 border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50"
                    >
                      ｧｹ 菴ｿ逕ｨ貂医∩隗｣髯､
                    </button>



                    </div>
                    ) : (
                      <div className="border-t border-gray-200 pt-4 mt-4 space-y-4 text-sm text-gray-700 w-64">
                        {/* 邱ｨ髮・ｼ哂I險ｭ螳・*/}
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">
                            AI險ｭ螳・                          </label>
                          <select
                            value={schedule.ai_config_id}
                            onChange={(e) => {
                              schedule.ai_config_id = e.target.value;
                              setSchedules([...schedules]);
                            }}
                            className="border rounded w-full p-2"
                          >
                            {aiConfigs.map((ai) => (
                              <option key={ai.id} value={ai.id}>
                                {ai.name || `${ai.provider} - ${ai.model}`}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* 邱ｨ髮・ｼ啗ordPress險ｭ螳・*/}
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">
                            WordPress險ｭ螳・                          </label>
                          <select
                            value={schedule.wp_config_id}
                            onChange={(e) => {
                              schedule.wp_config_id = e.target.value;
                              setSchedules([...schedules]);
                            }}
                            className="border rounded w-full p-2"
                          >
                            {wpConfigs.map((wp) => (
                              <option key={wp.id} value={wp.id}>
                                {wp.name} ({wp.url})
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* 邱ｨ髮・ｼ壹く繝ｼ繝ｯ繝ｼ繝芽ｨｭ螳・*/}
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">
                            繧ｭ繝ｼ繝ｯ繝ｼ繝芽ｨｭ螳・                          </label>
                          <select
                            value={schedule.keyword}
                            onChange={(e) => {
                              schedule.keyword = e.target.value;
                              const found = mainKeywords.find(
                                (k) => k.keyword === e.target.value
                              );
                              schedule.related_keywords =
                                found?.related_keywords || [];
                              setSchedules([...schedules]);
                            }}
                            className="border rounded w-full p-2"
                          >
                            <option value="">驕ｸ謚槭＠縺ｦ縺上□縺輔＞</option>
                            {mainKeywords.map((k) => (
                              <option key={k.id} value={k.keyword}>
                                {k.keyword}・・                                {k.related_keywords?.length || 0}莉ｶ・・                              </option>
                            ))}
                          </select>

                          {/* 髢｢騾｣繝ｯ繝ｼ繝・*/}
                          {schedule.related_keywords?.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {schedule.related_keywords.map((word, i) => (
                                <span
                                  key={i}
                                  className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full"
                                >
                                  {word}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* 邱ｨ髮・ｼ壽兜遞ｿ譎ょ綾 */}
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">
                            謚慕ｨｿ譎ょ綾
                          </label>
                          <input
                            type="time"
                            value={schedule.post_time}
                            onChange={(e) => {
                              schedule.post_time = e.target.value;
                              setSchedules([...schedules]);
                            }}
                            className="border rounded w-full p-2"
                          />
                        </div>

                        {/* 邱ｨ髮・ｼ夐ｻ蠎ｦ */}
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">
                            鬆ｻ蠎ｦ
                          </label>
                          <select
                            value={schedule.frequency}
                            onChange={(e) => {
                              schedule.frequency = e.target.value;
                              setSchedules([...schedules]);
                            }}
                            className="border rounded w-full p-2"
                          >
                            <option value="豈取律">豈取律</option>
                            <option value="豈朱ｱ">豈朱ｱ</option>
                            <option value="髫秘ｱ">髫秘ｱ</option>
                            <option value="譛井ｸ">譛井ｸ</option>
                          </select>
                        </div>

                        {/* 邱ｨ髮・ｼ壹し繧､繧ｯ繝ｫ譛滄俣 */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">
                              髢句ｧ区律
                            </label>
                            <input
                              type="date"
                              value={schedule.start_date || ''}
                              onChange={(e) => {
                                schedule.start_date = e.target.value;
                                setSchedules([...schedules]);
                              }}
                              className="border rounded w-full p-2"
                            />
                          </div>

                          <div>
                            <label className="block text-xs text-gray-500 mb-1">
                              邨ゆｺ・律
                            </label>
                            <input
                              type="date"
                              value={schedule.end_date || ''}
                              onChange={(e) => {
                                schedule.end_date = e.target.value;
                                setSchedules([...schedules]);
                              }}
                              className="border rounded w-full p-2"
                            />
                          </div>
                        </div>

                        {/* 邱ｨ髮・ｼ壽兜遞ｿ迥ｶ諷・*/}
                        <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          謚慕ｨｿ迥ｶ諷・                        </label>
                        <select
                          value={schedule.post_status}
                          onChange={(e) => {
                            schedule.post_status = e.target.value;
                            setSchedules([...schedules]);
                          }}
                          className="border rounded w-full p-2"
                        >
                          <option value="publish">蜈ｬ髢・/option>
                          <option value="draft">荳区嶌縺・/option>
                        </select>
                      </div>

                      {/* 邱ｨ髮・ｼ咾hatWork繝ｫ繝ｼ繝ID */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          ChatWork繝ｫ繝ｼ繝ID・井ｻｻ諢擾ｼ・                        </label>
                        <input
                          type="text"
                          value={schedule.chatwork_room_id || ''}
                          onChange={(e) => {
                            schedule.chatwork_room_id = e.target.value;
                            setSchedules([...schedules]);
                          }}
                          className="border rounded w-full p-2"
                          placeholder="萓・ 123456789"
                        />
                      </div>

                        {/* 邱ｨ髮・ｼ壻ｿ晏ｭ倥・繧ｭ繝｣繝ｳ繧ｻ繝ｫ */}
                        <div className="flex gap-2 mt-4">
                          <button
                            onClick={async () => {
                              const { error } = await supabase
                                .from('schedule_settings')
                                .update({
                                  ai_config_id: schedule.ai_config_id,
                                  wp_config_id: schedule.wp_config_id,
                                  keyword: schedule.keyword,
                                  related_keywords: schedule.related_keywords,
                                  post_time: schedule.post_time,
                                  frequency: schedule.frequency,
                                  start_date: schedule.start_date || null,
                                  end_date: schedule.end_date || null,
                                  post_status: schedule.post_status,
                                  chatwork_room_id: schedule.chatwork_room_id || null,  
                                })
                                .eq('id', schedule.id);

                              if (error) {
                                showMessage('error', '譖ｴ譁ｰ縺ｫ螟ｱ謨励＠縺ｾ縺励◆');
                              } else {
                                showMessage('success', '繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ繧呈峩譁ｰ縺励∪縺励◆');
                                (schedule as any).isEditing = false;
                                loadSchedules();
                              }
                            }}
                            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            菫晏ｭ・                          </button>

                          <button
                            onClick={() => {
                              (schedule as any).isEditing = false;
                              setSchedules([...schedules]);
                            }}
                            className="flex-1 px-4 py-2 border rounded hover:bg-gray-100"
                          >
                            繧ｭ繝｣繝ｳ繧ｻ繝ｫ
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 螳溯｡後Ο繧ｰ */}
      <div className="mt-8 bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-semibold">譛霑代・螳溯｡後Ο繧ｰ</h3>
        <p className="text-sm text-gray-600">螳溯｡後Ο繧ｰ讖溯・縺ｯ貅門ｙ荳ｭ縺ｧ縺吶・/p>
      </div>
    </div>
  );
}
